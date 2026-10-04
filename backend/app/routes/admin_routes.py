"""Admin routes: import, issue, revoke, reissue, stats, scan-log."""

import csv
import io
import uuid
from typing import Annotated
from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from pydantic import BaseModel

from app import config
from app.auth import require_role, StaffUser
from app.db import get_pool
from app.services import revoke_ticket, reissue_ticket

router = APIRouter(tags=["admin"])


class ReasonRequest(BaseModel):
    reason: str


class IssueRequest(BaseModel):
    event_id: str | None = None
    key_id: int | None = None


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
        # Event filter
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
    staff: Annotated[StaffUser, Depends(require_role("admin"))],
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
