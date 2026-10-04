"""Unit tests for token module and test vectors generation."""

import json
import uuid
import base64
from pathlib import Path

import pytest
from cryptography.hazmat.primitives.asymmetric import ed25519
from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat
from cryptography.exceptions import InvalidSignature

from app.tokens import (
    sign_token,
    parse_token,
    verify_token,
    build_payload,
    _b64url_decode,
    ParsedToken,
    VERSION,
    PAYLOAD_LEN,
    SIGNATURE_LEN,
    TOTAL_LEN,
)

# Deterministic test keys
FIXED_SEED = b"\x01" * 32
FIXED_PRIVATE_KEY = ed25519.Ed25519PrivateKey.from_private_bytes(FIXED_SEED)
FIXED_PUBLIC_KEY = FIXED_PRIVATE_KEY.public_key()
FIXED_PUB_BYTES = FIXED_PUBLIC_KEY.public_bytes(Encoding.Raw, PublicFormat.Raw)

OTHER_SEED = b"\x02" * 32
OTHER_PRIVATE_KEY = ed25519.Ed25519PrivateKey.from_private_bytes(OTHER_SEED)
OTHER_PUBLIC_KEY = OTHER_PRIVATE_KEY.public_key()
OTHER_PUB_BYTES = OTHER_PUBLIC_KEY.public_bytes(Encoding.Raw, PublicFormat.Raw)

FIXED_TICKET_ID = uuid.UUID("12345678-1234-5678-1234-567812345678")
KEY_ID = 1


def test_round_trip():
    token = sign_token(FIXED_PRIVATE_KEY, KEY_ID, FIXED_TICKET_ID)
    parsed = parse_token(token)
    assert parsed.version == 1
    assert parsed.key_id == KEY_ID
    assert parsed.ticket_id == FIXED_TICKET_ID

    verified = verify_token(token, {KEY_ID: FIXED_PUBLIC_KEY})
    assert verified.ticket_id == FIXED_TICKET_ID


def test_tamper_regions():
    token = sign_token(FIXED_PRIVATE_KEY, KEY_ID, FIXED_TICKET_ID)
    raw = bytearray(_b64url_decode(token))

    # 1. Tamper version (offset 0)
    raw_bad_ver = bytearray(raw)
    raw_bad_ver[0] ^= 0xFF
    bad_ver_token = base64.urlsafe_b64encode(raw_bad_ver).rstrip(b"=").decode("ascii")
    with pytest.raises(ValueError, match="Unknown version"):
        parse_token(bad_ver_token)

    # 2. Tamper key_id (offset 1)
    raw_bad_kid = bytearray(raw)
    raw_bad_kid[1] ^= 0xFF
    bad_kid_token = base64.urlsafe_b64encode(raw_bad_kid).rstrip(b"=").decode("ascii")
    with pytest.raises(KeyError):
        verify_token(bad_kid_token, {KEY_ID: FIXED_PUBLIC_KEY})

    # 3. Tamper ticket_id (offset 2..17)
    raw_bad_tid = bytearray(raw)
    raw_bad_tid[5] ^= 0xFF
    bad_tid_token = base64.urlsafe_b64encode(raw_bad_tid).rstrip(b"=").decode("ascii")
    with pytest.raises(InvalidSignature):
        verify_token(bad_tid_token, {KEY_ID: FIXED_PUBLIC_KEY})

    # 4. Tamper signature (offset 18..81)
    raw_bad_sig = bytearray(raw)
    raw_bad_sig[20] ^= 0xFF
    bad_sig_token = base64.urlsafe_b64encode(raw_bad_sig).rstrip(b"=").decode("ascii")
    with pytest.raises(InvalidSignature):
        verify_token(bad_sig_token, {KEY_ID: FIXED_PUBLIC_KEY})


def test_wrong_key():
    token = sign_token(FIXED_PRIVATE_KEY, KEY_ID, FIXED_TICKET_ID)
    with pytest.raises(InvalidSignature):
        verify_token(token, {KEY_ID: OTHER_PUBLIC_KEY})


