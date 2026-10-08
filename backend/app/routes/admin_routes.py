"""Admin routes: import, issue, email, revoke, reissue, export-csv, qr-png, stats, scan-log."""

import csv
import io
import uuid
from datetime import datetime, timezone
from typing import Annotated, Literal
import psycopg


from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel

from app import config
from app.auth import require_role, StaffUser, hash_password
from app.db import get_pool
from app.qr import generate_qr_png_bytes
from app.services import revoke_ticket, reissue_ticket
from app.tokens import sign_token, build_qr_url, private_key_from_seed

router = APIRouter(tags=["admin"])


class ReasonRequest(BaseModel):
    reason: str


class IssueRequest(BaseModel):
    event_id: str | None = None


class SendEmailRequest(BaseModel):
    event_id: str | None = None
    force_resend: bool = False


class ImportTextRequest(BaseModel):
    csv_content: str
    event_id: str | None = None


class CreateParticipantRequest(BaseModel):
    name: str
    email: str
    college: str | None = None
    photo_url: str | None = None
    event_id: str | None = None
    send_email: bool = False


class CreateStaffRequest(BaseModel):
    name: str
    email: str
    password: str
    role: Literal["volunteer", "supervisor", "admin"] = "volunteer"


class UpdateStaffRequest(BaseModel):
    role: Literal["volunteer", "supervisor", "admin"] | None = None
    active: bool | None = None
    name: str | None = None

class UpdateEventRequest(BaseModel):
    name: str | None = None


@router.get("/api/event")
def get_current_event(
    staff: Annotated[StaffUser, Depends(require_role("admin"))],
):
    """Return the current default event."""
    pool = get_pool()
    with pool.connection() as conn:
        row = conn.execute(
            """
            SELECT id, name, starts_at, ends_at
            FROM events
            ORDER BY starts_at ASC NULLS LAST
            LIMIT 1;
            """
        ).fetchone()

    if not row:
        raise HTTPException(status_code=404, detail={"reason": "no_event"})

    return {
        "id": str(row["id"]),
        "name": row["name"],
        "starts_at": row["starts_at"].isoformat() if row["starts_at"] else None,
        "ends_at": row["ends_at"].isoformat() if row["ends_at"] else None,
    }


@router.patch("/api/event")
def update_current_event(
    req: UpdateEventRequest,
    staff: Annotated[StaffUser, Depends(require_role("admin"))],
):
    """Update the current event's name."""
    if req.name is None:
        return {"status": "noop"}

    name = req.name.strip()
    if not name:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"reason": "invalid_input", "message": "Event name cannot be empty"},
        )
    if len(name) > 120:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"reason": "invalid_input", "message": "Event name must be 120 characters or fewer"},
        )

    pool = get_pool()
    with pool.connection() as conn:
        row = conn.execute(
            "SELECT id FROM events ORDER BY starts_at ASC NULLS LAST LIMIT 1;"
        ).fetchone()

        if not row:
            # Auto-create if the DB is empty
            eid = str(uuid.uuid4())
            conn.execute(
                "INSERT INTO events (id, name) VALUES (%s, %s);",
                (eid, name),
            )
            conn.commit()
            return {
                "status": "created",
                "event": {"id": eid, "name": name, "starts_at": None, "ends_at": None},
            }

        conn.execute(
            "UPDATE events SET name = %s WHERE id = %s;",
            (name, str(row["id"])),
        )
        conn.commit()

        updated = conn.execute(
            "SELECT id, name, starts_at, ends_at FROM events WHERE id = %s;",
            (str(row["id"]),),
        ).fetchone()

    return {
        "status": "updated",
        "event": {
            "id": str(updated["id"]),
            "name": updated["name"],
            "starts_at": updated["starts_at"].isoformat() if updated["starts_at"] else None,
            "ends_at": updated["ends_at"].isoformat() if updated["ends_at"] else None,
        },
    }

def _get_or_create_default_event(conn) -> str:
    row = conn.execute("SELECT id FROM events ORDER BY starts_at ASC NULLS LAST LIMIT 1;").fetchone()
    if row:
        return str(row["id"])
    eid = str(uuid.uuid4())
    conn.execute("INSERT INTO events (id, name) VALUES (%s, %s);", (eid, "HackSummit 2025"))
    conn.commit()
    return eid


