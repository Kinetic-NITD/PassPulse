"""Tests for DB connectivity, migration runner, and schema setup."""

import pytest
from tests.conftest import make_event, make_participant, make_staff, make_signing_key, make_ticket


class TestDBSetup:
    """Verify database connectivity and schema creation."""

    def test_schema_exists(self, test_schema, db_pool):
        """The test schema was created and pool is connected."""
        assert test_schema.startswith("test_")
        with db_pool.connection() as conn:
            row = conn.execute("SELECT current_schema()").fetchone()
            assert row["current_schema"] == test_schema

    def test_health_check(self, test_schema, db_pool):
        """Health check returns server info."""
        from app.db import health_check
        info = health_check()
        assert "server_version" in info
        assert info["max_connections"] > 0

    def test_migrations_applied(self, test_schema, db_pool):
        """All migrations were applied."""
        with db_pool.connection() as conn:
            rows = conn.execute("SELECT version FROM schema_migrations ORDER BY version").fetchall()
            versions = [r["version"] for r in rows]
            assert "001_initial.sql" in versions

    def test_tables_exist(self, test_schema, db_pool):
        """All required tables exist in the test schema."""
        expected_tables = {"events", "staff", "participants", "signing_keys", "tickets", "scan_log", "schema_migrations"}
        with db_pool.connection() as conn:
            rows = conn.execute(
                "SELECT table_name FROM information_schema.tables WHERE table_schema = %s",
                (test_schema,),
            ).fetchall()
            tables = {r["table_name"] for r in rows}
            assert expected_tables.issubset(tables), f"Missing: {expected_tables - tables}"

    def test_insert_and_query(self, test_schema, db_conn):
        """Basic CRUD works in the test schema."""
        eid = make_event(db_conn, "Schema Test Event")
        pid = make_participant(db_conn, eid, "Alice", "alice@example.com")
        sid = make_staff(db_conn, "Bob", "bob@example.com")
        kid = make_signing_key(db_conn, key_id=99, public_key=b'\x01' * 32)
        tid = make_ticket(db_conn, eid, pid, key_id=99)

        row = db_conn.execute("SELECT * FROM tickets WHERE id = %s", (str(tid),)).fetchone()
        assert row["status"] == "issued"
        assert row["participant_id"] == tid.__class__(str(pid))  # UUID comparison

    def test_unique_active_ticket_constraint(self, test_schema, db_conn):
        """Cannot have two active tickets for the same participant."""
        eid = make_event(db_conn, "Unique Test")
        pid = make_participant(db_conn, eid, "Carol", "carol@example.com")
        make_signing_key(db_conn, key_id=98, public_key=b'\x02' * 32)
        make_ticket(db_conn, eid, pid, key_id=98)

        import psycopg
        with pytest.raises(psycopg.errors.UniqueViolation):
            make_ticket(db_conn, eid, pid, key_id=98)

    def test_schema_safety_guard(self):
        """Safety guard rejects non-test schemas."""
        from tests.conftest import _guard_schema
        with pytest.raises(RuntimeError, match="SAFETY"):
            _guard_schema("public")
        with pytest.raises(RuntimeError, match="SAFETY"):
            _guard_schema("production")
        # Should not raise
        _guard_schema("test_abc123")
