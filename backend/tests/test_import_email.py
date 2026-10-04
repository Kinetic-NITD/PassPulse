"""
Tests for CSV import, idempotent ticket issuance, CSV export with QR tokens,
email sending, and QR code image generation.
"""

import csv
import io
import uuid
import pytest
from httpx import AsyncClient, ASGITransport

from app.auth import hash_password, create_access_token
from app.main import app
from app.tokens import parse_token, verify_token, private_key_from_seed
from app import config
from tests.conftest import make_event, make_staff, make_signing_key


@pytest.fixture
async def client():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as ac:
        yield ac


@pytest.fixture(autouse=True)
def ensure_signing_key(db_conn):
    from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat
    priv_key = private_key_from_seed(config.SIGNING_PRIVATE_KEY)
    pub_bytes = priv_key.public_key().public_bytes(Encoding.Raw, PublicFormat.Raw)
    make_signing_key(db_conn, key_id=config.SIGNING_KEY_ID, public_key=pub_bytes)




class TestImportIssueEmail:

    async def test_csv_import_with_duplicates_and_bad_rows(self, test_schema, db_conn, client):
        eid = make_event(db_conn, "CSV Import Event")
        sid = make_staff(db_conn, name="Admin User", role="admin")
        jwt_token = create_access_token(str(sid), "admin@test.com", "Admin User", "admin")
        headers = {"Authorization": f"Bearer {jwt_token}"}

        # CSV containing valid, duplicate, and bad rows
        csv_data = """name,email,college,photo_url
Elena Rostova,elena.r@stanford.edu,Stanford Univ,https://example.com/p1.jpg
Marcus Chen,mchen@mit.edu,MIT Tech,https://example.com/p2.jpg
Elena Rostova,elena.r@stanford.edu,Stanford Univ,https://example.com/dup.jpg
Bad Participant,notanemail,Some College,
,emptyname@test.com,College,
David Miller,dmiller@berkeley.edu,UC Berkeley,
"""
        resp = await client.post(
            "/api/participants/import",
            json={"csv_content": csv_data, "event_id": str(eid)},
            headers=headers,
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["imported"] == 3  # Elena, Marcus, David
        assert data["duplicates"] == 1  # 2nd Elena
        assert data["errors"] == 2  # notanemail, empty name

    async def test_idempotent_ticket_issue(self, test_schema, db_conn, client):
        eid = make_event(db_conn, "Issue Event")
        sid = make_staff(db_conn, name="Admin User", role="admin")
        jwt_token = create_access_token(str(sid), "admin@test.com", "Admin User", "admin")
        headers = {"Authorization": f"Bearer {jwt_token}"}

        # Import 2 participants
        csv_data = """name,email,college
User One,one@test.com,Stanford
User Two,two@test.com,MIT
"""
        await client.post(
            "/api/participants/import",
            json={"csv_content": csv_data, "event_id": str(eid)},
            headers=headers,
        )

        # Issue 1st time
        r1 = await client.post(
            "/api/tickets/issue",
            json={"event_id": str(eid)},
            headers=headers,
        )
        assert r1.status_code == 200
        assert r1.json()["issued_count"] == 2

        # Issue 2nd time -> 0 tickets issued (idempotent!)
        r2 = await client.post(
            "/api/tickets/issue",
            json={"event_id": str(eid)},
            headers=headers,
        )
        assert r2.status_code == 200
        assert r2.json()["issued_count"] == 0

    async def test_export_csv_with_participant_qr_secrets(self, test_schema, db_conn, client):
        eid = make_event(db_conn, "Export Event")
        sid = make_staff(db_conn, name="Admin User", role="admin")
        jwt_token = create_access_token(str(sid), "admin@test.com", "Admin User", "admin")
        headers = {"Authorization": f"Bearer {jwt_token}"}

        # Import and issue
        csv_data = "name,email,college\nAlice Wonderland,alice.exp@test.com,Oxford"
        await client.post(
            "/api/participants/import",
            json={"csv_content": csv_data, "event_id": str(eid)},
            headers=headers,
        )
        await client.post(
            "/api/tickets/issue",
            json={"event_id": str(eid)},
            headers=headers,
        )

        # Export CSV
        resp = await client.get(f"/api/tickets/export-csv?event_id={eid}", headers=headers)
        assert resp.status_code == 200
        assert "text/csv" in resp.headers["content-type"]

        reader = csv.DictReader(io.StringIO(resp.text))
        rows = list(reader)
        assert len(rows) == 1
        row = rows[0]
        assert row["name"] == "Alice Wonderland"
        assert row["email"] == "alice.exp@test.com"
        assert len(row["qr_token"]) > 40
        assert "/t/" in row["qr_url"]

        # Verify the exported token is cryptographically valid!
        priv_key = private_key_from_seed(config.SIGNING_PRIVATE_KEY)
        pub_key = priv_key.public_key()
        verified = verify_token(row["qr_token"], {config.SIGNING_KEY_ID: pub_key})
        assert str(verified.ticket_id) == row["ticket_id"]

    async def test_email_send_and_resend_same_qr(self, test_schema, db_conn, client):
        eid = make_event(db_conn, "Email Event")
        sid = make_staff(db_conn, name="Admin User", role="admin")
        jwt_token = create_access_token(str(sid), "admin@test.com", "Admin User", "admin")
        headers = {"Authorization": f"Bearer {jwt_token}"}

        # Import and issue
        csv_data = "name,email\nBob Mail,bob.mail@test.com"
        await client.post("/api/participants/import", json={"csv_content": csv_data, "event_id": str(eid)}, headers=headers)
        issue_res = await client.post("/api/tickets/issue", json={"event_id": str(eid)}, headers=headers)
        ticket_id = issue_res.json()["tickets"][0]

        # Send email (mocked)
        send_res = await client.post("/api/emails/send", json={"event_id": str(eid)}, headers=headers)
        assert send_res.status_code == 200
        assert send_res.json()["sent_count"] == 1

        # Check DB has email_sent_at
        row = db_conn.execute("SELECT email_sent_at FROM tickets WHERE id = %s", (ticket_id,)).fetchone()
        assert row["email_sent_at"] is not None

        # Sending again without force_resend -> 0 sent
        send2_res = await client.post("/api/emails/send", json={"event_id": str(eid), "force_resend": False}, headers=headers)
        assert send2_res.json()["sent_count"] == 0

        # Resend with force_resend=True -> 1 sent
        send3_res = await client.post("/api/emails/send", json={"event_id": str(eid), "force_resend": True}, headers=headers)
        assert send3_res.json()["sent_count"] == 1

    async def test_qr_png_generation(self, test_schema, db_conn, client):
        eid = make_event(db_conn, "PNG Event")
        sid = make_staff(db_conn, name="Admin User", role="admin")
        jwt_token = create_access_token(str(sid), "admin@test.com", "Admin User", "admin")
        headers = {"Authorization": f"Bearer {jwt_token}"}

        csv_data = "name,email\nQR Guy,qrguy@test.com"
        await client.post("/api/participants/import", json={"csv_content": csv_data, "event_id": str(eid)}, headers=headers)
        issue_res = await client.post("/api/tickets/issue", json={"event_id": str(eid)}, headers=headers)
        ticket_id = issue_res.json()["tickets"][0]

        # Request PNG
        png_resp = await client.get(f"/api/tickets/{ticket_id}/qr.png")
        assert png_resp.status_code == 200
        assert png_resp.headers["content-type"] == "image/png"
        # Standard PNG magic number header: \x89PNG\r\n\x1a\n
        assert png_resp.content.startswith(b"\x89PNG\r\n\x1a\n")