@router.get("/api/participants")
def list_participants(
    staff: Annotated[StaffUser, Depends(require_role("volunteer"))],
    event_id: str | None = None,
    q: str | None = None,
    limit: int = 50,
    offset: int = 0,
):
    pool = get_pool()
    with pool.connection() as conn:
        conditions = []
        params = {}

        if event_id:
            conditions.append("p.event_id = %(eid)s")
            params["eid"] = event_id

        if q and q.strip():
            conditions.append("(p.name ILIKE %(q)s OR p.email ILIKE %(q)s OR p.college ILIKE %(q)s)")
            params["q"] = f"%{q.strip()}%"

        where_clause = ("WHERE " + " AND ".join(conditions)) if conditions else ""
        query = f"""
            SELECT p.*, t.id AS ticket_id, t.status AS ticket_status, t.id_card_no,
                   t.email_sent_at, t.checked_in_at
            FROM participants p
            LEFT JOIN tickets t ON t.participant_id = p.id AND t.status IN ('issued', 'pending', 'checked_in')
            {where_clause}
            ORDER BY p.name ASC
            LIMIT %(limit)s OFFSET %(offset)s;
        """
        params["limit"] = limit
        params["offset"] = offset
        rows = conn.execute(query, params).fetchall()

        count_query = f"SELECT COUNT(*) AS total FROM participants p {where_clause};"
        total = conn.execute(count_query, params).fetchone()["total"]

    return {"total": total, "participants": [dict(r) for r in rows]}


@router.post("/api/participants/import")
def import_participants_csv(
    req: ImportTextRequest,
    staff: Annotated[StaffUser, Depends(require_role("admin"))],
):
    """
    Import participants from CSV content.
    Auto-issues a ticket for every newly inserted participant so the
    QR system works immediately after upload.
    Idempotent for duplicates (existing email/event pairs are skipped).
    Expected headers: name, email, college, photo_url
    """
    pool = get_pool()
    with pool.connection() as conn:
        target_event_id = req.event_id or _get_or_create_default_event(conn)

        # Ensure the signing key exists before we start inserting tickets.
        key_row = conn.execute(
            "SELECT key_id FROM signing_keys WHERE key_id = %s AND active = true;",
            (config.SIGNING_KEY_ID,),
        ).fetchone()
        if not key_row:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail={
                    "reason": "missing_signing_key",
                    "message": f"Signing key {config.SIGNING_KEY_ID} is not registered. "
                               "Wait for a cold start or register the key, then retry.",
                },
            )

        reader = csv.DictReader(io.StringIO(req.csv_content.strip()))
        valid_rows = 0
        duplicates = 0
        errors = 0
        issued_count = 0
        error_details = []

        for idx, row in enumerate(reader, start=1):
            name = (row.get("name") or row.get("Name") or "").strip()
            email = (row.get("email") or row.get("Email") or "").strip().lower()
            college = (row.get("college") or row.get("College") or "").strip()
            photo_url = (row.get("photo_url") or row.get("PhotoUrl") or "").strip()

            if not name or not email or "@" not in email:
                errors += 1
                error_details.append(f"Row {idx}: missing name or invalid email ({email})")
                continue

            pid = str(uuid.uuid4())
            try:
                cur = conn.execute(
                    """
                    INSERT INTO participants (id, event_id, name, email, college, photo_url)
                    VALUES (%s, %s, %s, %s, %s, %s)
                    ON CONFLICT (event_id, email) DO NOTHING
                    RETURNING id;
                    """,
                    (pid, target_event_id, name, email, college or None, photo_url or None),
                )
                inserted = cur.fetchone()

                if inserted is None:
                    # Email already exists for this event → skip
                    duplicates += 1
                    continue

                actual_pid = str(inserted["id"])

                # Auto-issue a ticket so the QR system works right away
                tid = str(uuid.uuid4())
                conn.execute(
                    """
                    INSERT INTO tickets (id, event_id, participant_id, status, key_id)
                    VALUES (%s, %s, %s, 'issued', %s);
                    """,
                    (tid, target_event_id, actual_pid, config.SIGNING_KEY_ID),
                )
                issued_count += 1
                valid_rows += 1
            except Exception as e:
                errors += 1
                error_details.append(f"Row {idx}: {str(e)}")

        conn.commit()

    return {
        "status": "completed",
        "imported": valid_rows,
        "duplicates": duplicates,
        "errors": errors,
        "issued": issued_count,
        "error_details": error_details,
    }

