"""Configuration loader — all from environment variables."""

import os
from pathlib import Path
from dotenv import load_dotenv

# Load .env from project root
_env_path = Path(__file__).resolve().parent.parent.parent / ".env"
load_dotenv(_env_path)


def _require(name: str) -> str:
    val = os.environ.get(name)
    if not val:
        raise RuntimeError(f"Missing required env var: {name}")
    return val


# Database
DATABASE_URL: str = _require("DATABASE_URL")
DB_POOL_MAX: int = int(os.environ.get("DB_POOL_MAX", "5"))

# Signing
SIGNING_PRIVATE_KEY: str = _require("SIGNING_PRIVATE_KEY")  # base64 32-byte seed
SIGNING_KEY_ID: int = int(_require("SIGNING_KEY_ID"))

# Public URL
PUBLIC_BASE_URL: str = _require("PUBLIC_BASE_URL").rstrip("/")

# JWT
JWT_SECRET: str = _require("JWT_SECRET")
JWT_EXPIRY_HOURS: int = int(os.environ.get("JWT_EXPIRY_HOURS", "8"))

# SMTP
SMTP_HOST: str = os.environ.get("SMTP_HOST", "")
SMTP_PORT: int = int(os.environ.get("SMTP_PORT", "587"))
SMTP_USER: str = os.environ.get("SMTP_USER", "")
SMTP_PASSWORD: str = os.environ.get("SMTP_PASSWORD", "")
SMTP_FROM: str = os.environ.get("SMTP_FROM", "")

# Rate limiting
EMAIL_RATE_PER_SEC: float = float(os.environ.get("EMAIL_RATE_PER_SEC", "2"))
LEASE_SECONDS: int = int(os.environ.get("LEASE_SECONDS", "60"))
