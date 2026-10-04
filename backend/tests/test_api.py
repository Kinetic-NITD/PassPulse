"""
API tests using httpx: full happy path, error codes, role enforcement, JWT, rate limit,
and asserting that tampered tokens return 400 without touching the DB.
"""

import base64
import uuid
from datetime import datetime, timezone, timedelta
from unittest.mock import patch

import jwt
import pytest
from httpx import AsyncClient, ASGITransport
from cryptography.hazmat.primitives.asymmetric import ed25519
from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat

from app import config
from app.auth import hash_password
from app.key_cache import set_cached_key, clear_key_cache
from app.main import app
from app.ratelimit import reset_rate_limits
from app.tokens import sign_token, extract_token_from_url
from tests.conftest import (
    make_event,
    make_participant,
    make_staff,
    make_signing_key,
    make_ticket,
)


@pytest.fixture
def auth_keys():
    """Generates a test Ed25519 keypair and registers key_id=1 in cache."""
    priv = ed25519.Ed25519PrivateKey.generate()
    pub = priv.public_key()
    pub_bytes = pub.public_bytes(Encoding.Raw, PublicFormat.Raw)
    set_cached_key(1, pub)
    return {"priv": priv, "pub": pub, "pub_bytes": pub_bytes, "key_id": 1}


@pytest.fixture
async def client():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as ac:
        yield ac


