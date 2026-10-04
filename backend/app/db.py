"""Database pool, migration runner, and health check."""

import logging
from pathlib import Path

import psycopg
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

logger = logging.getLogger(__name__)

_pool: ConnectionPool | None = None
_schema: str = "public"

MIGRATIONS_DIR = Path(__file__).resolve().parent.parent / "migrations"


def _configure_conn(conn: psycopg.Connection) -> None:
    """Set search_path on every connection from the pool."""
    conn.execute(f"SET search_path TO {_schema}")
    conn.commit()


def get_pool() -> ConnectionPool:
    if _pool is None:
        raise RuntimeError("Pool not initialized — call init_pool() first")
    return _pool


def init_pool(database_url: str, max_size: int = 5, schema: str = "public") -> ConnectionPool:
    """Create the connection pool. Call once at startup."""
    global _pool, _schema
    _schema = schema

    # Close existing pool if any
    if _pool is not None:
        try:
            _pool.close()
        except Exception:
            pass

    _pool = ConnectionPool(
        conninfo=database_url,
        min_size=1,
        max_size=max_size,
        kwargs={"row_factory": dict_row, "autocommit": False},
        configure=_configure_conn,
        open=False,
    )
    _pool.open(wait=True, timeout=30)
    return _pool


def close_pool() -> None:
    global _pool
    if _pool:
        _pool.close()
        _pool = None


def health_check() -> dict:
    """Report server version, max_connections, and role connection limit."""
    pool = get_pool()
    with pool.connection() as conn:
        ver = conn.execute("SHOW server_version").fetchone()["server_version"]
        max_conn = conn.execute("SHOW max_connections").fetchone()["max_connections"]
        role_limit = conn.execute(
            "SELECT rolconnlimit FROM pg_roles WHERE rolname = current_user"
        ).fetchone()
        role_limit_val = role_limit["rolconnlimit"] if role_limit else -1
    info = {
        "server_version": ver,
        "max_connections": int(max_conn),
        "role_connection_limit": role_limit_val,
    }
    logger.info("DB health: %s", info)
    return info


def run_migrations() -> list[str]:
    """
    Apply pending SQL migrations from migrations/ directory.
    Returns list of applied migration filenames.
    """
    pool = get_pool()
    applied = []

    with pool.connection() as conn:
        # Ensure schema_migrations table exists
        conn.execute("""
            CREATE TABLE IF NOT EXISTS schema_migrations (
                version TEXT PRIMARY KEY,
                applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
            )
        """)
        conn.commit()

        # Get already-applied versions
        rows = conn.execute("SELECT version FROM schema_migrations ORDER BY version").fetchall()
        done = {r["version"] for r in rows}

        # Find and sort migration files
        migration_files = sorted(MIGRATIONS_DIR.glob("*.sql"))

        for mfile in migration_files:
            if mfile.name in done:
                continue
            sql = mfile.read_text()
            logger.info("Applying migration: %s", mfile.name)
            conn.execute(sql)
            conn.execute(
                "INSERT INTO schema_migrations (version) VALUES (%s)",
                (mfile.name,),
            )
            conn.commit()
            applied.append(mfile.name)
            logger.info("Applied: %s", mfile.name)

    return applied
