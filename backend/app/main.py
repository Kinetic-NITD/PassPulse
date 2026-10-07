"""FastAPI application entry point."""

import base64
import logging
import os
import traceback
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from cryptography.hazmat.primitives.asymmetric import ed25519
from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat

from app import config
from app.db import init_pool, close_pool, health_check, run_migrations

from app.key_cache import refresh_public_keys
from app.routes.auth_routes import router as auth_router
from app.routes.scan_routes import router as scan_router
from app.routes.public_routes import router as public_router
from app.routes.supervisor_routes import router as supervisor_router
from app.routes.admin_routes import router as admin_router

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    logger.info("Initializing database pool (max_size=%d)...", config.DB_POOL_MAX)
    pool = init_pool(config.DATABASE_URL, max_size=config.DB_POOL_MAX)
    info = health_check()
    logger.info(
        "Connected to PostgreSQL %s (max_connections=%s, role_limit=%s)",
        info["server_version"],
        info["max_connections"],
        info["role_connection_limit"],
    )
    applied = run_migrations()
    if applied:
        logger.info("Applied %d migration(s): %s", len(applied), applied)
    else:
        logger.info("All migrations up to date.")

    # ─── Ensure signing key is registered in DB ───────────────────
    # Idempotent: safe on every cold start. Recovers from a wiped DB.
    try:
        _seed = base64.b64decode(config.SIGNING_PRIVATE_KEY)
        if len(_seed) != 32:
            raise ValueError(f"SIGNING_PRIVATE_KEY must decode to 32 bytes, got {len(_seed)}")
        _priv = ed25519.Ed25519PrivateKey.from_private_bytes(_seed)
        _pub = _priv.public_key().public_bytes(Encoding.Raw, PublicFormat.Raw)

        with pool.connection() as conn:
            conn.execute(
                """
                INSERT INTO signing_keys (key_id, public_key, active)
                VALUES (%s, %s, true)
                ON CONFLICT (key_id) DO UPDATE
                SET public_key = EXCLUDED.public_key, active = true
                """,
                (config.SIGNING_KEY_ID, _pub),
            )
            conn.commit()
        logger.info("Signing key %s registered/updated in DB", config.SIGNING_KEY_ID)
    except Exception as e:
        logger.error("Failed to register signing key: %s", e)

    # Refresh public key cache
    with pool.connection() as conn:
        keys = refresh_public_keys(conn)
        logger.info("Loaded %d active signing key(s) into memory cache", len(keys))

    yield
    # Shutdown
    close_pool()
    logger.info("Database pool closed.")


app = FastAPI(title="PassPulse", version="1.0.0", lifespan=lifespan)

# ─── CORS ─────────────────────────────────────────────────────────
# Comma-separated list of allowed origins from env.
# Falls back to PUBLIC_BASE_URL + localhost for dev.
_origins_env = os.environ.get("ALLOWED_ORIGINS", "").strip()
if _origins_env:
    allowed_origins = [o.strip() for o in _origins_env.split(",") if o.strip()]
else:
    allowed_origins = [config.PUBLIC_BASE_URL, "http://localhost:3000", "http://127.0.0.1:3000"]

logger.info("CORS allowed origins: %s", allowed_origins)

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ─── Global exception handler ─────────────────────────────────────
# Ensures 500s still carry CORS headers so the browser shows the real
# error instead of a misleading CORS block.
@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    traceback.print_exc()

    origin = request.headers.get("origin", "")
    allow = origin if origin in allowed_origins else (
        allowed_origins[0] if allowed_origins else "*"
    )

    return JSONResponse(
        status_code=500,
        content={"detail": "Internal server error", "error": str(exc)},
        headers={
            "Access-Control-Allow-Origin": allow,
            "Access-Control-Allow-Credentials": "true",
            "Vary": "Origin",
        },
    )


app.include_router(public_router)
app.include_router(auth_router)
app.include_router(scan_router)
app.include_router(supervisor_router)
app.include_router(admin_router)


@app.get("/api/health")
def api_health():
    info = health_check()
    return {"status": "ok", **info}