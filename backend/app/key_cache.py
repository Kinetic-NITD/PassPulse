"""In-memory cache for Ed25519 public keys."""

import base64
from threading import Lock
from cryptography.hazmat.primitives.asymmetric import ed25519
from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat

_lock = Lock()
_public_keys: dict[int, ed25519.Ed25519PublicKey] = {}


def set_cached_key(key_id: int, public_key: ed25519.Ed25519PublicKey) -> None:
    with _lock:
        _public_keys[key_id] = public_key


def clear_key_cache() -> None:
    with _lock:
        _public_keys.clear()


def get_cached_keys() -> dict[int, ed25519.Ed25519PublicKey]:
    with _lock:
        return dict(_public_keys)


def refresh_public_keys(conn) -> dict[int, ed25519.Ed25519PublicKey]:
    """Fetch active keys from DB and cache in memory."""
    rows = conn.execute("SELECT key_id, public_key FROM signing_keys WHERE active = true;").fetchall()
    new_keys = {}
    for r in rows:
        kid = r["key_id"]
        raw = bytes(r["public_key"])
        new_keys[kid] = ed25519.Ed25519PublicKey.from_public_bytes(raw)
    with _lock:
        _public_keys.clear()
        _public_keys.update(new_keys)
    return new_keys
