"""Public unauthenticated routes."""

import base64
from fastapi import APIRouter
from fastapi.responses import HTMLResponse

from app.db import get_pool
from app.key_cache import refresh_public_keys

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


@router.get("/t/{token}", response_class=HTMLResponse)
def public_ticket_page(token: str):
    return """<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Event Pass — PassPulse</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; background: #0b0f19; color: #fff; text-align: center; }
        .card { background: rgba(255,255,255,0.06); padding: 40px; border-radius: 24px; border: 1px solid rgba(255,255,255,0.12); max-width: 360px; box-shadow: 0 20px 40px rgba(0,0,0,0.5); }
        h1 { font-size: 24px; margin: 0 0 12px 0; color: #007AFF; }
        p { color: #8E8E93; font-size: 15px; margin: 0; line-height: 1.5; }
    </style>
</head>
<body>
    <div class="card">
        <h1>Event Pass</h1>
        <p>Show this QR code at the check-in gate for venue admission.</p>
    </div>
</body>
</html>
"""