@router.post("/api/tickets/issue")
def issue_tickets(
    req: IssueRequest,
    staff: Annotated[StaffUser, Depends(require_role("admin"))],
):
    """
    Creates tickets for participants who have no active ticket (issued, pending, checked_in).
    Idempotent: running again issues 0 tickets.
    """
    pool = get_pool()
    with pool.connection() as conn:
        target_event_id = req.event_id or _get_or_create_default_event(conn)

        unissued = conn.execute(
            """
            SELECT p.id
            FROM participants p
            WHERE p.event_id = %(eid)s
              AND NOT EXISTS (
                  SELECT 1 FROM tickets t
                  WHERE t.participant_id = p.id
                    AND t.status IN ('issued', 'pending', 'checked_in')
              );
            """,
            {"eid": target_event_id},
        ).fetchall()

        issued_count = 0
        new_tickets = []
        for r in unissued:
            tid = str(uuid.uuid4())
            conn.execute(
                """
                INSERT INTO tickets (id, event_id, participant_id, status, key_id)
                VALUES (%s, %s, %s, 'issued', %s);
                """,
                (tid, target_event_id, str(r["id"]), config.SIGNING_KEY_ID),
            )
            issued_count += 1
            new_tickets.append(tid)

        conn.commit()

    return {
        "status": "success",
        "issued_count": issued_count,
        "tickets": new_tickets,
    }


@router.get("/api/tickets/export-csv")
def export_tickets_csv(
    staff: Annotated[StaffUser, Depends(require_role("admin"))],
    event_id: str | None = None,
):
    """
    Export participants with their QR URL and token, formatted for
    direct sharing with attendees. The QR URL is the participant's
    single-use digital pass — send it once, privately, to each person.
    """
    priv_key = private_key_from_seed(config.SIGNING_PRIVATE_KEY)

    pool = get_pool()
    with pool.connection() as conn:
        ev_filter = "WHERE p.event_id = %(eid)s" if event_id else ""
        params = {"eid": event_id} if event_id else {}

        rows = conn.execute(
            f"""
            SELECT p.id AS participant_id, p.name, p.email, p.college,
                   t.id AS ticket_id, t.key_id, t.status,
                   e.name AS event_name, e.starts_at, e.ends_at
            FROM participants p
            JOIN tickets t ON t.participant_id = p.id
                AND t.status IN ('issued', 'pending', 'checked_in')
            JOIN events e ON t.event_id = e.id
            {ev_filter}
            ORDER BY p.name ASC;
            """,
            params,
        ).fetchall()

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow([
        "participant_id",
        "name",
        "email",
        "college",
        "event_name",
        "ticket_id",
        "status",
        "qr_url",
        "qr_token",
        "notice",
    ])

    NOTICE = (
        "This is your single-use entry pass. Do not share it with anyone. "
        "It will only work once at the check-in gate."
    )

    for r in rows:
        tid = r["ticket_id"]
        kid = r["key_id"]
        token = sign_token(priv_key, kid, tid)
        qr_url = build_qr_url(config.PUBLIC_BASE_URL, token)
        writer.writerow([
            str(r["participant_id"]),
            r["name"],
            r["email"],
            r["college"] or "",
            r["event_name"],
            str(tid),
            r["status"],
            qr_url,
            token,
            NOTICE,
        ])

    csv_data = output.getvalue()
    return Response(
        content=csv_data,
        media_type="text/csv",
        headers={
            "Content-Disposition": 'attachment; filename="participants_qr_pass_urls.csv"'
        },
    )

@router.post("/api/emails/send")
def send_emails(
    req: SendEmailRequest,
    staff: Annotated[StaffUser, Depends(require_role("admin"))],
):
    """
    Send emails containing QR codes (mocked).
    """
    pool = get_pool()
    priv_key = private_key_from_seed(config.SIGNING_PRIVATE_KEY)

    with pool.connection() as conn:
        target_event_id = req.event_id or _get_or_create_default_event(conn)

        cond = "t.event_id = %(eid)s AND t.status IN ('issued', 'pending', 'checked_in')"
        if not req.force_resend:
            cond += " AND t.email_sent_at IS NULL"

        rows = conn.execute(
            f"""
            SELECT t.id AS ticket_id, t.key_id, p.name, p.email
            FROM tickets t
            JOIN participants p ON t.participant_id = p.id
            WHERE {cond}
            LIMIT 500;
            """,
            {"eid": target_event_id},
        ).fetchall()

        sent_count = 0
        for r in rows:
            tid = r["ticket_id"]
            kid = r["key_id"]
            token = sign_token(priv_key, kid, tid)
            conn.execute(
                "UPDATE tickets SET email_sent_at = now() WHERE id = %s;",
                (str(tid),),
            )
            sent_count += 1

        conn.commit()

    return {
        "status": "completed",
        "sent_count": sent_count,
        "message": f"Successfully processed {sent_count} email notifications",
    }


