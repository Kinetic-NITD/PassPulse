"""
Seed script — creates demo event, participants, staff, and signing key.

Usage:
    python scripts/seed.py

Idempotent: uses ON CONFLICT DO NOTHING where applicable.
"""

import os
import sys
import uuid
import base64
from pathlib import Path

# Setup path
backend_dir = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(backend_dir))

from dotenv import load_dotenv
load_dotenv(backend_dir.parent / ".env")

import psycopg
from psycopg.rows import dict_row
from argon2 import PasswordHasher

ph = PasswordHasher()


# Fixed UUIDs for reproducibility
EVENT_ID = uuid.UUID("00000000-0000-4000-8000-000000000001")
ADMIN_ID = uuid.UUID("00000000-0000-4000-8000-000000000010")
SUPERVISOR_ID = uuid.UUID("00000000-0000-4000-8000-000000000020")
VOLUNTEER_1_ID = uuid.UUID("00000000-0000-4000-8000-000000000030")
VOLUNTEER_2_ID = uuid.UUID("00000000-0000-4000-8000-000000000040")

DEMO_PASSWORD = "pass1234"


def seed():
    db_url = os.environ["DATABASE_URL"]
    signing_key_b64 = os.environ["SIGNING_PRIVATE_KEY"]
    key_id = int(os.environ.get("SIGNING_KEY_ID", "1"))

    # Derive public key from private seed
    from cryptography.hazmat.primitives.asymmetric import ed25519
    from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat

    seed_bytes = base64.b64decode(signing_key_b64)
    private_key = ed25519.Ed25519PrivateKey.from_private_bytes(seed_bytes)
    pub_bytes = private_key.public_key().public_bytes(Encoding.Raw, PublicFormat.Raw)

    password_hash = ph.hash(DEMO_PASSWORD)

    with psycopg.connect(db_url, row_factory=dict_row) as conn:
        print("Seeding database...")

        # 1. Event
        conn.execute(
            "INSERT INTO events (id, name, starts_at, ends_at) VALUES (%s, %s, now(), now() + interval '2 days') ON CONFLICT DO NOTHING;",
            (str(EVENT_ID), "HackSummit 2025"),
        )
        print("  ✓ Event: HackSummit 2025")

        # 2. Staff
        staff = [
            (ADMIN_ID, "Admin User", "admin@passpulse.dev", "admin"),
            (SUPERVISOR_ID, "Super Visor", "supervisor@passpulse.dev", "supervisor"),
            (VOLUNTEER_1_ID, "Vol One", "vol1@passpulse.dev", "volunteer"),
            (VOLUNTEER_2_ID, "Vol Two", "vol2@passpulse.dev", "volunteer"),
        ]
        for sid, name, email, role in staff:
            conn.execute(
                """INSERT INTO staff (id, name, email, password_hash, role)
                   VALUES (%s, %s, %s, %s, %s)
                   ON CONFLICT (email) DO NOTHING;""",
                (str(sid), name, email, password_hash, role),
            )
        print(f"  ✓ Staff: {len(staff)} accounts (password: {DEMO_PASSWORD})")

        # 3. Signing key
        conn.execute(
            """INSERT INTO signing_keys (key_id, public_key, active)
               VALUES (%s, %s, true)
               ON CONFLICT (key_id) DO UPDATE SET public_key = EXCLUDED.public_key, active = true;""",
            (key_id, pub_bytes),
        )
        print(f"  ✓ Signing key: key_id={key_id}")

        # 4. Demo participants
        participants = [
            ("Alice Johnson", "alice@example.com", "MIT"),
            ("Bob Smith", "bob@example.com", "Stanford"),
            ("Carol Williams", "carol@example.com", "IIT Delhi"),
            ("David Brown", "david@example.com", "NIT Trichy"),
            ("Eve Davis", "eve@example.com", "BITS Pilani"),
            ("Frank Miller", "frank@example.com", "IIT Bombay"),
            ("Grace Lee", "grace@example.com", "IIIT Hyderabad"),
            ("Henry Wilson", "henry@example.com", "DTU"),
            ("Ivy Chen", "ivy@example.com", "VIT"),
            ("Jack Taylor", "jack@example.com", "SRM"),
        ]
        inserted = 0
        for name, email, college in participants:
            pid = str(uuid.uuid4())
            cur = conn.execute(
                """INSERT INTO participants (id, event_id, name, email, college)
                   VALUES (%s, %s, %s, %s, %s)
                   ON CONFLICT (event_id, email) DO NOTHING
                   RETURNING id;""",
                (pid, str(EVENT_ID), name, email, college),
            )
            if cur.fetchone():
                inserted += 1
        print(f"  ✓ Participants: {inserted} new, {len(participants)} total attempted")

        # 5. Issue tickets for participants without one
        unissued = conn.execute(
            """SELECT p.id FROM participants p
               WHERE p.event_id = %s
                 AND NOT EXISTS (
                     SELECT 1 FROM tickets t
                     WHERE t.participant_id = p.id AND t.status IN ('issued', 'pending', 'checked_in')
                 );""",
            (str(EVENT_ID),),
        ).fetchall()

        for r in unissued:
            tid = str(uuid.uuid4())
            conn.execute(
                "INSERT INTO tickets (id, event_id, participant_id, status, key_id) VALUES (%s, %s, %s, 'issued', %s);",
                (tid, str(EVENT_ID), str(r["id"]), key_id),
            )
        print(f"  ✓ Tickets: {len(unissued)} issued")

        conn.commit()

    print("\nSeed complete!")
    print(f"\nDemo logins (password: {DEMO_PASSWORD}):")
    print("  admin@passpulse.dev      (admin)")
    print("  supervisor@passpulse.dev (supervisor)")
    print("  vol1@passpulse.dev       (volunteer)")
    print("  vol2@passpulse.dev       (volunteer)")


if __name__ == "__main__":
    seed()
