"""Volunteer scan, confirm, cancel, and search routes."""

import uuid
from typing import Annotated
from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from cryptography.exceptions import InvalidSignature

from app import config
from app.auth import require_role, StaffUser
from app.db import get_pool
from app.key_cache import get_cached_keys, refresh_public_keys
from app.ratelimit import check_scan_rate_limit
from app.services import claim_ticket, confirm_ticket, cancel_ticket
from app.tokens import verify_token, extract_token_from_url

router = APIRouter(prefix="/api", tags=["scan"])


class ScanRequest(BaseModel):
    token: str


class ConfirmRequest(BaseModel):
    ticket_id: str
    id_card_no: str


class CancelRequest(BaseModel):
    ticket_id: str


@router.post("/scan")
def scan_qr(
    req: ScanRequest,
    staff: Annotated[StaffUser, Depends(require_role("volunteer"))],
):
    # 1. Rate limiting
    check_scan_rate_limit(staff.id)

    # Clean token (in case full URL was passed)
    raw_token = extract_token_from_url(req.token)

    # 2. Cryptographic verification in memory BEFORE touching DB
    cached_keys = get_cached_keys()
    if not cached_keys:
        # Load once on first request
        pool = get_pool()
        with pool.connection() as conn:
            cached_keys = refresh_public_keys(conn)

    try:
        parsed = verify_token(raw_token, cached_keys)
    except (InvalidSignature, KeyError) as e:
        # Signature mismatch or unknown key -> 400 bad_signature without touching DB
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"reason": "bad_signature", "message": str(e)},
        )
    except ValueError as e:
        # Malformed, bad length, bad base64, bad version -> 400 malformed without touching DB
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"reason": "malformed", "message": str(e)},
        )

    # 3. Verified! Now touch DB to claim lease
    pool = get_pool()
    with pool.connection() as conn:
        res = claim_ticket(conn, parsed.ticket_id, staff.id, lease_seconds=config.LEASE_SECONDS)
        conn.commit()

    if res.success:
        return {
            "status": "claimed",
            "participant": res.data["participant"],
            "event": res.data["event"],
            "ticket": res.data["ticket"],
            "lease_expiry": res.data["lease_expiry"],
        }

    # Error handling
    if res.reason == "not_found":
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"reason": "not_found", "message": "Ticket not found in database"},
        )

    # 409 conflict with machine-readable reasons
    raise HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail={"reason": res.reason, "details": res.details},
    )


@router.post("/confirm")
def confirm_checkin(
    req: ConfirmRequest,
    staff: Annotated[StaffUser, Depends(require_role("volunteer"))],
):
    check_scan_rate_limit(staff.id)

    if not req.id_card_no or not req.id_card_no.strip():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"reason": "missing_card_no", "message": "ID card number is required"},
        )

    pool = get_pool()
    with pool.connection() as conn:
        res = confirm_ticket(conn, req.ticket_id, staff.id, req.id_card_no)
        conn.commit()

    if res.success:
        return {"status": "checked_in", "ticket": res.data["ticket"]}

    if res.reason == "not_found":
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"reason": "not_found"},
        )

    raise HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail={"reason": res.reason, "details": res.details},
    )


@router.post("/cancel")
def cancel_lease(
    req: CancelRequest,
    staff: Annotated[StaffUser, Depends(require_role("volunteer"))],
):
    check_scan_rate_limit(staff.id)

    pool = get_pool()
    with pool.connection() as conn:
        res = cancel_ticket(conn, req.ticket_id, staff.id)
        conn.commit()

    if res.success:
        return {"status": "cancelled"}

    if res.reason == "not_found":
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"reason": "not_found"},
        )

    raise HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail={"reason": res.reason, "details": res.details},
    )


@router.get("/participants/search")
def search_participants(
    q: Annotated[str, Query(min_length=1)],
    staff: Annotated[StaffUser, Depends(require_role("volunteer"))],
):
    search_term = f"%{q.strip()}%"
    pool = get_pool()
    with pool.connection() as conn:
        rows = conn.execute(
            """
            SELECT p.id AS participant_id, p.name, p.email, p.college, p.photo_url,
                   t.id AS ticket_id, t.status AS ticket_status, t.id_card_no,
                   t.pending_until, t.pending_by, t.checked_in_at
            FROM participants p
            LEFT JOIN tickets t ON t.participant_id = p.id AND t.status IN ('issued', 'pending', 'checked_in')
            WHERE p.name ILIKE %(q)s OR p.email ILIKE %(q)s OR p.college ILIKE %(q)s
            ORDER BY p.name ASC
            LIMIT 50;
            """,
            {"q": search_term},
        ).fetchall()

    return {"results": [dict(r) for r in rows]}
