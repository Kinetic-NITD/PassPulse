# PassPulse — Single-Use QR Check-In System

A QR-based event entry system for hackathons and conferences. Participants receive unique QR codes by email, volunteers scan them at the venue to verify identity and check-in, and each QR admits exactly once — even under concurrent scans.

## Architecture

```
Backend:   Python 3.11+ / FastAPI / psycopg 3 / Ed25519 / argon2id
Frontend:  Next.js 15 (App Router) / TypeScript / qr-scanner
Database:  PostgreSQL 17
```

### Flow

1. **Admin** imports participants via CSV → issues tickets → sends QR emails
2. **Participant** receives email with unique QR code (Ed25519-signed)
3. **Volunteer** scans QR at gate → sees participant details → checks physical ID → confirms + assigns ID card
4. System enforces **exactly-once admission** via atomic SQL with lease-based state machine

### State Machine

```
issued → pending (volunteer scans, 60s lease)
pending → checked_in (volunteer confirms with ID card number)
pending → issued (volunteer cancels or lease expires)
issued/pending → revoked (admin action)
revoked → issued (reissue: new ticket ID, old revoked)
```

## Quick Start

### Prerequisites

- Python 3.11+
- Node.js 18+ and [Bun](https://bun.sh)
- PostgreSQL (local or hosted)

### 1. Clone and configure

```bash
cp .env.example .env
# Edit .env with your DATABASE_URL and other settings
```

### 2. Generate signing keypair

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python scripts/generate_keypair.py
# Copy SIGNING_PRIVATE_KEY to .env, answer 'y' to register in DB
```

### 3. Seed demo data

```bash
python scripts/seed.py
```

Demo logins (password: `pass1234`):
| Email | Role |
|-------|------|
| admin@passpulse.dev | admin |
| supervisor@passpulse.dev | supervisor |
| vol1@passpulse.dev | volunteer |
| vol2@passpulse.dev | volunteer |

### 4. Start backend

```bash
cd backend
source .venv/bin/activate
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

### 5. Start frontend

```bash
cd frontend
bun install
bun dev
```

Open http://localhost:3000

## API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/auth/login` | — | Staff login → JWT |
| POST | `/api/scan` | volunteer+ | Scan QR, claim lease |
| POST | `/api/confirm` | volunteer+ | Confirm check-in with ID card |
| POST | `/api/cancel` | volunteer+ | Release lease |
| GET | `/api/participants/search?q=` | volunteer+ | Search participants |
| GET | `/api/participants` | volunteer+ | List participants |
| POST | `/api/participants/import` | admin | CSV import |
| POST | `/api/tickets/issue` | admin | Issue tickets |
| POST | `/api/emails/send` | admin | Send QR emails (mocked) |
| GET | `/api/tickets/export-csv` | admin | Export CSV with QR tokens |
| GET | `/api/tickets/{id}/qr.png` | — | QR code PNG |
| POST | `/api/tickets/{id}/revoke` | admin | Revoke ticket |
| POST | `/api/tickets/{id}/reissue` | admin | Reissue ticket |
| POST | `/api/tickets/{id}/override` | supervisor | Override checked-in ticket |
| GET | `/api/stats` | admin | Event statistics |
| GET | `/api/scan-log` | volunteer+ | Scan activity log |
| GET | `/api/health` | — | Health check |
| GET | `/api/public-keys` | — | Active signing keys |
| GET | `/t/{token}` | — | Public ticket page |

## Testing

### Backend tests (requires PostgreSQL)

```bash
cd backend
source .venv/bin/activate
python -m pytest tests/ -v
```

Tests create an isolated `test_<random>` schema, run migrations, execute tests, and drop the schema.

### Load test

```bash
python -m pytest tests/test_load.py -v -s
```

200 concurrent scan+confirm at concurrency 20, reports p50/p95 latency.

### Frontend unit tests

```bash
cd frontend
bun run test
```

### E2E tests (Playwright)

```bash
cd frontend
bunx playwright install chromium
bunx playwright test
```

## Security

- **Ed25519 signatures** on QR tokens — tampered tokens rejected before touching DB
- **argon2id** password hashing
- **Short-lived JWT** (8h default) for staff auth
- **Role-based access**: volunteer < supervisor < admin
- **Per-staff rate limiting** on scan endpoints
- **Atomic SQL** with row-level locking prevents double check-in
- **CORS** restricted to frontend origin
- **No sensitive data** revealed on public ticket page

## Project Structure

```
PassPulse/
├── backend/
│   ├── app/
│   │   ├── config.py         # Env loader
│   │   ├── db.py             # Pool, migrations
│   │   ├── tokens.py         # Ed25519 sign/verify
│   │   ├── auth.py           # JWT + argon2
│   │   ├── services.py       # State machine
│   │   ├── qr.py             # QR image generation
│   │   ├── key_cache.py      # In-memory key cache
│   │   ├── ratelimit.py      # Per-staff rate limiter
│   │   ├── main.py           # FastAPI app
│   │   └── routes/           # API routes
│   ├── migrations/           # SQL migrations
│   ├── scripts/              # Keypair gen, seed
│   └── tests/                # pytest + load tests
├── frontend/
│   ├── src/app/              # Next.js pages
│   ├── src/lib/              # Token verifier, API client
│   └── tests/                # Vitest + Playwright
├── .env.example
└── README.md
```

## Environment Variables

See [`.env.example`](.env.example) for all required variables.

Key variables:
- `DATABASE_URL` — PostgreSQL connection string
- `SIGNING_PRIVATE_KEY` — Base64 Ed25519 seed (32 bytes)
- `SIGNING_KEY_ID` — Key ID for token signing
- `JWT_SECRET` — Secret for JWT signing
- `PUBLIC_BASE_URL` — Frontend URL (for QR code URLs)
