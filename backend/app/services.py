"""
PassPulse Ticket State Machine and Services.

Strictly follows the state machine specification with atomic SQL queries.
"""

import json
import uuid
from datetime import datetime, timezone
from typing import Any

import psycopg
from psycopg.rows import dict_row


class ServiceResult:
    def __init__(self, success: bool, reason: str = "", details: dict[str, Any] | None = None, data: dict[str, Any] | None = None):
        self.success = success
        self.reason = reason
        self.details = details or {}
        self.data = data or {}

    def to_dict(self) -> dict[str, Any]:
        res: dict[str, Any] = {
            "success": self.success,
            "reason": self.reason,
            "details": self.details,
        }
        if self.data:
            res["data"] = self.data
        return res


def log_scan_event(
    conn: psycopg.Connection,
    ticket_id: uuid.UUID | str | None,
    event_id: uuid.UUID | str | None,
    staff_id: uuid.UUID | str | None,
    action: str,
    result: str,
    detail: dict[str, Any] | None = None,
) -> None:
    """Record an action in scan_log in the current transaction."""
    tid = str(ticket_id) if ticket_id else None
    eid = str(event_id) if event_id else None
    sid = str(staff_id) if staff_id else None
    detail_json = json.dumps(detail) if detail is not None else None

    conn.execute(
        """
        INSERT INTO scan_log (ticket_id, event_id, staff_id, action, result, detail)
        VALUES (%s, %s, %s, %s, %s, %s)
        """,
        (tid, eid, sid, action, result, detail_json),
    )


def claim_ticket(
    conn: psycopg.Connection,
    ticket_id: uuid.UUID | str,
    staff_id: uuid.UUID | str,
    lease_seconds: int = 60,
) -> ServiceResult:
    """
    Claim lease on a ticket (volunteer scan).
    Same volunteer re-scanning refreshes the lease.
    """
    tid = str(ticket_id)
    sid = str(staff_id)

    # Core atomic SQL
    cur = conn.execute(
        """
        UPDATE tickets
        SET status='pending', pending_by=%(staff)s,
            pending_until = now() + make_interval(secs => %(lease)s)
        WHERE id=%(id)s
          AND ( status='issued'
             OR (status='pending' AND (pending_by=%(staff)s OR pending_until < now())) )
        RETURNING *;
        """,
        {"id": tid, "staff": sid, "lease": lease_seconds},
    )
    row = cur.fetchone()

    if row:
        event_id = row["event_id"]
        pending_until_iso = row["pending_until"].isoformat() if row.get("pending_until") else None
        log_scan_event(
            conn,
            ticket_id=tid,
            event_id=event_id,
            staff_id=sid,
            action="claim",
            result="success",
            detail={"pending_until": pending_until_iso},
        )

        # Get participant and event details
        info_cur = conn.execute(
            """
            SELECT p.name AS participant_name, p.email, p.college, p.photo_url, e.name AS event_name
            FROM participants p
            JOIN tickets t ON t.participant_id = p.id
            JOIN events e ON t.event_id = e.id
            WHERE t.id = %(id)s;
            """,
            {"id": tid},
        )
        info = info_cur.fetchone() or {}

        data = {
            "ticket": dict(row),
            "participant": {
                "name": info.get("participant_name"),
                "email": info.get("email"),
                "college": info.get("college"),
                "photo_url": info.get("photo_url"),
            },
            "event": {
                "id": str(event_id),
                "name": info.get("event_name"),
            },
            "lease_expiry": pending_until_iso,
        }
        return ServiceResult(success=True, reason="claimed", data=data)

    # 0 rows returned: follow-up SELECT to decide failure reason
    sel_cur = conn.execute(
        """
        SELECT t.*,
               sp.name AS pending_staff_name,
               sc.name AS checked_in_staff_name,
               p.name AS participant_name
        FROM tickets t
        LEFT JOIN staff sp ON t.pending_by = sp.id
        LEFT JOIN staff sc ON t.checked_in_by = sc.id
        LEFT JOIN participants p ON t.participant_id = p.id
        WHERE t.id = %(id)s;
        """,
        {"id": tid},
    )
    t = sel_cur.fetchone()

    if not t:
        log_scan_event(conn, ticket_id=tid, event_id=None, staff_id=sid, action="claim", result="not_found")
        return ServiceResult(success=False, reason="not_found")

    event_id = t["event_id"]
    status = t["status"]

    if status == "checked_in":
        details = {
            "name": t.get("participant_name"),
            "checked_in_at": t["checked_in_at"].isoformat() if t.get("checked_in_at") else None,
            "staff_id": str(t["checked_in_by"]) if t.get("checked_in_by") else None,
            "staff_name": t.get("checked_in_staff_name"),
            "id_card_no": t.get("id_card_no"),
        }
        log_scan_event(conn, ticket_id=tid, event_id=event_id, staff_id=sid, action="claim", result="already_checked_in", detail=details)
        return ServiceResult(success=False, reason="already_checked_in", details=details)

    if status == "revoked":
        details = {"revoked_reason": t.get("revoked_reason")}
        log_scan_event(conn, ticket_id=tid, event_id=event_id, staff_id=sid, action="claim", result="revoked", detail=details)
        return ServiceResult(success=False, reason="revoked", details=details)

    if status == "pending":
        # Another volunteer holds active lease
        now = datetime.now(timezone.utc)
        pend_until = t.get("pending_until")
        seconds_left = max(0, int((pend_until - now).total_seconds())) if pend_until else 0
        details = {
            "staff_id": str(t.get("pending_by")),
            "staff_name": t.get("pending_staff_name"),
            "seconds_left": seconds_left,
        }
        log_scan_event(conn, ticket_id=tid, event_id=event_id, staff_id=sid, action="claim", result="pending_other", detail=details)
        return ServiceResult(success=False, reason="pending_other", details=details)

    log_scan_event(conn, ticket_id=tid, event_id=event_id, staff_id=sid, action="claim", result="invalid_state")
    return ServiceResult(success=False, reason="invalid_state")