@router.get("/api/tickets/{ticket_id}/qr.png")
def get_ticket_qr_png(ticket_id: str):
    """Generate and return PNG QR code for a ticket."""
    try:
        pool = get_pool()
        with pool.connection() as conn:
            row = conn.execute(
                "SELECT id::text AS id, key_id FROM tickets WHERE id = %s;",
                (ticket_id,),
            ).fetchone()

        if not row:
            raise HTTPException(status_code=404, detail="Ticket not found")

        ticket_uuid = uuid.UUID(str(row["id"]))
        key_id = int(row["key_id"])

        priv_key = private_key_from_seed(config.SIGNING_PRIVATE_KEY)
        token = sign_token(priv_key, key_id, ticket_uuid)
        url = build_qr_url(config.PUBLIC_BASE_URL, token)
        png_bytes = generate_qr_png_bytes(url)

        return Response(content=png_bytes, media_type="image/png")
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(
            status_code=500,
            detail={"reason": "qr_generation_failed", "message": str(e)},
        )


@router.get("/api/tickets/{ticket_id}/token")
def get_ticket_token(ticket_id: str):
    """
    Return the signed QR token and URL for a ticket as JSON.
    Used by the admin panel to display / copy the token manually.
    """
    try:
        pool = get_pool()
        with pool.connection() as conn:
            row = conn.execute(
                "SELECT id::text AS id, key_id, status FROM tickets WHERE id = %s;",
                (ticket_id,),
            ).fetchone()

        if not row:
            raise HTTPException(status_code=404, detail="Ticket not found")

        ticket_uuid = uuid.UUID(str(row["id"]))
        key_id = int(row["key_id"])

        priv_key = private_key_from_seed(config.SIGNING_PRIVATE_KEY)
        token = sign_token(priv_key, key_id, ticket_uuid)
        url = build_qr_url(config.PUBLIC_BASE_URL, token)

        return {
            "ticket_id": str(row["id"]),
            "key_id": key_id,
            "status": row["status"],
            "token": token,
            "url": url,
        }
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(
            status_code=500,
            detail={"reason": "token_generation_failed", "message": str(e)},
        )

@router.post("/api/tickets/{ticket_id}/revoke")
def revoke_ticket_endpoint(
    ticket_id: str,
    req: ReasonRequest,
    staff: Annotated[StaffUser, Depends(require_role("admin"))],
):
    if not req.reason or not req.reason.strip():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"reason": "missing_reason", "message": "Reason is required to revoke a ticket"},
        )

    pool = get_pool()
    with pool.connection() as conn:
        res = revoke_ticket(conn, ticket_id, staff.id, req.reason)
        conn.commit()

    if res.success:
        return {"status": "revoked", "ticket": res.data.get("ticket")}

    if res.reason == "not_found":
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail={"reason": "not_found"})

    raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail={"reason": res.reason})


@router.post("/api/tickets/{ticket_id}/reissue")
def reissue_ticket_endpoint(
    ticket_id: str,
    req: ReasonRequest,
    staff: Annotated[StaffUser, Depends(require_role("admin"))],
):
    if not req.reason or not req.reason.strip():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"reason": "missing_reason", "message": "Reason is required to reissue a ticket"},
        )

    pool = get_pool()
    with pool.connection() as conn:
        res = reissue_ticket(conn, ticket_id, staff.id, req.reason, key_id=config.SIGNING_KEY_ID)
        conn.commit()

    if res.success:
        return {"status": "reissued", "new_ticket": res.data.get("new_ticket")}

    if res.reason == "not_found":
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail={"reason": "not_found"})

    raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail={"reason": res.reason})


