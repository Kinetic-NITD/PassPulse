"""FastAPI application entry point."""

import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

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

app.include_router(public_router)
app.include_router(auth_router)
app.include_router(scan_router)
app.include_router(supervisor_router)
app.include_router(admin_router)


@app.get("/api/health")
def api_health():
    info = health_check()
    return {"status": "ok", **info}