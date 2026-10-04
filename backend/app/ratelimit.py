"""Simple in-memory per-staff rate limiter for scan endpoints."""

import time
from collections import defaultdict
from threading import Lock
from fastapi import HTTPException, status

_lock = Lock()
_timestamps: dict[str, list[float]] = defaultdict(list)

# Limits: max 10 scan calls per 60 seconds per staff
WINDOW_SECONDS = 60.0
MAX_CALLS = 10



def check_scan_rate_limit(staff_id: str) -> None:
    now = time.monotonic()
    with _lock:
        calls = _timestamps[staff_id]
        # Prune expired
        cutoff = now - WINDOW_SECONDS
        _timestamps[staff_id] = [t for t in calls if t > cutoff]
        if len(_timestamps[staff_id]) >= MAX_CALLS:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Rate limit exceeded. Please wait before scanning again.",
            )
        _timestamps[staff_id].append(now)


def reset_rate_limits() -> None:
    """Useful for tests."""
    with _lock:
        _timestamps.clear()