def confirm_ticket(
    conn: psycopg.Connection,
    ticket_id: uuid.UUID | str,
    staff_id: uuid.UUID | str,
    id_card_no: str,
) -> ServiceResult:
    """
    Confirm check-in for a pending ticket.
    Assigns id_card_no, changes status to 'checked_in'.
    A unique violation on id_card_no rolls back and leaves ticket pending (returns 409 id_card_taken).
    """
    tid = str(ticket_id)
    sid = str(staff_id)
    card = id_card_no.strip()

    # Use SQL SAVEPOINT so unique violation on id_card_no rolls back and leaves ticket pending
    conn.execute("SAVEPOINT confirm_sp;")
    try:
        cur = conn.execute(
            """
            UPDATE tickets
            SET status='checked_in', checked_in_at=now(), checked_in_by=%(staff)s,
                id_card_no=%(card)s, pending_by=NULL, pending_until=NULL
            WHERE id=%(id)s AND status='pending' AND pending_by=%(staff)s
            RETURNING *;
            """,
            {"id": tid, "staff": sid, "card": card},
        )
        row = cur.fetchone()
        conn.execute("RELEASE SAVEPOINT confirm_sp;")
    except psycopg.errors.UniqueViolation:
        conn.execute("ROLLBACK TO SAVEPOINT confirm_sp;")
        log_scan_event(
            conn,
            ticket_id=tid,
            event_id=None,
            staff_id=sid,
            action="confirm",
            result="id_card_taken",
            detail={"id_card_no": card},
        )
        return ServiceResult(success=False, reason="id_card_taken", details={"id_card_no": card})


    if row:
        event_id = row["event_id"]
        log_scan_event(
            conn,
            ticket_id=tid,
            event_id=event_id,
            staff_id=sid,
            action="confirm",
            result="success",
            detail={"id_card_no": card},
        )
        return ServiceResult(success=True, reason="checked_in", data={"ticket": dict(row)})

    # 0 rows returned: follow-up SELECT
    sel_cur = conn.execute(
        """
        SELECT t.*,
               sp.name AS pending_staff_name,
               sc.name AS checked_in_staff_name,
               p.name AS participant_name
        FROM tickets t
        LEFT JOIN staff sp ON t.pending_by = sp.id
        LEFT JOIN staff sc ON t.checked_in_by = sc.id
        LEFT JOIN participants p ON t.participant_id = p.id
        WHERE t.id = %(id)s;
        """,
        {"id": tid},
    )
    t = sel_cur.fetchone()

    if not t:
        log_scan_event(conn, ticket_id=tid, event_id=None, staff_id=sid, action="confirm", result="not_found")
        return ServiceResult(success=False, reason="not_found")

    event_id = t["event_id"]
    status = t["status"]

    if status == "checked_in":
        details = {
            "name": t.get("participant_name"),
            "checked_in_at": t["checked_in_at"].isoformat() if t.get("checked_in_at") else None,
            "staff_id": str(t["checked_in_by"]) if t.get("checked_in_by") else None,
            "staff_name": t.get("checked_in_staff_name"),
            "id_card_no": t.get("id_card_no"),
        }
        log_scan_event(conn, ticket_id=tid, event_id=event_id, staff_id=sid, action="confirm", result="already_checked_in", detail=details)
        return ServiceResult(success=False, reason="already_checked_in", details=details)

    if status == "revoked":
        details = {"revoked_reason": t.get("revoked_reason")}
        log_scan_event(conn, ticket_id=tid, event_id=event_id, staff_id=sid, action="confirm", result="revoked", detail=details)
        return ServiceResult(success=False, reason="revoked", details=details)

    if status == "issued":
        # Was never claimed or lease expired and was claimed/reset
        log_scan_event(conn, ticket_id=tid, event_id=event_id, staff_id=sid, action="confirm", result="not_pending")
        return ServiceResult(success=False, reason="not_claimed")

    if status == "pending" and str(t.get("pending_by")) != sid:
        details = {
            "staff_id": str(t.get("pending_by")),
            "staff_name": t.get("pending_staff_name"),
        }
        log_scan_event(conn, ticket_id=tid, event_id=event_id, staff_id=sid, action="confirm", result="pending_other", detail=details)
        return ServiceResult(success=False, reason="pending_other", details=details)

    log_scan_event(conn, ticket_id=tid, event_id=event_id, staff_id=sid, action="confirm", result="invalid_state")
    return ServiceResult(success=False, reason="invalid_state")


