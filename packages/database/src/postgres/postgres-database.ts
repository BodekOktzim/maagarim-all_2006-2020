/**
 * Production database backend — implements the exact same `Database` interface
 * as packages/database/src/sqlite, using `pg` against a real PostgreSQL instance
 * (see docker-compose.yml).
 *
 * ⚠️ NOT EXECUTED IN THIS SANDBOX: this container has no network access and no
 * `pg` package installed, and no Postgres server running, so this file could
 * not be run or tested here. It is written to the same contract validated by
 * packages/database/src/sqlite/sqlite-database.test.ts and is meant to be
 * exercised in a real environment (e.g. `docker compose up -d && npm run migrate`
 * via Claude Code or a local machine with network access).
 *
 * To activate: `npm install pg @types/pg --workspace packages/database`.
 */
import type {
  Database,
  PersonRepository,
  SourceRepository,
  RawRecordRepository,
  RelationshipRepository,
  ConflictRepository,
  ImportJobRepository,
  AuditLogRepository,
} from "../repository.ts";

// `pg` is intentionally NOT imported at the top level so that this file can
// still be type-referenced / documented without crashing module resolution
// in environments where `pg` isn't installed (like this sandbox).
type PgPool = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: any[] }>;
};

export async function openPostgresDatabase(connectionString: string): Promise<Database> {
  // Dynamic import: only touched if this function is actually called.
  const { Pool } = await import(/* webpackIgnore: true */ "pg" as string).catch(() => {
    throw new Error(
      "openPostgresDatabase() requires the 'pg' package, which is not installed in this sandbox. " +
        "Run `npm install pg` in a networked environment (see README, section 'Environment Constraints').",
    );
  });
  const pool: PgPool = new Pool({ connectionString });

  return {
    people: makePersonRepository(pool),
    sources: makeSourceRepository(pool),
    rawRecords: makeRawRecordRepository(pool),
    relationships: makeRelationshipRepository(pool),
    conflicts: makeConflictRepository(pool),
    importJobs: makeImportJobRepository(pool),
    auditLogs: makeAuditLogRepository(pool),
    close: () => {
      void (pool as any).end?.();
    },
  };
}