@router.get("/api/stats")
def get_event_stats(
    staff: Annotated[StaffUser, Depends(require_role("admin"))],
    event_id: str | None = None,
):
    pool = get_pool()
    with pool.connection() as conn:
        ev_filter = "WHERE event_id = %(eid)s" if event_id else ""
        params = {"eid": event_id} if event_id else {}

        counts = conn.execute(
            f"""
            SELECT
                COUNT(*) FILTER (WHERE status = 'issued') AS issued,
                COUNT(*) FILTER (WHERE status = 'pending') AS pending,
                COUNT(*) FILTER (WHERE status = 'checked_in') AS checked_in,
                COUNT(*) FILTER (WHERE status = 'revoked') AS revoked,
                COUNT(*) AS total_tickets
            FROM tickets
            {ev_filter};
            """,
            params,
        ).fetchone()

        part_count = conn.execute(
            f"SELECT COUNT(*) AS total_participants FROM participants {ev_filter};",
            params,
        ).fetchone()

    return {
        "participants": part_count["total_participants"],
        "tickets": {
            "total": counts["total_tickets"],
            "issued": counts["issued"],
            "pending": counts["pending"],
            "checked_in": counts["checked_in"],
            "revoked": counts["revoked"],
        },
    }


@router.get("/api/scan-log")
def get_scan_logs(
    staff: Annotated[StaffUser, Depends(require_role("volunteer"))],
    limit: int = 50,
    offset: int = 0,
):
    pool = get_pool()
    with pool.connection() as conn:
        rows = conn.execute(
            """
            SELECT sl.*, s.name AS staff_name, p.name AS participant_name
            FROM scan_log sl
            LEFT JOIN staff s ON sl.staff_id = s.id
            LEFT JOIN tickets t ON sl.ticket_id = t.id
            LEFT JOIN participants p ON t.participant_id = p.id
            ORDER BY sl.scanned_at DESC
            LIMIT %s OFFSET %s;
            """,
            (limit, offset),
        ).fetchall()

    return {"logs": [dict(r) for r in rows]}


@router.post("/api/participants/create")
def create_participant(
    req: CreateParticipantRequest,
    staff: Annotated[StaffUser, Depends(require_role("admin"))],
):
    name = req.name.strip()
    email = req.email.strip().lower()
    if not name or not email or "@" not in email:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"reason": "invalid_input", "message": "Valid name and email are required"},
        )

    pool = get_pool()
    with pool.connection() as conn:
        target_event_id = req.event_id or _get_or_create_default_event(conn)

        pid = str(uuid.uuid4())
        try:
            conn.execute(
                """
                INSERT INTO participants (id, event_id, name, email, college, photo_url)
                VALUES (%s, %s, %s, %s, %s, %s);
                """,
                (pid, target_event_id, name, email, req.college or None, req.photo_url or None),
            )
        except psycopg.errors.UniqueViolation:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={"reason": "duplicate_email",
                        "message": "A participant with this email already exists for this event"},
            )

        # Verify signing key exists before inserting the ticket
        key_row = conn.execute(
            "SELECT key_id FROM signing_keys WHERE key_id = %s AND active = true;",
            (config.SIGNING_KEY_ID,),
        ).fetchone()
        if not key_row:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail={
                    "reason": "missing_signing_key",
                    "message": f"Signing key {config.SIGNING_KEY_ID} is not registered in the DB. "
                               "Wait for a cold start or run the key registration script.",
                },
            )

        tid = str(uuid.uuid4())
        try:
            conn.execute(
                """
                INSERT INTO tickets (id, event_id, participant_id, status, key_id)
                VALUES (%s, %s, %s, 'issued', %s);
                """,
                (tid, target_event_id, pid, config.SIGNING_KEY_ID),
            )
        except psycopg.errors.UniqueViolation as e:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={"reason": "ticket_conflict",
                        "message": f"Ticket conflict: {e}"},
            )
        except psycopg.errors.ForeignKeyViolation as e:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={"reason": "foreign_key_violation",
                        "message": f"Foreign key violation: {e}"},
            )

        if req.send_email:
            conn.execute("UPDATE tickets SET email_sent_at = now() WHERE id = %s;", (tid,))

        conn.commit()

    priv_key = private_key_from_seed(config.SIGNING_PRIVATE_KEY)
    token = sign_token(priv_key, int(config.SIGNING_KEY_ID), uuid.UUID(str(tid)))
    qr_url = build_qr_url(config.PUBLIC_BASE_URL, token)

    return {
        "status": "created",
        "participant": {"id": pid, "name": name, "email": email, "college": req.college or None},
        "ticket": {"id": tid, "status": "issued"},
        "token": token,
        "qr_url": qr_url,
        "qr_png_url": f"/api/tickets/{tid}/qr.png",
        "email_sent": req.send_email,
    }