def cancel_ticket(
    conn: psycopg.Connection,
    ticket_id: uuid.UUID | str,
    staff_id: uuid.UUID | str,
) -> ServiceResult:
    """
    Cancel pending lease on a ticket. Only the holding volunteer can cancel.
    """
    tid = str(ticket_id)
    sid = str(staff_id)

    cur = conn.execute(
        """
        UPDATE tickets SET status='issued', pending_by=NULL, pending_until=NULL
        WHERE id=%(id)s AND status='pending' AND pending_by=%(staff)s
        RETURNING *;
        """,
        {"id": tid, "staff": sid},
    )
    row = cur.fetchone()

    if row:
        log_scan_event(conn, ticket_id=tid, event_id=row["event_id"], staff_id=sid, action="cancel", result="success")
        return ServiceResult(success=True, reason="cancelled")

    # 0 rows returned
    sel_cur = conn.execute("SELECT * FROM tickets WHERE id = %(id)s;", {"id": tid})
    t = sel_cur.fetchone()
    if not t:
        log_scan_event(conn, ticket_id=tid, event_id=None, staff_id=sid, action="cancel", result="not_found")
        return ServiceResult(success=False, reason="not_found")

    event_id = t["event_id"]
    status = t["status"]

    if status == "checked_in":
        log_scan_event(conn, ticket_id=tid, event_id=event_id, staff_id=sid, action="cancel", result="already_checked_in")
        return ServiceResult(success=False, reason="already_checked_in")

    if status == "pending" and str(t.get("pending_by")) != sid:
        log_scan_event(conn, ticket_id=tid, event_id=event_id, staff_id=sid, action="cancel", result="pending_other")
        return ServiceResult(success=False, reason="pending_other")

    log_scan_event(conn, ticket_id=tid, event_id=event_id, staff_id=sid, action="cancel", result="not_pending")
    return ServiceResult(success=False, reason="not_pending")


def revoke_ticket(
    conn: psycopg.Connection,
    ticket_id: uuid.UUID | str,
    staff_id: uuid.UUID | str,
    reason: str,
) -> ServiceResult:
    """
    Revoke an issued or pending ticket. Checked_in tickets cannot be revoked.
    """
    tid = str(ticket_id)
    sid = str(staff_id)

    # Check state first or atomic update
    cur = conn.execute(
        """
        UPDATE tickets
        SET status='revoked', revoked_reason=%(reason)s, pending_by=NULL, pending_until=NULL
        WHERE id=%(id)s AND status IN ('issued', 'pending')
        RETURNING *;
        """,
        {"id": tid, "reason": reason},
    )
    row = cur.fetchone()

    if row:
        log_scan_event(conn, ticket_id=tid, event_id=row["event_id"], staff_id=sid, action="revoke", result="success", detail={"reason": reason})
        return ServiceResult(success=True, reason="revoked", data={"ticket": dict(row)})

    # Follow up
    sel = conn.execute("SELECT * FROM tickets WHERE id = %(id)s;", {"id": tid}).fetchone()
    if not sel:
        return ServiceResult(success=False, reason="not_found")
    if sel["status"] == "checked_in":
        return ServiceResult(success=False, reason="already_checked_in")
    if sel["status"] == "revoked":
        return ServiceResult(success=False, reason="already_revoked")

    return ServiceResult(success=False, reason="invalid_state")


