import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import type {
  Person,
  Source,
  RawRecord,
  Relationship,
  RelationshipEvidenceItem,
  Conflict,
  ImportJob,
  ImportJobStatus,
  AuditLogEntry,
  SyntheticPersonId,
} from "@sdl/types";
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

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Opens (or creates) a SQLite-backed Database. Pass ":memory:" for tests,
 * or a file path for a persistent local dev database.
 *
 * NOTE: this is the sandbox/dev backend. Production uses
 * packages/database/src/postgres (same `Database` interface, `pg` driver).
 */
export function openSqliteDatabase(path: string = ":memory:"): Database {
  const db = new DatabaseSync(path);
  db.exec("PRAGMA foreign_keys = ON;");
  const schema = readFileSync(join(__dirname, "schema.sql"), "utf-8");
  db.exec(schema);

  return {
    people: makePersonRepository(db),
    sources: makeSourceRepository(db),
    rawRecords: makeRawRecordRepository(db),
    relationships: makeRelationshipRepository(db),
    conflicts: makeConflictRepository(db),
    importJobs: makeImportJobRepository(db),
    auditLogs: makeAuditLogRepository(db),
    close: () => db.close(),
  };
}

function mapPersonRow(row: any): Person {
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

function makePersonRepository(db: DatabaseSync): PersonRepository {
  return {
    async findBySyntheticId(id) {
      const row = db.prepare(`SELECT * FROM people WHERE synthetic_person_id = ?`).get(id);
      return row ? mapPersonRow(row) : null;
    },
    async findByIds(ids) {
      if (ids.length === 0) return [];
      const placeholders = ids.map(() => "?").join(",");
      const rows = db.prepare(`SELECT * FROM people WHERE synthetic_person_id IN (${placeholders})`).all(...ids);
      return rows.map(mapPersonRow);
    },
    async findChildrenOf(id) {
      const rows = db.prepare(`SELECT * FROM people WHERE father_id = ? OR mother_id = ?`).all(id, id);
      return rows.map(mapPersonRow);
    },
    async findByParents(fatherId, motherId, excludeId) {
      const rows = db
        .prepare(`SELECT * FROM people WHERE father_id = ? AND mother_id = ? AND synthetic_person_id != ?`)
        .all(fatherId, motherId, excludeId ?? "");
      return rows.map(mapPersonRow);
    },
    async findByFather(fatherId, excludeId) {
      const rows = db
        .prepare(`SELECT * FROM people WHERE father_id = ? AND synthetic_person_id != ?`)
        .all(fatherId, excludeId ?? "");
      return rows.map(mapPersonRow);
    },
    async findByMother(motherId, excludeId) {
      const rows = db
        .prepare(`SELECT * FROM people WHERE mother_id = ? AND synthetic_person_id != ?`)
        .all(motherId, excludeId ?? "");
      return rows.map(mapPersonRow);
    },
    async findByPhone(normalizedPhone) {
      const rows = db.prepare(`SELECT * FROM people WHERE phone = ?`).all(normalizedPhone);
      return rows.map(mapPersonRow);
    },
    async searchByName(fragment, limit, offset) {
      const like = `%${fragment}%`;
      const rows = db
        .prepare(
          `SELECT * FROM people WHERE lower(first_name) LIKE ? OR lower(last_name) LIKE ?
           LIMIT ? OFFSET ?`,
        )
        .all(like, like, limit, offset);
      const totalRow = db
        .prepare(`SELECT COUNT(*) as c FROM people WHERE lower(first_name) LIKE ? OR lower(last_name) LIKE ?`)
        .get(like, like) as any;
      return { rows: rows.map(mapPersonRow), total: totalRow.c };
    },
    async upsertMany(people) {
      const stmt = db.prepare(`
        INSERT INTO people (id, synthetic_person_id, first_name, last_name, phone, email, address, city, birth_year, father_id, mother_id, created_at, updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(synthetic_person_id) DO UPDATE SET
          first_name=excluded.first_name, last_name=excluded.last_name, phone=excluded.phone,
          email=excluded.email, address=excluded.address, city=excluded.city, birth_year=excluded.birth_year,
          father_id=excluded.father_id, mother_id=excluded.mother_id, updated_at=excluded.updated_at
      `);
      db.exec("BEGIN");
      try {
        for (const p of people) {
          stmt.run(
            p.id ?? randomUUID(),
            p.syntheticPersonId,
            p.firstName,
            p.lastName,
            p.phone,
            p.email,
            p.address,
            p.city,
            p.birthYear,
            p.fatherId,
            p.motherId,
            p.createdAt ?? new Date().toISOString(),
            p.updatedAt ?? new Date().toISOString(),
          );
        }
        db.exec("COMMIT");
      } catch (err) {
        db.exec("ROLLBACK");
        throw err;
      }
    },
    async count() {
      const row = db.prepare(`SELECT COUNT(*) as c FROM people`).get() as any;
      return row.c;
    },
  };
}

function makeSourceRepository(db: DatabaseSync): SourceRepository {
  return {
    async upsert(source) {
      const existing = db.prepare(`SELECT * FROM sources WHERE name = ?`).get(source.name) as any;
      if (existing) return mapSource(existing);
      const id = randomUUID();
      const createdAt = new Date().toISOString();
      db.prepare(`INSERT INTO sources (id, name, type, description, version, created_at) VALUES (?,?,?,?,?,?)`).run(
        id,
        source.name,
        source.type,
        source.description,
        source.version,
        createdAt,
      );
      return { id, ...source, createdAt };
    },
    async findByName(name) {
      const row = db.prepare(`SELECT * FROM sources WHERE name = ?`).get(name) as any;
      return row ? mapSource(row) : null;
    },
    async list() {
      const rows = db.prepare(`SELECT * FROM sources`).all();
      return rows.map(mapSource);
    },
  };
}
function mapSource(row: any): Source {
  return { id: row.id, name: row.name, type: row.type, description: row.description, version: row.version, createdAt: row.created_at };
}

function makeRawRecordRepository(db: DatabaseSync): RawRecordRepository {
  return {
    async insertMany(sourceId, records) {
      const stmt = db.prepare(
        `INSERT INTO raw_records (id, source_id, external_record_id, payload, checksum, created_at) VALUES (?,?,?,?,?,?)`,
      );
      db.exec("BEGIN");
      try {
        for (const r of records) {
          stmt.run(randomUUID(), sourceId, r.externalRecordId, JSON.stringify(r.payload), r.checksum, new Date().toISOString());
        }
        db.exec("COMMIT");
      } catch (err) {
        db.exec("ROLLBACK");
        throw err;
      }
    },
    async findByPerson(personId) {
      const rows = db
        .prepare(
          `SELECT rr.*, s.name as source_name FROM person_source_records psr
           JOIN raw_records rr ON rr.id = psr.raw_record_id
           JOIN sources s ON s.id = psr.source_id
           WHERE psr.person_id = ?`,
        )
        .all(personId) as any[];
      return rows.map((row) => ({
        id: row.id,
        sourceId: row.source_id,
        externalRecordId: row.external_record_id,
        payload: JSON.parse(row.payload),
        checksum: row.checksum,
        createdAt: row.created_at,
        sourceName: row.source_name,
      }));
    },
  };
}

function makeRelationshipRepository(db: DatabaseSync): RelationshipRepository {
  return {
    async upsert(rel) {
      const id = randomUUID();
      const createdAt = new Date().toISOString();
      db.prepare(
        `INSERT INTO relationships (id, source_person_id, target_person_id, relationship_type, confidence, status, created_at)
         VALUES (?,?,?,?,?,?,?)
         ON CONFLICT(source_person_id, target_person_id, relationship_type) DO UPDATE SET
           confidence=excluded.confidence, status=excluded.status`,
      ).run(id, rel.sourcePersonId, rel.targetPersonId, rel.relationshipType, rel.confidence, rel.status, createdAt);

      const finalId =
        (db
          .prepare(
            `SELECT id FROM relationships WHERE source_person_id=? AND target_person_id=? AND relationship_type=?`,
          )
          .get(rel.sourcePersonId, rel.targetPersonId, rel.relationshipType) as any)?.id ?? id;

      const evStmt = db.prepare(
        `INSERT INTO relationship_evidence (id, relationship_id, source_name, field_name, field_value, evidence_type, created_at) VALUES (?,?,?,?,?,?,?)`,
      );
      for (const e of rel.evidence) {
        evStmt.run(randomUUID(), finalId, e.sourceName, e.field, e.value, e.evidenceType, createdAt);
      }

      return {
        id: finalId,
        sourcePersonId: rel.sourcePersonId,
        targetPersonId: rel.targetPersonId,
        relationshipType: rel.relationshipType,
        confidence: rel.confidence,
        status: rel.status,
        evidence: rel.evidence.map((e) => ({ field: e.field, source: e.sourceName, value: e.value })),
        createdAt,
      };
    },
    async findForPerson(id) {
      const rows = db
        .prepare(`SELECT * FROM relationships WHERE source_person_id = ? OR target_person_id = ?`)
        .all(id, id) as any[];
      return rows.map((row) => {
        const evidenceRows = db
          .prepare(`SELECT * FROM relationship_evidence WHERE relationship_id = ?`)
          .all(row.id) as any[];
        return {
          id: row.id,
          sourcePersonId: row.source_person_id,
          targetPersonId: row.target_person_id,
          relationshipType: row.relationship_type,
          confidence: row.confidence,
          status: row.status,
          evidence: evidenceRows.map((e) => ({ field: e.field_name, source: e.source_name, value: e.field_value })),
          createdAt: row.created_at,
        } satisfies Relationship;
      });
    },
    async findSpouse(id) {
      const rows = db
        .prepare(
          `SELECT p.* FROM relationships r JOIN people p ON p.synthetic_person_id = r.target_person_id
           WHERE r.source_person_id = ? AND r.relationship_type = 'SPOUSE'`,
        )
        .all(id);
      return rows.map(mapPersonRow);
    },
  };
}

function makeConflictRepository(db: DatabaseSync): ConflictRepository {
  return {
    async record(conflict) {
      const id = randomUUID();
      db.prepare(`INSERT INTO conflicts (id, person_id, field, values_json, created_at) VALUES (?,?,?,?,?)`).run(
        id,
        conflict.personId,
        conflict.field,
        JSON.stringify(conflict.values),
        new Date().toISOString(),
      );
      return { id, ...conflict };
    },
    async findByPerson(id) {
      const rows = db.prepare(`SELECT * FROM conflicts WHERE person_id = ?`).all(id) as any[];
      return rows.map(mapConflict);
    },
    async all() {
      const rows = db.prepare(`SELECT * FROM conflicts`).all() as any[];
      return rows.map(mapConflict);
    },
  };
}
function mapConflict(row: any): Conflict {
  return { id: row.id, personId: row.person_id, field: row.field, values: JSON.parse(row.values_json) };
}

function makeImportJobRepository(db: DatabaseSync): ImportJobRepository {
  return {
    async create(job) {
      const id = randomUUID();
      const createdAt = new Date().toISOString();
      db.prepare(
        `INSERT INTO import_jobs (id, file, size_bytes, format, total_records, processed_records, failed_records, speed_records_per_sec, status, created_at, updated_at)
         VALUES (?,?,?,?,?,0,0,NULL,?,?,?)`,
      ).run(id, job.file, job.sizeBytes, job.format, job.totalRecords, job.status, createdAt, createdAt);
      return { id, processedRecords: 0, failedRecords: 0, createdAt, ...job };
    },
    async updateProgress(id, processed, failed, speed) {
      db.prepare(
        `UPDATE import_jobs SET processed_records=?, failed_records=?, speed_records_per_sec=?, updated_at=? WHERE id=?`,
      ).run(processed, failed, speed, new Date().toISOString(), id);
    },
    async setStatus(id, status) {
      db.prepare(`UPDATE import_jobs SET status=?, updated_at=? WHERE id=?`).run(status, new Date().toISOString(), id);
    },
    async saveCheckpoint(jobId, file, offset, recordsProcessed, status) {
      db.prepare(
        `INSERT INTO import_checkpoints (job_id, file, byte_offset, records_processed, status, updated_at)
         VALUES (?,?,?,?,?,?)
         ON CONFLICT(job_id) DO UPDATE SET byte_offset=excluded.byte_offset, records_processed=excluded.records_processed, status=excluded.status, updated_at=excluded.updated_at`,
      ).run(jobId, file, offset, recordsProcessed, status, new Date().toISOString());
    },
    async getCheckpoint(jobId) {
      const row = db.prepare(`SELECT * FROM import_checkpoints WHERE job_id = ?`).get(jobId) as any;
      return row ? { offset: row.byte_offset, recordsProcessed: row.records_processed } : null;
    },
    async recordError(jobId, lineNumber, rawPayload, error) {
      db.prepare(`INSERT INTO import_errors (id, job_id, line_number, raw_payload, error, created_at) VALUES (?,?,?,?,?,?)`).run(
        randomUUID(),
        jobId,
        lineNumber,
        rawPayload,
        error,
        new Date().toISOString(),
      );
    },
    async get(id) {
      const row = db.prepare(`SELECT * FROM import_jobs WHERE id = ?`).get(id) as any;
      if (!row) return null;
      return {
        id: row.id,
        file: row.file,
        sizeBytes: row.size_bytes,
        format: row.format,
        totalRecords: row.total_records,
        processedRecords: row.processed_records,
        failedRecords: row.failed_records,
        speedRecordsPerSec: row.speed_records_per_sec,
        status: row.status,
        createdAt: row.created_at,
      };
    },
  };
}

function makeAuditLogRepository(db: DatabaseSync): AuditLogRepository {
  return {
    async record(entry) {
      db.prepare(
        `INSERT INTO audit_logs (id, user_name, action, target, result, duration_ms, created_at) VALUES (?,?,?,?,?,?,?)`,
      ).run(randomUUID(), entry.user, entry.action, entry.target, entry.result, entry.durationMs, entry.timestamp);
    },
    async recent(limit) {
      const rows = db.prepare(`SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT ?`).all(limit) as any[];
      return rows.map((r) => ({
        id: r.id,
        user: r.user_name,
        timestamp: r.created_at,
        action: r.action,
        target: r.target,
        result: r.result,
        durationMs: r.duration_ms,
      }));
    },
  };
}