@router.post("/api/users")
def create_staff(
    req: CreateStaffRequest,
    staff: Annotated[StaffUser, Depends(require_role("admin"))],
):
    """Create a single staff member (volunteer/supervisor/admin)."""
    name = req.name.strip()
    email = req.email.strip().lower()
    if not name or not email or "@" not in email:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"reason": "invalid_input", "message": "Valid name and email are required"},
        )
    if len(req.password) < 6:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"reason": "weak_password", "message": "Password must be at least 6 characters"},
        )
    if req.role not in ("volunteer", "supervisor", "admin"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"reason": "invalid_role"},
        )

    sid = str(uuid.uuid4())
    pool = get_pool()
    with pool.connection() as conn:
        try:
            conn.execute(
                """
                INSERT INTO staff (id, name, email, password_hash, role)
                VALUES (%s, %s, %s, %s, %s);
                """,
                (sid, name, email, hash_password(req.password), req.role),
            )
            conn.commit()
        except psycopg.errors.UniqueViolation:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={"reason": "duplicate_email",
                        "message": "A staff member with this email already exists"},
            )

    return {
        "status": "created",
        "staff": {"id": sid, "name": name, "email": email, "role": req.role},
    }


@router.get("/api/users")
def list_staff(
    staff: Annotated[StaffUser, Depends(require_role("admin"))],
):
    """List all staff members (volunteers, supervisors, admins)."""
    pool = get_pool()
    with pool.connection() as conn:
        rows = conn.execute(
            """
            SELECT id, name, email, role, active
            FROM staff
            ORDER BY
                CASE role
                    WHEN 'admin' THEN 1
                    WHEN 'supervisor' THEN 2
                    ELSE 3
                END,
                name ASC;
            """
        ).fetchall()
    return {"staff": [dict(r) for r in rows]}


@router.patch("/api/users/{user_id}")
def update_staff(
    user_id: str,
    req: UpdateStaffRequest,
    staff: Annotated[StaffUser, Depends(require_role("admin"))],
):
    """
    Update role / active flag / name. Admin only.
    Guards:
      - Cannot demote or deactivate the last active admin.
    """
    pool = get_pool()
    with pool.connection() as conn:
        target = conn.execute(
            "SELECT id, role, active FROM staff WHERE id = %s;",
            (user_id,),
        ).fetchone()

        if not target:
            raise HTTPException(status_code=404, detail={"reason": "not_found"})

        new_role = req.role if req.role is not None else target["role"]
        new_active = req.active if req.active is not None else target["active"]

        # Guard: don't leave the system without an active admin
        if target["role"] == "admin" and (new_role != "admin" or new_active is False):
            admin_count = conn.execute(
                "SELECT COUNT(*) AS n FROM staff WHERE role = 'admin' AND active = true;"
            ).fetchone()["n"]
            if admin_count <= 1:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail={
                        "reason": "last_admin",
                        "message": "Cannot demote or deactivate the last active admin.",
                    },
                )

        sets: list[str] = []
        params: dict = {"id": user_id}
        if req.role is not None:
            sets.append("role = %(role)s")
            params["role"] = req.role
        if req.active is not None:
            sets.append("active = %(active)s")
            params["active"] = req.active
        if req.name is not None and req.name.strip():
            sets.append("name = %(name)s")
            params["name"] = req.name.strip()

        if not sets:
            return {"status": "noop"}

        conn.execute(
            f"UPDATE staff SET {', '.join(sets)} WHERE id = %(id)s;",
            params,
        )
        conn.commit()

        updated = conn.execute(
            "SELECT id, name, email, role, active FROM staff WHERE id = %s;",
            (user_id,),
        ).fetchone()

    return {"status": "updated", "staff": dict(updated)}


