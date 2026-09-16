-- Synthetic Data Lab — SQLite schema for local/sandbox execution & tests.
-- Structurally mirrors packages/database/migrations/001_init.sql (Postgres, production)
-- but adapted to SQLite types (TEXT instead of UUID/JSONB, no GIN indexes).
-- All data is SYNTHETIC ONLY.

CREATE TABLE IF NOT EXISTS sources (
    id          TEXT PRIMARY KEY,
    name        TEXT UNIQUE NOT NULL,
    type        TEXT NOT NULL,
    description TEXT,
    version     TEXT NOT NULL DEFAULT '1.0',
    created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS people (
    id                  TEXT PRIMARY KEY,
    synthetic_person_id TEXT UNIQUE NOT NULL,
    first_name          TEXT,
    last_name           TEXT,
    phone               TEXT,
    email               TEXT,
    address             TEXT,
    city                TEXT,
    birth_year          INTEGER,
    father_id           TEXT,
    mother_id           TEXT,
    created_at          TEXT NOT NULL,
    updated_at          TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_people_phone      ON people (phone);
CREATE INDEX IF NOT EXISTS idx_people_first_name ON people (first_name);
CREATE INDEX IF NOT EXISTS idx_people_last_name  ON people (last_name);
CREATE INDEX IF NOT EXISTS idx_people_parents    ON people (father_id, mother_id);
CREATE INDEX IF NOT EXISTS idx_people_father     ON people (father_id);
CREATE INDEX IF NOT EXISTS idx_people_mother     ON people (mother_id);

CREATE TABLE IF NOT EXISTS raw_records (
    id                  TEXT PRIMARY KEY,
    source_id           TEXT NOT NULL REFERENCES sources(id),
    external_record_id  TEXT NOT NULL,
    payload             TEXT NOT NULL, -- JSON-encoded
    checksum            TEXT NOT NULL,
    created_at          TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_raw_records_source ON raw_records (source_id);

CREATE TABLE IF NOT EXISTS person_source_records (
    id            TEXT PRIMARY KEY,
    person_id     TEXT NOT NULL,
    raw_record_id TEXT NOT NULL REFERENCES raw_records(id),
    source_id     TEXT NOT NULL REFERENCES sources(id),
    created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_psr_person ON person_source_records (person_id);

CREATE TABLE IF NOT EXISTS relationships (
    id                 TEXT PRIMARY KEY,
    source_person_id   TEXT NOT NULL,
    target_person_id   TEXT NOT NULL,
    relationship_type  TEXT NOT NULL,
    confidence         TEXT NOT NULL,
    status             TEXT NOT NULL,
    created_at         TEXT NOT NULL,
    UNIQUE (source_person_id, target_person_id, relationship_type)
);
CREATE INDEX IF NOT EXISTS idx_rel_source ON relationships (source_person_id);
CREATE INDEX IF NOT EXISTS idx_rel_target ON relationships (target_person_id);

CREATE TABLE IF NOT EXISTS relationship_evidence (
    id              TEXT PRIMARY KEY,
    relationship_id TEXT NOT NULL REFERENCES relationships(id),
    source_name     TEXT NOT NULL,
    field_name      TEXT NOT NULL,
    field_value     TEXT NOT NULL,
    evidence_type   TEXT NOT NULL,
    created_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rel_evidence_relationship ON relationship_evidence (relationship_id);

CREATE TABLE IF NOT EXISTS conflicts (
    id          TEXT PRIMARY KEY,
    person_id   TEXT NOT NULL,
    field       TEXT NOT NULL,
    values_json TEXT NOT NULL, -- JSON array
    created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_conflicts_person ON conflicts (person_id);

CREATE TABLE IF NOT EXISTS import_jobs (
    id                    TEXT PRIMARY KEY,
    file                  TEXT NOT NULL,
    size_bytes            INTEGER NOT NULL,
    format                TEXT NOT NULL,
    total_records         INTEGER,
    processed_records     INTEGER NOT NULL DEFAULT 0,
    failed_records        INTEGER NOT NULL DEFAULT 0,
    speed_records_per_sec REAL,
    status                TEXT NOT NULL DEFAULT 'PENDING',
    created_at            TEXT NOT NULL,
    updated_at            TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS import_checkpoints (
    job_id            TEXT PRIMARY KEY REFERENCES import_jobs(id),
    file              TEXT NOT NULL,
    byte_offset       INTEGER NOT NULL,
    records_processed INTEGER NOT NULL,
    status            TEXT NOT NULL,
    updated_at        TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS import_errors (
    id          TEXT PRIMARY KEY,
    job_id      TEXT NOT NULL REFERENCES import_jobs(id),
    line_number INTEGER,
    raw_payload TEXT,
    error       TEXT NOT NULL,
    created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_logs (
    id          TEXT PRIMARY KEY,
    user_name   TEXT NOT NULL,
    action      TEXT NOT NULL,
    target      TEXT,
    result      TEXT,
    duration_ms INTEGER,
    created_at  TEXT NOT NULL
);
