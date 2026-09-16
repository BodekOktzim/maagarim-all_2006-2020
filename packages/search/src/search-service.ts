import type { PersonRepository } from "@sdl/database";
import type { Person, SearchQueryType, SearchResult } from "@sdl/types";
import { normalizePhone, normalizeName, normalizeAddress, similarityScore } from "@sdl/shared";

const MAX_PAGE_SIZE = 500;
const DEFAULT_PAGE_SIZE = 50;

/** Auto-detects query type: ID pattern, phone (mostly digits), else name/address text. */
export function detectQueryType(query: string): SearchQueryType {
  if (/^P\d{6,9}$/i.test(query.trim())) return "id";
  const digitCount = (query.match(/\d/g) ?? []).length;
  if (digitCount >= 7 && digitCount / query.replace(/\s/g, "").length > 0.6) return "phone";
  return "name";
}

export interface SearchParams {
  query: string;
  type?: SearchQueryType;
  page?: number;
  pageSize?: number;
}

export interface SearchOutcome {
  results: SearchResult[];
  page: number;
  pageSize: number;
  totalCount: number;
  resolvedType: SearchQueryType;
}

export class SearchService {
  constructor(private readonly people: PersonRepository) {}

  async search(params: SearchParams): Promise<SearchOutcome> {
    const type = params.type && params.type !== "auto" ? params.type : detectQueryType(params.query);
    const page = Math.max(params.page ?? 1, 1);
    const pageSize = Math.min(Math.max(params.pageSize ?? DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE); // section 60

    switch (type) {
      case "id": {
        const person = await this.people.findBySyntheticId(params.query.trim().toUpperCase());
        const results = person ? [{ person }] : [];
        return { results, page: 1, pageSize, totalCount: results.length, resolvedType: "id" };
      }
      case "phone": {
        const normalized = normalizePhone(params.query);
        const people = await this.people.findByPhone(normalized);
        return { results: people.map((person) => ({ person })), page: 1, pageSize, totalCount: people.length, resolvedType: "phone" };
      }
      case "address": {
        return this.searchByAddressFuzzy(params.query, page, pageSize);
      }
      case "name":
      default:
        return this.searchByNameFuzzy(params.query, page, pageSize);
    }
  }

  /** Section 11: exact / prefix / partial handled by SQL LIKE upstream; fuzzy score added here. */
  private async searchByNameFuzzy(rawQuery: string, page: number, pageSize: number): Promise<SearchOutcome> {
    const normalized = normalizeName(rawQuery);
    const firstWord = normalized.split(" ")[0] ?? normalized;
    // Use a short prefix (not the whole word) for the SQL LIKE pre-filter, so
    // spelling variants like "Yosi" still surface as candidates for "Yossi" —
    // the fuzzy re-ranking below then does the real precision work.
    // (Production Postgres backend uses pg_trgm similarity() instead of LIKE — see postgres-database.ts.)
    const fragment = firstWord.slice(0, 3) || firstWord;
    const { rows, total } = await this.people.searchByName(fragment, pageSize * 3, 0); // over-fetch a candidate pool to rank

    const scored = rows.map((person) => ({
      person,
      matchScore: similarityScore(`${person.firstName ?? ""} ${person.lastName ?? ""}`.trim(), rawQuery),
    }));
    scored.sort((a, b) => b.matchScore - a.matchScore);

    const start = (page - 1) * pageSize;
    const pageItems = scored.slice(start, start + pageSize);

    return {
      results: pageItems.map((s) => ({ person: s.person, matchScore: Math.round(s.matchScore * 100) / 100 })),
      page, pageSize, totalCount: total, resolvedType: "name",
    };
  }

  /** Section 12: address normalization ("St." vs "Street") folded into the same fuzzy path. */
  private async searchByAddressFuzzy(rawQuery: string, page: number, pageSize: number): Promise<SearchOutcome> {
    const normalized = normalizeAddress(rawQuery);
    const fragment = normalized.split(" ").slice(0, 2).join(" ");
    const { rows, total } = await this.people.searchByName(fragment, pageSize * 3, 0);
    // NOTE: reuses the name-search repository method as a broad candidate fetch;
    // production Postgres backend adds a dedicated address index (see postgres-database.ts TODO).
    const scored = rows
      .filter((p) => p.address)
      .map((person) => ({ person, matchScore: similarityScore(person.address ?? "", rawQuery) }))
      .filter((s) => s.matchScore > 0.5);
    scored.sort((a, b) => b.matchScore - a.matchScore);
    const start = (page - 1) * pageSize;
    return {
      results: scored.slice(start, start + pageSize).map((s) => ({ person: s.person, matchScore: Math.round(s.matchScore * 100) / 100 })),
      page, pageSize, totalCount: scored.length, resolvedType: "address",
    };
  }
}
