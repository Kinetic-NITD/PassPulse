"""Admin routes: import, issue, email, revoke, reissue, export-csv, qr-png, stats, scan-log."""

import csv
import io
import uuid
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel

from app import config
from app.auth import require_role, StaffUser
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
    Expected headers: name, email, college, photo_url
    Gracefully skips invalid rows and duplicates.
    """
    pool = get_pool()
    with pool.connection() as conn:
        target_event_id = req.event_id or _get_or_create_default_event(conn)

        reader = csv.DictReader(io.StringIO(req.csv_content.strip()))
        valid_rows = 0
        duplicates = 0
        errors = 0
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
                conn.execute(
                    """
                    INSERT INTO participants (id, event_id, name, email, college, photo_url)
                    VALUES (%s, %s, %s, %s, %s, %s)
                    ON CONFLICT (event_id, email) DO NOTHING;
                    """,
                    (pid, target_event_id, name, email, college or None, photo_url or None),
                )
                if conn.execute("SELECT 1 FROM participants WHERE id = %s", (pid,)).fetchone():
                    valid_rows += 1
                else:
                    duplicates += 1
            except Exception as e:
                errors += 1
                error_details.append(f"Row {idx}: {str(e)}")

        conn.commit()

    return {
        "status": "completed",
        "imported": valid_rows,
        "duplicates": duplicates,
        "errors": errors,
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

        # Participants with no active tickets
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
    Export participants with their deterministic secret QR token and URL.
    Format: participant_id, name, email, college, ticket_id, qr_token, qr_url
    """
    priv_key = private_key_from_seed(config.SIGNING_PRIVATE_KEY)

    pool = get_pool()
    with pool.connection() as conn:
        ev_filter = "WHERE p.event_id = %(eid)s" if event_id else ""
        params = {"eid": event_id} if event_id else {}

        rows = conn.execute(
            f"""
            SELECT p.id AS participant_id, p.name, p.email, p.college,
                   t.id AS ticket_id, t.key_id, t.status
            FROM participants p
            JOIN tickets t ON t.participant_id = p.id AND t.status IN ('issued', 'pending', 'checked_in')
            {ev_filter}
            ORDER BY p.name ASC;
            """,
            params,
        ).fetchall()

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["name", "email", "college", "ticket_id", "status", "qr_token", "qr_url"])

    for r in rows:
        tid = r["ticket_id"]
        kid = r["key_id"]
        token = sign_token(priv_key, kid, tid)
        qr_url = build_qr_url(config.PUBLIC_BASE_URL, token)
        writer.writerow([r["name"], r["email"], r["college"] or "", str(tid), r["status"], token, qr_url])

    csv_data = output.getvalue()
    return Response(
        content=csv_data,
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="participants_qr_tokens.csv"'},
    )


@router.post("/api/emails/send")
def send_emails(
    req: SendEmailRequest,
    staff: Annotated[StaffUser, Depends(require_role("admin"))],
):
    """
    Send emails containing QR codes.
    Mocked as requested by user; sets email_sent_at in DB.
    Resending sends the exact same QR code.
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
            # Deterministic token (same on resend)
            token = sign_token(priv_key, kid, tid)
            # Update email_sent_at
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
    pool = get_pool()
    with pool.connection() as conn:
        row = conn.execute(
            "SELECT id, key_id FROM tickets WHERE id = %s;",
            (ticket_id,),
        ).fetchone()

    if not row:
        raise HTTPException(status_code=404, detail="Ticket not found")

    priv_key = private_key_from_seed(config.SIGNING_PRIVATE_KEY)
    token = sign_token(priv_key, row["key_id"], row["id"])
    url = build_qr_url(config.PUBLIC_BASE_URL, token)
    png_bytes = generate_qr_png_bytes(url)

    return Response(content=png_bytes, media_type="image/png")


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
    staff: Annotated[StaffUser, Depends(require_role("volunteer"))],
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