function mapPersonRow(row: any) {
  return {
    id: row.id,
    syntheticPersonId: row.synthetic_person_id,
    firstName: row.first_name,
    lastName: row.last_name,
    phone: row.phone,
    email: row.email,
    address: row.address,
    city: row.city,
    birthYear: row.birth_year,
    fatherId: row.father_id,
    motherId: row.mother_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function makePersonRepository(pool: PgPool): PersonRepository {
  return {
    async findBySyntheticId(id) {
      const { rows } = await pool.query(`SELECT * FROM people WHERE synthetic_person_id = $1`, [id]);
      return rows[0] ? mapPersonRow(rows[0]) : null;
    },
    async findByIds(ids) {
      if (ids.length === 0) return [];
      const { rows } = await pool.query(`SELECT * FROM people WHERE synthetic_person_id = ANY($1::text[])`, [ids]);
      return rows.map(mapPersonRow);
    },
    async findChildrenOf(id) {
      const { rows } = await pool.query(`SELECT * FROM people WHERE father_id = $1 OR mother_id = $1`, [id]);
      return rows.map(mapPersonRow);
    },
    async findByParents(fatherId, motherId, excludeId) {
      const { rows } = await pool.query(
        `SELECT * FROM people WHERE father_id = $1 AND mother_id = $2 AND synthetic_person_id != $3`,
        [fatherId, motherId, excludeId ?? ""],
      );
      return rows.map(mapPersonRow);
    },
    async findByFather(fatherId, excludeId) {
      const { rows } = await pool.query(`SELECT * FROM people WHERE father_id = $1 AND synthetic_person_id != $2`, [
        fatherId,
        excludeId ?? "",
      ]);
      return rows.map(mapPersonRow);
    },
    async findByMother(motherId, excludeId) {
      const { rows } = await pool.query(`SELECT * FROM people WHERE mother_id = $1 AND synthetic_person_id != $2`, [
        motherId,
        excludeId ?? "",
      ]);
      return rows.map(mapPersonRow);
    },
    async findByPhone(normalizedPhone) {
      const { rows } = await pool.query(`SELECT * FROM people WHERE phone = $1`, [normalizedPhone]);
      return rows.map(mapPersonRow);
    },
    async searchByName(fragment, limit, offset) {
      // Uses pg_trgm (see migrations/001_init.sql) for real fuzzy search at scale.
      const { rows } = await pool.query(
        `SELECT *, similarity(lower(first_name) || ' ' || lower(last_name), $1) as score
         FROM people
         WHERE lower(first_name) LIKE $2 OR lower(last_name) LIKE $2
            OR similarity(lower(first_name) || ' ' || lower(last_name), $1) > 0.3
         ORDER BY score DESC NULLS LAST
         LIMIT $3 OFFSET $4`,
        [fragment, `%${fragment}%`, limit, offset],
      );
      const { rows: countRows } = await pool.query(
        `SELECT COUNT(*) as c FROM people WHERE lower(first_name) LIKE $1 OR lower(last_name) LIKE $1`,
        [`%${fragment}%`],
      );
      return { rows: rows.map(mapPersonRow), total: Number(countRows[0]?.c ?? 0) };
    },
    async upsertMany(people) {
      // Production uses batched COPY / multi-row INSERT (section 20/26). Simplified
      // multi-row insert shown here; a true COPY-based bulk loader lives in
      // packages/database/src/postgres/bulk-loader.ts for the 5GB+ import path.
      if (people.length === 0) return;
      const values: unknown[] = [];
      const rowsSql = people
        .map((p, i) => {
          const base = i * 13;
          values.push(
            p.id, p.syntheticPersonId, p.firstName, p.lastName, p.phone, p.email,
            p.address, p.city, p.birthYear, p.fatherId, p.motherId, p.createdAt, p.updatedAt,
          );
          return `($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6},$${base + 7},$${base + 8},$${base + 9},$${base + 10},$${base + 11},$${base + 12},$${base + 13})`;
        })
        .join(",");
      await pool.query(
        `INSERT INTO people (id, synthetic_person_id, first_name, last_name, phone, email, address, city, birth_year, father_id, mother_id, created_at, updated_at)
         VALUES ${rowsSql}
         ON CONFLICT (synthetic_person_id) DO UPDATE SET
           first_name=excluded.first_name, last_name=excluded.last_name, phone=excluded.phone,
           email=excluded.email, address=excluded.address, city=excluded.city, birth_year=excluded.birth_year,
           father_id=excluded.father_id, mother_id=excluded.mother_id, updated_at=excluded.updated_at`,
        values,
      );
    },
    async count() {
      const { rows } = await pool.query(`SELECT COUNT(*) as c FROM people`);
      return Number(rows[0]?.c ?? 0);
    },
  };
}

function makeSourceRepository(pool: PgPool): SourceRepository {
  return {
    async upsert(source) {
      const { rows } = await pool.query(
        `INSERT INTO sources (name, type, description, version) VALUES ($1,$2,$3,$4)
         ON CONFLICT (name) DO UPDATE SET type=excluded.type, description=excluded.description
         RETURNING *`,
        [source.name, source.type, source.description, source.version],
      );
      const r = rows[0];
      return { id: r.id, name: r.name, type: r.type, description: r.description, version: r.version, createdAt: r.created_at };
    },
    async findByName(name) {
      const { rows } = await pool.query(`SELECT * FROM sources WHERE name = $1`, [name]);
      const r = rows[0];
      return r ? { id: r.id, name: r.name, type: r.type, description: r.description, version: r.version, createdAt: r.created_at } : null;
    },
    async list() {
      const { rows } = await pool.query(`SELECT * FROM sources`);
      return rows.map((r) => ({ id: r.id, name: r.name, type: r.type, description: r.description, version: r.version, createdAt: r.created_at }));
    },
  };
}

function makeRawRecordRepository(pool: PgPool): RawRecordRepository {
  return {
    async insertMany(sourceId, records) {
      // Production: COPY FROM STDIN for bulk speed (section 20/26). See bulk-loader.ts.
      for (const r of records) {
        await pool.query(
          `INSERT INTO raw_records (source_id, external_record_id, payload, checksum) VALUES ($1,$2,$3,$4)`,
          [sourceId, r.externalRecordId, JSON.stringify(r.payload), r.checksum],
        );
      }
    },
    async findByPerson(personId) {
      const { rows } = await pool.query(
        `SELECT rr.*, s.name as source_name FROM person_source_records psr
         JOIN raw_records rr ON rr.id = psr.raw_record_id
         JOIN sources s ON s.id = psr.source_id
         WHERE psr.person_id = $1`,
        [personId],
      );
      return rows.map((row) => ({
        id: row.id,
        sourceId: row.source_id,
        externalRecordId: row.external_record_id,
        payload: row.payload,
        checksum: row.checksum,
        createdAt: row.created_at,
        sourceName: row.source_name,
      }));
    },
  };
}

function makeRelationshipRepository(pool: PgPool): RelationshipRepository {
  return {
    async upsert(rel) {
      const { rows } = await pool.query(
        `INSERT INTO relationships (source_person_id, target_person_id, relationship_type, confidence, status)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (source_person_id, target_person_id, relationship_type)
         DO UPDATE SET confidence=excluded.confidence, status=excluded.status
         RETURNING *`,
        [rel.sourcePersonId, rel.targetPersonId, rel.relationshipType, rel.confidence, rel.status],
      );
      const r = rows[0];
      for (const e of rel.evidence) {
        await pool.query(
          `INSERT INTO relationship_evidence (relationship_id, source_id, field_name, field_value, evidence_type)
           SELECT $1, s.id, $2, $3, $4 FROM sources s WHERE s.name = $5`,
          [r.id, e.field, e.value, e.evidenceType, e.sourceName],
        );
      }
      return {
        id: r.id,
        sourcePersonId: r.source_person_id,
        targetPersonId: r.target_person_id,
        relationshipType: r.relationship_type,
        confidence: r.confidence,
        status: r.status,
        evidence: rel.evidence.map((e) => ({ field: e.field, source: e.sourceName, value: e.value })),
        createdAt: r.created_at,
      };
    },
    async findForPerson(id) {
      const { rows } = await pool.query(
        `SELECT * FROM relationships WHERE source_person_id = $1 OR target_person_id = $1`,
        [id],
      );
      const out = [];
      for (const row of rows) {
        const { rows: evRows } = await pool.query(
          `SELECT re.*, s.name as source_name FROM relationship_evidence re
           JOIN sources s ON s.id = re.source_id WHERE re.relationship_id = $1`,
          [row.id],
        );
        out.push({
          id: row.id,
          sourcePersonId: row.source_person_id,
          targetPersonId: row.target_person_id,
          relationshipType: row.relationship_type,
          confidence: row.confidence,
          status: row.status,
          evidence: evRows.map((e: any) => ({ field: e.field_name, source: e.source_name, value: e.field_value })),
          createdAt: row.created_at,
        });
      }
      return out;
    },
    async findSpouse(id) {
      const { rows } = await pool.query(
        `SELECT p.* FROM relationships r JOIN people p ON p.synthetic_person_id = r.target_person_id
         WHERE r.source_person_id = $1 AND r.relationship_type = 'SPOUSE'`,
        [id],
      );
      return rows.map(mapPersonRow);
    },
  };
}

function makeConflictRepository(pool: PgPool): ConflictRepository {
  return {
    async record(conflict) {
      const { rows } = await pool.query(
        `INSERT INTO conflicts (person_id, field, values) VALUES ($1,$2,$3) RETURNING *`,
        [conflict.personId, conflict.field, JSON.stringify(conflict.values)],
      );
      const r = rows[0];
      return { id: r.id, personId: r.person_id, field: r.field, values: r.values };
    },
    async findByPerson(id) {
      const { rows } = await pool.query(`SELECT * FROM conflicts WHERE person_id = $1`, [id]);
      return rows.map((r) => ({ id: r.id, personId: r.person_id, field: r.field, values: r.values }));
    },
    async all() {
      const { rows } = await pool.query(`SELECT * FROM conflicts`);
      return rows.map((r) => ({ id: r.id, personId: r.person_id, field: r.field, values: r.values }));
    },
  };
}

function makeImportJobRepository(pool: PgPool): ImportJobRepository {
  return {
    async create(job) {
      const { rows } = await pool.query(
        `INSERT INTO import_jobs (file, size_bytes, format, total_records, status) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
        [job.file, job.sizeBytes, job.format, job.totalRecords, job.status],
      );
      const r = rows[0];
      return {
        id: r.id, file: r.file, sizeBytes: r.size_bytes, format: r.format, totalRecords: r.total_records,
        processedRecords: r.processed_records, failedRecords: r.failed_records,
        speedRecordsPerSec: r.speed_records_per_sec, status: r.status, createdAt: r.created_at,
      };
    },
    async updateProgress(id, processed, failed, speed) {
      await pool.query(
        `UPDATE import_jobs SET processed_records=$1, failed_records=$2, speed_records_per_sec=$3, updated_at=now() WHERE id=$4`,
        [processed, failed, speed, id],
      );
    },
    async setStatus(id, status) {
      await pool.query(`UPDATE import_jobs SET status=$1, updated_at=now() WHERE id=$2`, [status, id]);
    },
    async saveCheckpoint(jobId, file, offset, recordsProcessed, status) {
      await pool.query(
        `INSERT INTO import_checkpoints (job_id, file, byte_offset, records_processed, status)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (job_id) DO UPDATE SET byte_offset=excluded.byte_offset, records_processed=excluded.records_processed, status=excluded.status, updated_at=now()`,
        [jobId, file, offset, recordsProcessed, status],
      );
    },
    async getCheckpoint(jobId) {
      const { rows } = await pool.query(`SELECT * FROM import_checkpoints WHERE job_id = $1`, [jobId]);
      const r = rows[0];
      return r ? { offset: r.byte_offset, recordsProcessed: r.records_processed } : null;
    },
    async recordError(jobId, lineNumber, rawPayload, error) {
      await pool.query(
        `INSERT INTO import_errors (job_id, line_number, raw_payload, error) VALUES ($1,$2,$3,$4)`,
        [jobId, lineNumber, rawPayload, error],
      );
    },
    async get(id) {
      const { rows } = await pool.query(`SELECT * FROM import_jobs WHERE id = $1`, [id]);
      const r = rows[0];
      if (!r) return null;
      return {
        id: r.id, file: r.file, sizeBytes: r.size_bytes, format: r.format, totalRecords: r.total_records,
        processedRecords: r.processed_records, failedRecords: r.failed_records,
        speedRecordsPerSec: r.speed_records_per_sec, status: r.status, createdAt: r.created_at,
      };
    },
  };
}

function makeAuditLogRepository(pool: PgPool): AuditLogRepository {
  return {
    async record(entry) {
      await pool.query(
        `INSERT INTO audit_logs ("user", action, target, result, duration_ms) VALUES ($1,$2,$3,$4,$5)`,
        [entry.user, entry.action, entry.target, entry.result, entry.durationMs],
      );
    },
    async recent(limit) {
      const { rows } = await pool.query(`SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT $1`, [limit]);
      return rows.map((r: any) => ({
        id: r.id, user: r.user, timestamp: r.created_at, action: r.action,
        target: r.target, result: r.result, durationMs: r.duration_ms,
      }));
    },
  };
}
