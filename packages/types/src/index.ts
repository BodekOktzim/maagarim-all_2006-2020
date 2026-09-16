/**
 * Shared domain types for Synthetic Data Lab.
 * These are contracts — every package (search, entity-resolution,
 * relationships, ai, database) imports from here instead of redefining shapes.
 *
 * IMPORTANT: every identifier here refers to SYNTHETIC data only.
 */

// ---------------------------------------------------------------------------
// Core entities
// ---------------------------------------------------------------------------

/** Synthetic person identifier, format: P00000001 */
export type SyntheticPersonId = string;

export interface Person {
  id: string; // internal UUID
  syntheticPersonId: SyntheticPersonId;
  firstName: string | null;
  lastName: string | null;
  phone: string | null; // normalized E.164-like synthetic format
  email: string | null;
  address: string | null;
  city: string | null;
  birthYear: number | null;
  fatherId: SyntheticPersonId | null;
  motherId: SyntheticPersonId | null;
  createdAt: string;
  updatedAt: string;
}

export interface Source {
  id: string;
  name: string; // e.g. SYNTHETIC_SOURCE_01
  type: "structured" | "social" | "phone";
  description: string;
  version: string;
  createdAt: string;
}

export interface RawRecord {
  id: string;
  sourceId: string;
  externalRecordId: string;
  payload: Record<string, unknown>;
  checksum: string;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Relationships
// ---------------------------------------------------------------------------

export type RelationshipType =
  | "PARENT"
  | "CHILD"
  | "SIBLING"
  | "GRANDPARENT"
  | "GRANDCHILD"
  | "UNCLE"
  | "AUNT"
  | "NEPHEW"
  | "NIECE"
  | "COUSIN"
  | "SPOUSE";

export type RelationshipStatus = "CONFIRMED" | "POSSIBLE_RELATION" | "UNRESOLVED_CANDIDATE";

export interface RelationshipEvidenceItem {
  field: string;
  source: string; // source name, e.g. SYNTHETIC_SOURCE_01
  value: string;
}

export interface Relationship {
  id: string;
  sourcePersonId: SyntheticPersonId;
  targetPersonId: SyntheticPersonId;
  relationshipType: RelationshipType;
  confidence: ConfidenceLevel;
  status: RelationshipStatus;
  evidence: RelationshipEvidenceItem[];
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Entity Resolution
// ---------------------------------------------------------------------------

export type MatchType =
  | "EXACT_ID"
  | "EXACT_PHONE"
  | "EXACT_EMAIL"
  | "NAME_MATCH"
  | "ADDRESS_MATCH"
  | "MULTI_FIELD_MATCH"
  | "AI_REVIEW";

export type ConfidenceLevel = "CONFIRMED" | "HIGH" | "MEDIUM" | "LOW" | "UNRESOLVED" | "CONFLICT";

export interface EntityMatchEvidence {
  field: string;
  sourceA: string;
  sourceB: string;
  value: string;
}

export interface EntityMatch {
  matchType: MatchType;
  confidence: number; // 0..1 numeric score
  confidenceLevel: ConfidenceLevel;
  evidence: EntityMatchEvidence[];
}

export interface Conflict {
  id: string;
  personId: SyntheticPersonId;
  field: string;
  values: Array<{
    source: string;
    value: string;
    timestamp: string;
    confidence: ConfidenceLevel;
  }>;
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

export type SearchQueryType = "auto" | "id" | "phone" | "name" | "address";
export type FamilyMode = "person" | "close_family" | "extended_family" | "connected_network";

export interface SearchRequest {
  query: string;
  type?: SearchQueryType;
  mode?: FamilyMode;
  maxDepth?: number; // 1-10, only for connected_network
  page?: number;
  pageSize?: number; // default 50, max 500
}

export interface SearchResult {
  person: Person;
  matchScore?: number; // present for fuzzy name/address matches
}

export interface SearchResponse {
  query: string;
  results: SearchResult[];
  relationships: Relationship[];
  sources: Source[];
  confidence: ConfidenceLevel;
  page: number;
  pageSize: number;
  totalCount: number;
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

export type ImportFileFormat =
  | "csv"
  | "json"
  | "jsonl"
  | "ndjson"
  | "txt"
  | "sql"
  | "sqlite"
  | "postgres_dump"
  | "xlsx"
  | "zip"
  | "gzip";

export type ImportJobStatus = "PENDING" | "PROCESSING" | "PAUSED" | "COMPLETED" | "FAILED";

export interface ImportCheckpoint {
  jobId: string;
  file: string;
  offset: number;
  recordsProcessed: number;
  status: ImportJobStatus;
}

export interface ImportJob {
  id: string;
  file: string;
  sizeBytes: number;
  format: ImportFileFormat;
  totalRecords: number | null;
  processedRecords: number;
  failedRecords: number;
  speedRecordsPerSec: number | null;
  status: ImportJobStatus;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// AI Orchestrator — tool contracts
// ---------------------------------------------------------------------------

/**
 * The AI layer only ever calls these named, validated tools.
 * It MUST NOT run arbitrary SQL and MUST NOT invent people, relationships,
 * or evidence. See packages/ai for the guardrail enforcement.
 */
export interface AiToolCatalog {
  search_person(id: SyntheticPersonId): Promise<Person | null>;
  search_phone(phone: string): Promise<Person[]>;
  search_name(name: string): Promise<SearchResult[]>;
  get_parents(id: SyntheticPersonId): Promise<Person[]>;
  get_children(id: SyntheticPersonId): Promise<Person[]>;
  get_siblings(id: SyntheticPersonId): Promise<Person[]>;
  get_extended_family(id: SyntheticPersonId): Promise<Record<RelationshipType, Person[]>>;
  get_relationships(id: SyntheticPersonId): Promise<Relationship[]>;
  get_sources(id: SyntheticPersonId): Promise<Source[]>;
  compare_records(idA: SyntheticPersonId, idB: SyntheticPersonId): Promise<EntityMatch>;
  get_conflicts(id: SyntheticPersonId): Promise<Conflict[]>;
}

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

export interface AuditLogEntry {
  id: string;
  user: string;
  timestamp: string;
  action: string;
  target: string;
  result: string;
  durationMs: number;
}
