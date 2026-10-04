"""
Test fixtures for PassPulse.

Safety: creates a throwaway schema `test_<random>`, runs migrations inside it,
and drops it at the end. Aborts if any test touches a schema not starting with `test_`.
"""

import os
import uuid
import logging

import pytest
import psycopg
from psycopg.rows import dict_row

# Load env before anything else
from dotenv import load_dotenv
from pathlib import Path

load_dotenv(Path(__file__).resolve().parent.parent.parent / ".env")

from app.db import init_pool, close_pool, run_migrations, get_pool

logger = logging.getLogger(__name__)


def _guard_schema(schema: str) -> None:
    """Abort if schema doesn't start with test_."""
    if not schema.startswith("test_"):
        raise RuntimeError(
            f"SAFETY: refusing to operate on schema '{schema}' — "
            "test schemas must start with 'test_'"
        )


@pytest.fixture(scope="session")
def test_schema():
    """Create a unique test schema for the entire test session."""
    schema = f"test_{uuid.uuid4().hex[:12]}"
    _guard_schema(schema)
    logger.info("Creating test schema: %s", schema)

    db_url = os.environ["DATABASE_URL"]

    # Create schema with a direct connection
    with psycopg.connect(db_url, row_factory=dict_row) as conn:
        conn.autocommit = True
        conn.execute(f"CREATE SCHEMA {schema}")

    # Init pool with the test schema
    pool = init_pool(db_url, max_size=int(os.environ.get("DB_POOL_MAX", "5")), schema=schema)

    # Run migrations inside the test schema
    applied = run_migrations()
    logger.info("Applied %d migrations in %s", len(applied), schema)

    yield schema

    # Teardown: drop the test schema
    close_pool()
    with psycopg.connect(db_url, row_factory=dict_row) as conn:
        conn.autocommit = True
        _guard_schema(schema)  # double-check
        conn.execute(f"DROP SCHEMA {schema} CASCADE")
    logger.info("Dropped test schema: %s", schema)


@pytest.fixture(scope="session")
def db_pool(test_schema):
    """Return the initialized pool (already set to test schema)."""
    return get_pool()


@pytest.fixture
def db_conn(db_pool):
    """Yield a connection from the pool, auto-rolled-back after each test."""
    with db_pool.connection() as conn:
        yield conn
        conn.rollback()


# --- Helpers for seeding test data ---

def make_event(conn, name="Test Event", event_id=None):
    eid = event_id or uuid.uuid4()
    conn.execute(
        "INSERT INTO events (id, name) VALUES (%s, %s) ON CONFLICT DO NOTHING",
        (str(eid), name),
    )
    conn.commit()
    return eid


def make_participant(conn, event_id, name="Test User", email=None, college="Test College"):
    pid = uuid.uuid4()
    email = email or f"{pid.hex[:8]}@example.com"
    conn.execute(
        "INSERT INTO participants (id, event_id, name, email, college) VALUES (%s, %s, %s, %s, %s)",
        (str(pid), str(event_id), name, email, college),
    )
    conn.commit()
    return pid


def make_staff(conn, name="Vol", email=None, role="volunteer", password_hash="$argon2id$fakehash"):
    sid = uuid.uuid4()
    email = email or f"staff_{sid.hex[:8]}@example.com"
    conn.execute(
        "INSERT INTO staff (id, name, email, password_hash, role) VALUES (%s, %s, %s, %s, %s)",
        (str(sid), str(name), email, password_hash, role),
    )
    conn.commit()
    return sid


def make_signing_key(conn, key_id=1, public_key=b'\x00' * 32):
    conn.execute(
        "INSERT INTO signing_keys (key_id, public_key) VALUES (%s, %s) ON CONFLICT DO NOTHING",
        (key_id, public_key),
    )
    conn.commit()
    return key_id


def make_ticket(conn, event_id, participant_id, key_id=1, ticket_id=None, status="issued"):
    tid = ticket_id or uuid.uuid4()
    conn.execute(
        """INSERT INTO tickets (id, event_id, participant_id, key_id, status)
           VALUES (%s, %s, %s, %s, %s)""",
        (str(tid), str(event_id), str(participant_id), key_id, status),
    )
    conn.commit()
    return tid
