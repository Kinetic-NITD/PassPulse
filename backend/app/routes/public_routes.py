"""Public unauthenticated routes."""

import base64
from typing import Any

from fastapi import APIRouter, HTTPException, status
from fastapi.responses import HTMLResponse

from app.db import get_pool
from app.key_cache import refresh_public_keys, get_cached_keys
from app.tokens import verify_token, extract_token_from_url
from cryptography.exceptions import InvalidSignature

router = APIRouter(tags=["public"])


@router.get("/api/public-keys")
def get_public_keys():
    pool = get_pool()
    with pool.connection() as conn:
        rows = conn.execute(
            "SELECT key_id, public_key FROM signing_keys WHERE active = true ORDER BY key_id ASC;"
        ).fetchall()

    res = {}
    for r in rows:
        kid = str(r["key_id"])
        b64 = base64.b64encode(bytes(r["public_key"])).decode("ascii")
        res[kid] = b64

    return res


@router.get("/api/tickets/by-token/{token}")
def get_ticket_by_token(token: str):
    """
    Public endpoint. Given a signed QR token, verify it and return
    safe, participant-facing details for the ticket page.
    No sensitive info (no ticket ID, no card number, no staff names).
    """
    raw = extract_token_from_url(token)

    pool = get_pool()

    # Load/cached public keys
    cached = get_cached_keys()
    if not cached:
        with pool.connection() as conn:
            cached = refresh_public_keys(conn)

    try:
        parsed = verify_token(raw, cached)
    except InvalidSignature:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"reason": "bad_signature", "message": "This pass is not valid for this event."},
        )
    except KeyError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"reason": "unknown_key", "message": "This pass was issued by an unknown signing key."},
        )
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"reason": "malformed", "message": str(e)},
        )

    with pool.connection() as conn:
        row = conn.execute(
            """
            SELECT
                t.status AS ticket_status,
                t.checked_in_at,
                p.name AS participant_name,
                p.email,
                p.college,
                p.photo_url,
                e.name AS event_name,
                e.starts_at,
                e.ends_at
            FROM tickets t
            JOIN participants p ON t.participant_id = p.id
            JOIN events e ON t.event_id = e.id
            WHERE t.id = %s;
            """,
            (str(parsed.ticket_id),),
        ).fetchone()

    if not row:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"reason": "not_found", "message": "This pass does not exist."},
        )

    status_val = row["ticket_status"]

    # Revoked passes shouldn't show any useful info
    if status_val == "revoked":
        raise HTTPException(
            status_code=status.HTTP_410_GONE,
            detail={"reason": "revoked", "message": "This pass has been revoked."},
        )

    # Mask email — show first 2 chars + domain
    email = row["email"] or ""
    if "@" in email:
        local, domain = email.split("@", 1)
        masked = (local[:2] + "***") if len(local) > 2 else "***"
        email_masked = f"{masked}@{domain}"
    else:
        email_masked = "***"

    return {
        "participant_name": row["participant_name"],
        "email_masked": email_masked,
        "college": row["college"],
        "photo_url": row["photo_url"],
        "event_name": row["event_name"],
        "event_starts": row["starts_at"].isoformat() if row["starts_at"] else None,
        "event_ends": row["ends_at"].isoformat() if row["ends_at"] else None,
        "status": status_val,  # 'issued' | 'pending' | 'checked_in'
        "checked_in_at": row["checked_in_at"].isoformat() if row["checked_in_at"] else None,
    }