class TestAPI:

    async def test_full_happy_path(self, test_schema, db_conn, auth_keys, client):
        reset_rate_limits()
        # Seed event, participant, staff
        eid = make_event(db_conn, "API Happy Event")
        pid = make_participant(db_conn, eid, name="Alice In Wonderland", email="alice@test.com")
        pw_hash = hash_password("secretpass123")
        sid = make_staff(db_conn, name="Bob Volunteer", email="vol1@test.com", role="volunteer", password_hash=pw_hash)
        make_signing_key(db_conn, key_id=1, public_key=auth_keys["pub_bytes"])
        tid = make_ticket(db_conn, eid, pid, key_id=1)

        # 1. Login
        login_resp = await client.post("/api/auth/login", json={"email": "vol1@test.com", "password": "secretpass123"})
        assert login_resp.status_code == 200
        token_data = login_resp.json()
        jwt_token = token_data["access_token"]
        headers = {"Authorization": f"Bearer {jwt_token}"}

        # 2. Public keys
        pub_resp = await client.get("/api/public-keys")
        assert pub_resp.status_code == 200
        assert "1" in pub_resp.json()

        # 3. Volunteer scans valid token
        qr_token = sign_token(auth_keys["priv"], 1, tid)
        scan_resp = await client.post("/api/scan", json={"token": qr_token}, headers=headers)
        assert scan_resp.status_code == 200
        scan_data = scan_resp.json()
        assert scan_data["status"] == "claimed"
        assert scan_data["participant"]["name"] == "Alice In Wonderland"
        assert "lease_expiry" in scan_data

        # 4. Volunteer confirms check-in
        confirm_resp = await client.post(
            "/api/confirm",
            json={"ticket_id": str(tid), "id_card_no": "CARD-9901"},
            headers=headers,
        )
        assert confirm_resp.status_code == 200
        assert confirm_resp.json()["status"] == "checked_in"

        # 5. Volunteer scans again -> 409 already_checked_in
        scan2_resp = await client.post("/api/scan", json={"token": qr_token}, headers=headers)
        assert scan2_resp.status_code == 409
        err = scan2_resp.json()["detail"]
        assert err["reason"] == "already_checked_in"
        assert err["details"]["name"] == "Alice In Wonderland"
        assert err["details"]["id_card_no"] == "CARD-9901"

    async def test_failure_reasons_and_status_codes(self, test_schema, db_conn, auth_keys, client):
        reset_rate_limits()
        eid = make_event(db_conn, "API Error Event")
        pid = make_participant(db_conn, eid, name="Bob Error")
        pw_hash = hash_password("secretpass123")
        v1 = make_staff(db_conn, name="Vol 1", email="v1_err@test.com", role="volunteer", password_hash=pw_hash)
        v2 = make_staff(db_conn, name="Vol 2", email="v2_err@test.com", role="volunteer", password_hash=pw_hash)
        make_signing_key(db_conn, key_id=1, public_key=auth_keys["pub_bytes"])
        tid = make_ticket(db_conn, eid, pid, key_id=1)

        # Login v1 and v2
        r1 = await client.post("/api/auth/login", json={"email": "v1_err@test.com", "password": "secretpass123"})
        jwt_v1 = r1.json()["access_token"]
        headers_v1 = {"Authorization": f"Bearer {jwt_v1}"}

        r2 = await client.post("/api/auth/login", json={"email": "v2_err@test.com", "password": "secretpass123"})
        jwt_v2 = r2.json()["access_token"]
        headers_v2 = {"Authorization": f"Bearer {jwt_v2}"}

        qr_token = sign_token(auth_keys["priv"], 1, tid)

        # v1 claims
        s1 = await client.post("/api/scan", json={"token": qr_token}, headers=headers_v1)
        assert s1.status_code == 200

        # v2 tries to claim while v1 holds lease -> 409 pending_other
        s2 = await client.post("/api/scan", json={"token": qr_token}, headers=headers_v2)
        assert s2.status_code == 409
        assert s2.json()["detail"]["reason"] == "pending_other"

        # Not found ticket
        fake_tid = uuid.uuid4()
        fake_token = sign_token(auth_keys["priv"], 1, fake_tid)
        s_404 = await client.post("/api/scan", json={"token": fake_token}, headers=headers_v1)
        assert s_404.status_code == 404

        # Duplicate ID card number -> 409 id_card_taken
        # Confirm tid with CARD-TAKEN
        await client.post("/api/confirm", json={"ticket_id": str(tid), "id_card_no": "CARD-TAKEN"}, headers=headers_v1)

        # Create ticket 2 and try to confirm with same card
        p2 = make_participant(db_conn, eid, name="Carol Error")
        t2 = make_ticket(db_conn, eid, p2, key_id=1)
        qr2 = sign_token(auth_keys["priv"], 1, t2)
        await client.post("/api/scan", json={"token": qr2}, headers=headers_v1)
        c_dup = await client.post("/api/confirm", json={"ticket_id": str(t2), "id_card_no": "CARD-TAKEN"}, headers=headers_v1)
        assert c_dup.status_code == 409
        assert c_dup.json()["detail"]["reason"] == "id_card_taken"

        # Revoked ticket -> 409 revoked
        db_conn.execute("UPDATE tickets SET status='revoked', revoked_reason='Test Revoke' WHERE id=%s", (str(t2),))
        db_conn.commit()
        s_rev = await client.post("/api/scan", json={"token": qr2}, headers=headers_v1)
        assert s_rev.status_code == 409
        assert s_rev.json()["detail"]["reason"] == "revoked"

    async def test_tampered_token_returns_400_without_touching_db(self, test_schema, auth_keys, client):
        """Assert that a tampered token on /api/scan returns 400 without touching the DB."""
        reset_rate_limits()
        fake_staff_jwt = jwt.encode(
            {"sub": str(uuid.uuid4()), "email": "vol@test.com", "name": "Vol", "role": "volunteer", "exp": datetime.now(timezone.utc) + timedelta(hours=1)},
            config.JWT_SECRET,
            algorithm="HS256",
        )
        headers = {"Authorization": f"Bearer {fake_staff_jwt}"}

        # Create valid token then corrupt signature
        valid_token = sign_token(auth_keys["priv"], 1, uuid.uuid4())
        tampered_token = valid_token[:-4] + "AAAA"

        # Patch get_pool in scan_routes so if it is called, it blows up!
        with patch("app.routes.scan_routes.get_pool", side_effect=AssertionError("DB WAS TOUCHED FOR BAD TOKEN!")):
            resp = await client.post("/api/scan", json={"token": tampered_token}, headers=headers)

        assert resp.status_code == 400
        assert resp.json()["detail"]["reason"] == "bad_signature"

    async def test_malformed_token_returns_400_without_touching_db(self, test_schema, client):
        reset_rate_limits()
        fake_jwt = jwt.encode(
            {"sub": str(uuid.uuid4()), "email": "vol@test.com", "name": "Vol", "role": "volunteer", "exp": datetime.now(timezone.utc) + timedelta(hours=1)},
            config.JWT_SECRET,
            algorithm="HS256",
        )
        headers = {"Authorization": f"Bearer {fake_jwt}"}

        with patch("app.routes.scan_routes.get_pool", side_effect=AssertionError("DB WAS TOUCHED!")):
            resp = await client.post("/api/scan", json={"token": "not-a-valid-token"}, headers=headers)

        assert resp.status_code == 400
        assert resp.json()["detail"]["reason"] == "malformed"

    async def test_role_enforcement_on_every_endpoint(self, test_schema, db_conn, client):
        reset_rate_limits()
        pw_hash = hash_password("pass123")
        make_staff(db_conn, name="Vol", email="vol_role@test.com", role="volunteer", password_hash=pw_hash)
        make_staff(db_conn, name="Sup", email="sup_role@test.com", role="supervisor", password_hash=pw_hash)
        make_staff(db_conn, name="Adm", email="adm_role@test.com", role="admin", password_hash=pw_hash)

        r_v = await client.post("/api/auth/login", json={"email": "vol_role@test.com", "password": "pass123"})
        jwt_vol = r_v.json()["access_token"]

        r_s = await client.post("/api/auth/login", json={"email": "sup_role@test.com", "password": "pass123"})
        jwt_sup = r_s.json()["access_token"]

        r_a = await client.post("/api/auth/login", json={"email": "adm_role@test.com", "password": "pass123"})
        jwt_adm = r_a.json()["access_token"]

        tid = str(uuid.uuid4())

        # 1. Volunteer attempting supervisor endpoint -> 403
        r_vol_sup = await client.post(
            f"/api/tickets/{tid}/override",
            json={"action": "reprint_badge", "reason": "test"},
            headers={"Authorization": f"Bearer {jwt_vol}"},
        )
        assert r_vol_sup.status_code == 403

        # 2. Volunteer attempting admin endpoint -> 403
        r_vol_adm = await client.get("/api/stats", headers={"Authorization": f"Bearer {jwt_vol}"})
        assert r_vol_adm.status_code == 403

        # 3. Supervisor attempting admin endpoint -> 403
        r_sup_adm = await client.get("/api/stats", headers={"Authorization": f"Bearer {jwt_sup}"})
        assert r_sup_adm.status_code == 403

        # 4. Admin attempting admin endpoint -> 200
        r_adm_ok = await client.get("/api/stats", headers={"Authorization": f"Bearer {jwt_adm}"})
        assert r_adm_ok.status_code == 200

    async def test_expired_and_invalid_jwt(self, client):
        reset_rate_limits()
        # Invalid signature JWT
        bad_jwt = jwt.encode({"sub": "123", "role": "volunteer", "exp": 9999999999}, "wrong-secret", algorithm="HS256")
        r_bad = await client.get("/api/participants/search?q=test", headers={"Authorization": f"Bearer {bad_jwt}"})
        assert r_bad.status_code == 401

        # Expired JWT
        past = datetime.now(timezone.utc) - timedelta(hours=1)
        exp_jwt = jwt.encode({"sub": "123", "role": "volunteer", "exp": past}, config.JWT_SECRET, algorithm="HS256")
        r_exp = await client.get("/api/participants/search?q=test", headers={"Authorization": f"Bearer {exp_jwt}"})
        assert r_exp.status_code == 401

        # Missing header
        r_miss = await client.get("/api/participants/search?q=test")
        assert r_miss.status_code == 401

    async def test_rate_limiting(self, test_schema, db_conn, auth_keys, client):
        reset_rate_limits()
        pw_hash = hash_password("pass123")
        sid = make_staff(db_conn, name="Rate Vol", email="rate_vol@test.com", password_hash=pw_hash)
        fake_jwt = jwt.encode(
            {"sub": str(sid), "email": "rate_vol@test.com", "name": "Rate Vol", "role": "volunteer", "exp": datetime.now(timezone.utc) + timedelta(hours=1)},
            config.JWT_SECRET,
            algorithm="HS256",
        )


        headers = {"Authorization": f"Bearer {fake_jwt}"}
        valid_token = sign_token(auth_keys["priv"], 1, uuid.uuid4())

        # Spam 20 calls quickly
        statuses = []
        for _ in range(20):
            res = await client.post("/api/scan", json={"token": valid_token}, headers=headers)
            statuses.append(res.status_code)

        assert 429 in statuses, f"Expected 429 in statuses, got {statuses}"
        reset_rate_limits()
