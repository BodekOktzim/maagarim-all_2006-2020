import type {
  Person,
  Source,
  RawRecord,
  Relationship,
  RelationshipType,
  RelationshipStatus,
  ConfidenceLevel,
  Conflict,
  ImportJob,
  ImportJobStatus,
  AuditLogEntry,
  SyntheticPersonId,
} from "@sdl/types";

/**
 * Every DB backend (SQLite for sandbox/dev, Postgres for production) implements
 * these same interfaces. Business logic (RelationshipEngine, SearchService,
 * EntityResolutionService) depends ONLY on these interfaces — never on a
 * specific driver. This is what makes "swap SQLite for Postgres" a one-line
 * change (see packages/database/src/index.ts).
 */

export interface PersonRepository {
  findBySyntheticId(id: SyntheticPersonId): Promise<Person | null>;
  findByIds(ids: SyntheticPersonId[]): Promise<Person[]>;
  findChildrenOf(id: SyntheticPersonId): Promise<Person[]>;
  findByParents(fatherId: SyntheticPersonId, motherId: SyntheticPersonId, excludeId?: SyntheticPersonId): Promise<Person[]>;
  findByFather(fatherId: SyntheticPersonId, excludeId?: SyntheticPersonId): Promise<Person[]>;
  findByMother(motherId: SyntheticPersonId, excludeId?: SyntheticPersonId): Promise<Person[]>;
  findByPhone(normalizedPhone: string): Promise<Person[]>;
  searchByName(normalizedFragment: string, limit: number, offset: number): Promise<{ rows: Person[]; total: number }>;
  upsertMany(people: Person[]): Promise<void>;
  count(): Promise<number>;
}

export interface SourceRepository {
  upsert(source: Omit<Source, "id" | "createdAt">): Promise<Source>;
  findByName(name: string): Promise<Source | null>;
  list(): Promise<Source[]>;
}

export interface RawRecordRepository {
  insertMany(sourceId: string, records: Array<{ externalRecordId: string; payload: Record<string, unknown>; checksum: string }>): Promise<void>;
  findByPerson(personId: SyntheticPersonId): Promise<Array<RawRecord & { sourceName: string }>>;
}

export interface RelationshipRepository {
  upsert(rel: {
    sourcePersonId: SyntheticPersonId;
    targetPersonId: SyntheticPersonId;
    relationshipType: RelationshipType;
    confidence: ConfidenceLevel;
    status: RelationshipStatus;
    evidence: Array<{ sourceName: string; field: string; value: string; evidenceType: string }>;
  }): Promise<Relationship>;
  findForPerson(id: SyntheticPersonId): Promise<Relationship[]>;
  findSpouse(id: SyntheticPersonId): Promise<Person[]>;
}

export interface ConflictRepository {
  record(conflict: Omit<Conflict, "id">): Promise<Conflict>;
  findByPerson(id: SyntheticPersonId): Promise<Conflict[]>;
  all(): Promise<Conflict[]>;
}

export interface ImportJobRepository {
  create(job: Omit<ImportJob, "id" | "createdAt" | "processedRecords" | "failedRecords">): Promise<ImportJob>;
  updateProgress(id: string, processed: number, failed: number, speed: number | null): Promise<void>;
  setStatus(id: string, status: ImportJobStatus): Promise<void>;
  saveCheckpoint(jobId: string, file: string, offset: number, recordsProcessed: number, status: ImportJobStatus): Promise<void>;
  getCheckpoint(jobId: string): Promise<{ offset: number; recordsProcessed: number } | null>;
  recordError(jobId: string, lineNumber: number | null, rawPayload: string, error: string): Promise<void>;
  get(id: string): Promise<ImportJob | null>;
}

export interface AuditLogRepository {
  record(entry: Omit<AuditLogEntry, "id">): Promise<void>;
  recent(limit: number): Promise<AuditLogEntry[]>;
}

export interface Database {
  people: PersonRepository;
  sources: SourceRepository;
  rawRecords: RawRecordRepository;
  relationships: RelationshipRepository;
  conflicts: ConflictRepository;
  importJobs: ImportJobRepository;
  auditLogs: AuditLogRepository;
  close(): void;
}