def reissue_ticket(
    conn: psycopg.Connection,
    ticket_id: uuid.UUID | str,
    staff_id: uuid.UUID | str,
    reason: str,
    key_id: int | None = None,
) -> ServiceResult:
    """
    Reissue a ticket in ONE transaction and in this order:
    (1) mark old ticket revoked
    (2) insert new ticket with a NEW id
    (3) set old.replaced_by = new id
    Refuse reissue if the old ticket is checked_in.
    """
    tid = str(ticket_id)
    sid = str(staff_id)

    # 1. Select for update
    sel = conn.execute(
        "SELECT * FROM tickets WHERE id = %(id)s FOR UPDATE;",
        {"id": tid},
    ).fetchone()

    if not sel:
        return ServiceResult(success=False, reason="not_found")

    if sel["status"] == "checked_in":
        log_scan_event(conn, ticket_id=tid, event_id=sel["event_id"], staff_id=sid, action="reissue", result="refused_checked_in")
        return ServiceResult(success=False, reason="already_checked_in")

    kid = key_id if key_id is not None else sel["key_id"]
    new_ticket_id = uuid.uuid4()

    # (1) mark old ticket revoked
    conn.execute(
        """
        UPDATE tickets
        SET status='revoked', revoked_reason=%(reason)s, pending_by=NULL, pending_until=NULL
        WHERE id=%(id)s;
        """,
        {"id": tid, "reason": reason},
    )

    # (2) insert new ticket with a NEW id
    conn.execute(
        """
        INSERT INTO tickets (id, event_id, participant_id, status, key_id)
        VALUES (%(new_id)s, %(event_id)s, %(participant_id)s, 'issued', %(key_id)s);
        """,
        {
            "new_id": str(new_ticket_id),
            "event_id": str(sel["event_id"]),
            "participant_id": str(sel["participant_id"]),
            "key_id": kid,
        },
    )

    # (3) set old.replaced_by = new id
    conn.execute(
        "UPDATE tickets SET replaced_by=%(new_id)s WHERE id=%(id)s;",
        {"new_id": str(new_ticket_id), "id": tid},
    )

    log_scan_event(
        conn,
        ticket_id=tid,
        event_id=sel["event_id"],
        staff_id=sid,
        action="reissue",
        result="success",
        detail={"new_ticket_id": str(new_ticket_id), "reason": reason},
    )

    new_row = conn.execute("SELECT * FROM tickets WHERE id = %(id)s;", {"id": str(new_ticket_id)}).fetchone()
    return ServiceResult(
        success=True,
        reason="reissued",
        data={"old_ticket_id": tid, "new_ticket": dict(new_row)},
    )


def supervisor_override(
    conn: psycopg.Connection,
    ticket_id: uuid.UUID | str,
    supervisor_id: uuid.UUID | str,
    action: str,
    reason: str,
    id_card_no: str | None = None,
) -> ServiceResult:
    """
    Supervisor-only override on checked_in ticket:
    - 'reprint_badge': updates id_card_no if provided
    - 'reset_checkin': reverts status to 'issued', clears check-in details
    Always requires a reason and is logged.
    """
    tid = str(ticket_id)
    sid = str(supervisor_id)

    sel = conn.execute("SELECT * FROM tickets WHERE id = %(id)s FOR UPDATE;", {"id": tid}).fetchone()
    if not sel:
        return ServiceResult(success=False, reason="not_found")

    if sel["status"] != "checked_in":
        return ServiceResult(success=False, reason="ticket_not_checked_in")

    if action == "reprint_badge":
        if id_card_no:
            conn.execute("SAVEPOINT override_sp;")
            try:
                conn.execute(
                    "UPDATE tickets SET id_card_no=%(card)s WHERE id=%(id)s;",
                    {"card": id_card_no.strip(), "id": tid},
                )
                conn.execute("RELEASE SAVEPOINT override_sp;")
            except psycopg.errors.UniqueViolation:
                conn.execute("ROLLBACK TO SAVEPOINT override_sp;")
                return ServiceResult(success=False, reason="id_card_taken")


        log_scan_event(
            conn,
            ticket_id=tid,
            event_id=sel["event_id"],
            staff_id=sid,
            action="override_reprint",
            result="success",
            detail={"reason": reason, "id_card_no": id_card_no},
        )
        updated = conn.execute("SELECT * FROM tickets WHERE id = %(id)s;", {"id": tid}).fetchone()
        return ServiceResult(success=True, reason="badge_reprinted", data={"ticket": dict(updated)})

    elif action == "reset_checkin":
        conn.execute(
            """
            UPDATE tickets
            SET status='issued', checked_in_at=NULL, checked_in_by=NULL, id_card_no=NULL,
                pending_by=NULL, pending_until=NULL
            WHERE id=%(id)s;
            """,
            {"id": tid},
        )
        log_scan_event(
            conn,
            ticket_id=tid,
            event_id=sel["event_id"],
            staff_id=sid,
            action="override_reset",
            result="success",
            detail={"reason": reason},
        )
        updated = conn.execute("SELECT * FROM tickets WHERE id = %(id)s;", {"id": tid}).fetchone()
        return ServiceResult(success=True, reason="checkin_reset", data={"ticket": dict(updated)})

    return ServiceResult(success=False, reason="unknown_override_action")
