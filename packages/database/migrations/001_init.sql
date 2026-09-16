-- Synthetic Data Lab — initial schema (Phase 2)
-- All data described by this schema is SYNTHETIC ONLY. See README.md.

CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS pg_trgm;    -- fuzzy / trigram name search

-- ---------------------------------------------------------------------------
-- sources
-- ---------------------------------------------------------------------------
CREATE TABLE sources (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT UNIQUE NOT NULL,          -- SYNTHETIC_SOURCE_01, ...
    type        TEXT NOT NULL,                 -- structured | social | phone
    description TEXT,
    version     TEXT NOT NULL DEFAULT '1.0',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- people  (resolved / canonical synthetic entities)
-- ---------------------------------------------------------------------------
CREATE TABLE people (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    synthetic_person_id TEXT UNIQUE NOT NULL,   -- P00000001
    first_name          TEXT,
    last_name           TEXT,
    phone               TEXT,                   -- normalized synthetic phone
    email               TEXT,
    address             TEXT,
    city                TEXT,
    birth_year          INTEGER,
    father_id           TEXT REFERENCES people(synthetic_person_id),
    mother_id           TEXT REFERENCES people(synthetic_person_id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_people_synthetic_id ON people (synthetic_person_id);
CREATE INDEX idx_people_phone        ON people (phone);
CREATE INDEX idx_people_first_name   ON people USING gin (first_name gin_trgm_ops);
CREATE INDEX idx_people_last_name    ON people USING gin (last_name gin_trgm_ops);
CREATE INDEX idx_people_father       ON people (father_id);
CREATE INDEX idx_people_mother       ON people (mother_id);
-- Composite index used directly by the sibling algorithm (see packages/relationships)
CREATE INDEX idx_people_parents      ON people (father_id, mother_id);

-- ---------------------------------------------------------------------------
-- raw_records  (untouched original rows from every imported source)
-- ---------------------------------------------------------------------------
CREATE TABLE raw_records (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id         UUID NOT NULL REFERENCES sources(id),
    external_record_id TEXT NOT NULL,
    payload           JSONB NOT NULL,
    checksum          TEXT NOT NULL,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_raw_records_source   ON raw_records (source_id);
CREATE INDEX idx_raw_records_payload  ON raw_records USING gin (payload);

-- ---------------------------------------------------------------------------
-- source_fields  (which fields a given source contributed for a person)
-- ---------------------------------------------------------------------------
CREATE TABLE source_fields (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id  UUID NOT NULL REFERENCES sources(id),
    field_name TEXT NOT NULL
);

-- ---------------------------------------------------------------------------
-- person_source_records  (link: resolved person <-> raw record that contributed to it)
-- ---------------------------------------------------------------------------
CREATE TABLE person_source_records (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    person_id        TEXT NOT NULL REFERENCES people(synthetic_person_id),
    raw_record_id    UUID NOT NULL REFERENCES raw_records(id),
    source_id        UUID NOT NULL REFERENCES sources(id),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_psr_person ON person_source_records (person_id);

-- ---------------------------------------------------------------------------
-- relationships
-- ---------------------------------------------------------------------------
CREATE TABLE relationships (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_person_id    TEXT NOT NULL REFERENCES people(synthetic_person_id),
    target_person_id    TEXT NOT NULL REFERENCES people(synthetic_person_id),
    relationship_type   TEXT NOT NULL,   -- PARENT | CHILD | SIBLING | ...
    confidence          TEXT NOT NULL,   -- CONFIRMED | HIGH | MEDIUM | LOW | UNRESOLVED | CONFLICT
    status              TEXT NOT NULL,   -- CONFIRMED | POSSIBLE_RELATION | UNRESOLVED_CANDIDATE
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (source_person_id, target_person_id, relationship_type)
);

CREATE INDEX idx_rel_source ON relationships (source_person_id);
CREATE INDEX idx_rel_target ON relationships (target_person_id);

-- ---------------------------------------------------------------------------
-- relationship_evidence
-- ---------------------------------------------------------------------------
CREATE TABLE relationship_evidence (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    relationship_id UUID NOT NULL REFERENCES relationships(id) ON DELETE CASCADE,
    source_id       UUID NOT NULL REFERENCES sources(id),
    field_name      TEXT NOT NULL,
    field_value     TEXT NOT NULL,
    evidence_type   TEXT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_rel_evidence_relationship ON relationship_evidence (relationship_id);

-- ---------------------------------------------------------------------------
-- conflicts
-- ---------------------------------------------------------------------------
CREATE TABLE conflicts (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    person_id   TEXT NOT NULL REFERENCES people(synthetic_person_id),
    field       TEXT NOT NULL,
    values      JSONB NOT NULL,  -- [{source, value, timestamp, confidence}, ...]
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_conflicts_person ON conflicts (person_id);

-- ---------------------------------------------------------------------------
-- import_jobs / import_checkpoints
-- ---------------------------------------------------------------------------
CREATE TABLE import_jobs (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    file                  TEXT NOT NULL,
    size_bytes            BIGINT NOT NULL,
    format                TEXT NOT NULL,
    total_records         BIGINT,
    processed_records     BIGINT NOT NULL DEFAULT 0,
    failed_records        BIGINT NOT NULL DEFAULT 0,
    speed_records_per_sec NUMERIC,
    status                TEXT NOT NULL DEFAULT 'PENDING',
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE import_checkpoints (
    job_id            UUID PRIMARY KEY REFERENCES import_jobs(id) ON DELETE CASCADE,
    file              TEXT NOT NULL,
    byte_offset       BIGINT NOT NULL,
    records_processed BIGINT NOT NULL,
    status            TEXT NOT NULL,
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE import_errors (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id      UUID NOT NULL REFERENCES import_jobs(id) ON DELETE CASCADE,
    line_number BIGINT,
    raw_payload TEXT,
    error       TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- audit_logs / ai_operations
-- ---------------------------------------------------------------------------
CREATE TABLE audit_logs (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "user"      TEXT NOT NULL,
    action      TEXT NOT NULL,
    target      TEXT,
    result      TEXT,
    duration_ms INTEGER,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE ai_operations (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tool_name   TEXT NOT NULL,
    input       JSONB NOT NULL,
    output      JSONB,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
