"""Supervisor-only routes."""

from typing import Annotated, Literal
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from app.auth import require_role, StaffUser
from app.db import get_pool
from app.services import supervisor_override

router = APIRouter(prefix="/api/tickets", tags=["supervisor"])


class OverrideRequest(BaseModel):
    action: Literal["reprint_badge", "reset_checkin"]
    reason: str
    id_card_no: str | None = None


@router.post("/{ticket_id}/override")
def override_ticket_action(
    ticket_id: str,
    req: OverrideRequest,
    staff: Annotated[StaffUser, Depends(require_role("supervisor"))],
):
    if not req.reason or not req.reason.strip():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"reason": "missing_reason", "message": "Reason is required for override"},
        )

    pool = get_pool()
    with pool.connection() as conn:
        res = supervisor_override(
            conn,
            ticket_id=ticket_id,
            supervisor_id=staff.id,
            action=req.action,
            reason=req.reason,
            id_card_no=req.id_card_no,
        )
        conn.commit()

    if res.success:
        return {"status": "ok", "action": req.action, "ticket": res.data.get("ticket")}

    if res.reason == "not_found":
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail={"reason": "not_found"})

    if res.reason == "id_card_taken":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail={"reason": "id_card_taken"})

    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail={"reason": res.reason})