@router.delete("/api/users/{user_id}")
def delete_staff(
    user_id: str,
    staff: Annotated[StaffUser, Depends(require_role("admin"))],
):
    """
    Delete a staff member. Admin only.
    Guards:
      - Cannot delete yourself.
      - Cannot delete the last active admin.
    Preserves audit history by nulling staff references in scan_log and tickets.
    """
    if user_id == staff.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "reason": "cannot_delete_self",
                "message": "You can't delete your own account.",
            },
        )

    pool = get_pool()
    with pool.connection() as conn:
        target = conn.execute(
            "SELECT id, role, active FROM staff WHERE id = %s;",
            (user_id,),
        ).fetchone()

        if not target:
            raise HTTPException(status_code=404, detail={"reason": "not_found"})

        if target["role"] == "admin" and target["active"]:
            admin_count = conn.execute(
                "SELECT COUNT(*) AS n FROM staff WHERE role = 'admin' AND active = true;"
            ).fetchone()["n"]
            if admin_count <= 1:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail={
                        "reason": "last_admin",
                        "message": "Cannot delete the last active admin.",
                    },
                )

        # Preserve audit history: null out staff references rather than
        # deleting logged events.
        conn.execute("UPDATE scan_log SET staff_id = NULL WHERE staff_id = %s;", (user_id,))
        conn.execute("UPDATE tickets SET pending_by = NULL WHERE pending_by = %s;", (user_id,))
        conn.execute("UPDATE tickets SET checked_in_by = NULL WHERE checked_in_by = %s;", (user_id,))

        conn.execute("DELETE FROM staff WHERE id = %s;", (user_id,))
        conn.commit()

    return {"status": "deleted"}

# ─── Participant deletion ────────────────────────────────────────

class BulkDeleteRequest(BaseModel):
    ids: list[str]


@router.delete("/api/participants/{participant_id}")
def delete_participant(
    participant_id: str,
    staff: Annotated[StaffUser, Depends(require_role("admin"))],
):
    """
    Delete a participant and all their tickets.
    Detaches scan_log entries (audit trail keeps the row but loses the ticket link).
    """
    pool = get_pool()
    with pool.connection() as conn:
        row = conn.execute(
            "SELECT id, name, email FROM participants WHERE id = %s;",
            (participant_id,),
        ).fetchone()

        if not row:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={"reason": "not_found", "message": "Participant not found"},
            )

        # Detach scan_log entries (ticket_id has no FK, but null it for cleanliness)
        conn.execute(
            """
            UPDATE scan_log
            SET ticket_id = NULL
            WHERE ticket_id IN (
                SELECT id FROM tickets WHERE participant_id = %s
            );
            """,
            (participant_id,),
        )

        # Delete all tickets for this participant
        conn.execute("DELETE FROM tickets WHERE participant_id = %s;", (participant_id,))

        # Delete the participant
        conn.execute("DELETE FROM participants WHERE id = %s;", (participant_id,))

        conn.commit()

    return {
        "status": "deleted",
        "participant": {"id": str(row["id"]), "name": row["name"], "email": row["email"]},
    }


@router.post("/api/participants/delete-bulk")
def delete_participants_bulk(
    req: BulkDeleteRequest,
    staff: Annotated[StaffUser, Depends(require_role("admin"))],
):
    """Bulk delete participants by ID. Returns count of deleted rows."""
    if not req.ids:
        return {"status": "noop", "deleted": 0, "not_found": []}

    pool = get_pool()
    with pool.connection() as conn:
        # Which ones exist?
        existing = conn.execute(
            "SELECT id FROM participants WHERE id = ANY(%s::uuid[]);",
            (req.ids,),
        ).fetchall()
        existing_ids = [str(r["id"]) for r in existing]
        missing = [i for i in req.ids if i not in existing_ids]

        if existing_ids:
            # Detach scan_log for the tickets we're about to remove
            conn.execute(
                """
                UPDATE scan_log
                SET ticket_id = NULL
                WHERE ticket_id IN (
                    SELECT id FROM tickets WHERE participant_id = ANY(%s::uuid[])
                );
                """,
                (existing_ids,),
            )
            # Delete tickets
            conn.execute(
                "DELETE FROM tickets WHERE participant_id = ANY(%s::uuid[]);",
                (existing_ids,),
            )
            # Delete participants
            conn.execute(
                "DELETE FROM participants WHERE id = ANY(%s::uuid[]);",
                (existing_ids,),
            )
            conn.commit()

    return {
        "status": "completed",
        "deleted": len(existing_ids),
        "not_found": missing,
    }