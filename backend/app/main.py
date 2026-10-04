"""FastAPI application entry point."""

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app import config
from app.db import init_pool, close_pool, health_check, run_migrations

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    logger.info("Initializing database pool (max_size=%d)...", config.DB_POOL_MAX)
    init_pool(config.DATABASE_URL, max_size=config.DB_POOL_MAX)
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
    yield
    # Shutdown
    close_pool()
    logger.info("Database pool closed.")


app = FastAPI(title="PassPulse", version="1.0.0", lifespan=lifespan)

# CORS — restrict to frontend origin
allowed_origins = [config.PUBLIC_BASE_URL]
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
def api_health():
    info = health_check()
    return {"status": "ok", **info}
