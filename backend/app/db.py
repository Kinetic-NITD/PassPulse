def init_pool(database_url: str, max_size: int = 5, schema: str | None = None) -> ConnectionPool:
    """Create the connection pool. Call once at startup."""
    global _pool, _schema

    target_schema = schema or os.environ.get("DB_SCHEMA") or "public"

    # Verify/create target schema
    try:
        with psycopg.connect(database_url, autocommit=True) as temp_conn:
            if target_schema == "public":
                can_use = temp_conn.execute(
                    "SELECT has_schema_privilege('public', 'usage')"
                ).fetchone()
                if not can_use or not can_use[0]:
                    user_row = temp_conn.execute("SELECT current_user").fetchone()
                    if user_row:
                        target_schema = user_row[0]
            temp_conn.execute(f'CREATE SCHEMA IF NOT EXISTS "{target_schema}"')
    except Exception as e:
        logger.warning("Could not auto-create/verify schema %s: %s", target_schema, e)

    _schema = target_schema

    if _pool is not None:
        try:
            _pool.close()
        except Exception:
            pass

    # Serverless-friendly: min_size=0 so we don't hold idle conns
    _pool = ConnectionPool(
        conninfo=database_url,
        min_size=0,
        max_size=max_size,
        kwargs={"row_factory": dict_row, "autocommit": False},
        configure=_configure_conn,
        open=False,
    )
    _pool.open(wait=False)
    return _pool