def test_unknown_key_id():
    token = sign_token(FIXED_PRIVATE_KEY, 99, FIXED_TICKET_ID)
    with pytest.raises(KeyError, match="Unknown key_id: 99"):
        verify_token(token, {KEY_ID: FIXED_PUBLIC_KEY})


def test_truncated():
    token = sign_token(FIXED_PRIVATE_KEY, KEY_ID, FIXED_TICKET_ID)
    raw = _b64url_decode(token)
    truncated = base64.urlsafe_b64encode(raw[:40]).rstrip(b"=").decode("ascii")
    with pytest.raises(ValueError, match=f"Token must be {TOTAL_LEN} bytes"):
        parse_token(truncated)


def test_extra_bytes():
    token = sign_token(FIXED_PRIVATE_KEY, KEY_ID, FIXED_TICKET_ID)
    raw = _b64url_decode(token) + b"extra"
    extra = base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")
    with pytest.raises(ValueError, match=f"Token must be {TOTAL_LEN} bytes"):
        parse_token(extra)


def test_bad_base64():
    with pytest.raises(ValueError, match="Invalid base64url"):
        parse_token("not-a-valid-base64url-token!@#$")


def test_generate_vectors():
    """Generates tests/vectors.json for cross-language validation with frontend."""
    valid_token = sign_token(FIXED_PRIVATE_KEY, KEY_ID, FIXED_TICKET_ID)

    # Tampered tokens
    raw = bytearray(_b64url_decode(valid_token))

    raw_bad_sig = bytearray(raw)
    raw_bad_sig[25] ^= 0x55
    bad_sig_token = base64.urlsafe_b64encode(raw_bad_sig).rstrip(b"=").decode("ascii")

    raw_bad_ver = bytearray(raw)
    raw_bad_ver[0] = 2
    bad_ver_token = base64.urlsafe_b64encode(raw_bad_ver).rstrip(b"=").decode("ascii")

    raw_bad_tid = bytearray(raw)
    raw_bad_tid[10] ^= 0xAA
    bad_tid_token = base64.urlsafe_b64encode(raw_bad_tid).rstrip(b"=").decode("ascii")

    vectors = {
        "keys": {
            "1": base64.b64encode(FIXED_PUB_BYTES).decode("ascii"),
            "2": base64.b64encode(OTHER_PUB_BYTES).decode("ascii"),
        },
        "cases": [
            {
                "name": "valid_token",
                "token": valid_token,
                "expected_valid": True,
                "expected_key_id": 1,
                "expected_ticket_id": str(FIXED_TICKET_ID),
            },
            {
                "name": "tampered_signature",
                "token": bad_sig_token,
                "expected_valid": False,
                "expected_error": "bad_signature",
            },
            {
                "name": "tampered_version",
                "token": bad_ver_token,
                "expected_valid": False,
                "expected_error": "bad_version",
            },
            {
                "name": "tampered_ticket_id",
                "token": bad_tid_token,
                "expected_valid": False,
                "expected_error": "bad_signature",
            },
            {
                "name": "unknown_key_id",
                "token": sign_token(FIXED_PRIVATE_KEY, 99, FIXED_TICKET_ID),
                "expected_valid": False,
                "expected_error": "unknown_key",
            },
            {
                "name": "truncated_token",
                "token": base64.urlsafe_b64encode(raw[:50]).rstrip(b"=").decode("ascii"),
                "expected_valid": False,
                "expected_error": "malformed",
            },
            {
                "name": "extra_bytes",
                "token": base64.urlsafe_b64encode(raw + b"junk").rstrip(b"=").decode("ascii"),
                "expected_valid": False,
                "expected_error": "malformed",
            },
            {
                "name": "invalid_base64",
                "token": "???invalid_b64???",
                "expected_valid": False,
                "expected_error": "malformed",
            },
        ],
    }

    vectors_path = Path(__file__).resolve().parent / "vectors.json"
    with open(vectors_path, "w") as f:
        json.dump(vectors, f, indent=2)

    assert vectors_path.exists()
