-- Migration 001: Initial schema

CREATE TABLE events (
    id UUID PRIMARY KEY,
    name TEXT NOT NULL,
    starts_at TIMESTAMPTZ,
    ends_at TIMESTAMPTZ
);

CREATE TABLE staff (
    id UUID PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('volunteer', 'supervisor', 'admin')),
    active BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE participants (
    id UUID PRIMARY KEY,
    event_id UUID NOT NULL REFERENCES events(id),
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    college TEXT,
    photo_url TEXT,
    UNIQUE (event_id, email)
);

CREATE TABLE signing_keys (
    key_id SMALLINT PRIMARY KEY,
    public_key BYTEA NOT NULL,
    active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE tickets (
    id UUID PRIMARY KEY,
    event_id UUID NOT NULL REFERENCES events(id),
    participant_id UUID NOT NULL REFERENCES participants(id),
    status TEXT NOT NULL DEFAULT 'issued'
        CHECK (status IN ('issued', 'pending', 'checked_in', 'revoked')),
    key_id SMALLINT NOT NULL REFERENCES signing_keys(key_id),
    pending_by UUID REFERENCES staff(id),
    pending_until TIMESTAMPTZ,
    checked_in_at TIMESTAMPTZ,
    checked_in_by UUID REFERENCES staff(id),
    id_card_no TEXT,
    replaced_by UUID REFERENCES tickets(id),
    revoked_reason TEXT,
    email_sent_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX one_active_ticket ON tickets(participant_id)
    WHERE status IN ('issued', 'pending', 'checked_in');

CREATE UNIQUE INDEX one_card_per_event ON tickets(event_id, id_card_no)
    WHERE id_card_no IS NOT NULL;

CREATE TABLE scan_log (
    id BIGSERIAL PRIMARY KEY,
    ticket_id UUID,
    event_id UUID,
    staff_id UUID REFERENCES staff(id),
    action TEXT NOT NULL,
    result TEXT NOT NULL,
    detail JSONB,
    scanned_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX ON scan_log(ticket_id, scanned_at);
