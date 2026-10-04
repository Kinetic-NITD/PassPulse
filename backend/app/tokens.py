"""
Ed25519 token module — sign, verify, build QR payload.

Payload format (18 bytes):
  version  (1 byte, value 1)
  key_id   (1 byte)
  ticket_id (16 bytes, raw UUID)

QR text = {PUBLIC_BASE_URL}/t/ + base64url(payload || signature), no padding
"""

import uuid
import base64
import struct
from typing import NamedTuple

from cryptography.hazmat.primitives.asymmetric.ed25519 import (
    Ed25519PrivateKey,
    Ed25519PublicKey,
)
from cryptography.hazmat.primitives.asymmetric import ed25519
from cryptography.exceptions import InvalidSignature

VERSION = 1
PAYLOAD_LEN = 18  # 1 + 1 + 16
SIGNATURE_LEN = 64
TOTAL_LEN = PAYLOAD_LEN + SIGNATURE_LEN  # 82 bytes


class ParsedToken(NamedTuple):
    version: int
    key_id: int
    ticket_id: uuid.UUID
    payload: bytes
    signature: bytes


def private_key_from_seed(seed_b64: str) -> Ed25519PrivateKey:
    """Load a private key from a base64-encoded 32-byte seed."""
    seed = base64.b64decode(seed_b64)
    if len(seed) != 32:
        raise ValueError(f"Seed must be 32 bytes, got {len(seed)}")
    return Ed25519PrivateKey.from_private_bytes(seed)


def public_key_from_private(private_key: Ed25519PrivateKey) -> Ed25519PublicKey:
    """Extract the public key from a private key."""
    return private_key.public_key()


def public_key_bytes(pub: Ed25519PublicKey) -> bytes:
    """Get raw 32-byte public key."""
    from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat
    return pub.public_bytes(Encoding.Raw, PublicFormat.Raw)


def public_key_from_bytes(raw: bytes) -> Ed25519PublicKey:
    """Load public key from raw 32 bytes."""
    return Ed25519PublicKey.from_public_bytes(raw)


def build_payload(key_id: int, ticket_id: uuid.UUID) -> bytes:
    """Build the 18-byte payload: version(1) | key_id(1) | ticket_id(16)."""
    return struct.pack("BB", VERSION, key_id) + ticket_id.bytes


def sign_token(private_key: Ed25519PrivateKey, key_id: int, ticket_id: uuid.UUID) -> str:
    """
    Build payload, sign it, return base64url(payload || signature) with no padding.
    """
    payload = build_payload(key_id, ticket_id)
    signature = private_key.sign(payload)
    raw = payload + signature
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def build_qr_url(base_url: str, token: str) -> str:
    """Build the full QR URL: {base_url}/t/{token}."""
    return f"{base_url}/t/{token}"


def _b64url_decode(s: str) -> bytes:
    """Decode base64url without padding strictly."""
    if not isinstance(s, str):
        raise ValueError("Token must be a string")
    padding = (4 - len(s) % 4) % 4
    standard_b64 = s.replace("-", "+").replace("_", "/") + ("=" * padding)
    return base64.b64decode(standard_b64, validate=True)





def parse_token(token: str) -> ParsedToken:
    """
    Parse a base64url token string into its components.
    Raises ValueError on any format issue.
    """
    try:
        raw = _b64url_decode(token)
    except Exception as e:
        raise ValueError(f"Invalid base64url: {e}")

    if len(raw) != TOTAL_LEN:
        raise ValueError(f"Token must be {TOTAL_LEN} bytes, got {len(raw)}")

    payload = raw[:PAYLOAD_LEN]
    signature = raw[PAYLOAD_LEN:]

    version, key_id = struct.unpack("BB", payload[:2])
    if version != VERSION:
        raise ValueError(f"Unknown version: {version}")

    ticket_id = uuid.UUID(bytes=payload[2:18])

    return ParsedToken(
        version=version,
        key_id=key_id,
        ticket_id=ticket_id,
        payload=payload,
        signature=signature,
    )


def verify_token(token: str, public_keys: dict[int, Ed25519PublicKey]) -> ParsedToken:
    """
    Parse and verify a token against known public keys.
    Raises ValueError for format issues, KeyError for unknown key_id,
    InvalidSignature for bad signature.
    """
    parsed = parse_token(token)

    pub = public_keys.get(parsed.key_id)
    if pub is None:
        raise KeyError(f"Unknown key_id: {parsed.key_id}")

    pub.verify(parsed.signature, parsed.payload)
    return parsed


def extract_token_from_url(url: str) -> str:
    """Extract the token part from a QR URL like .../t/TOKEN or return bare token."""
    trimmed = url.strip()
    if "/t/" in trimmed:
        sub = trimmed.split("/t/")[-1]
        return sub.split("/")[0].split("?")[0].split("#")[0]
    return trimmed

