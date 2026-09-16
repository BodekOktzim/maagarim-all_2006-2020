# Synthetic Data Lab

מערכת מחקר לחיפוש מאוחד, Entity Resolution וניתוח Family Graph — **על נתונים סינתטיים בלבד**.

## ⚠️ Synthetic Data Only

- אין להשתמש במאגרי דליפות אמיתיים, מידע אישי אמיתי, Facebook/Truecaller אמיתיים, scraping או reverse-lookup של אנשים אמיתיים.
- כל Person, Phone, Address, ID, Family, Social Profile ו-Source בפרויקט **חייבים** להיות סינתטיים (ראו `packages/synthetic-generator`).
- `REAL_WORLD_PROVIDER` נשאר `DISABLED` כברירת מחדל בכל סביבה.

## Architecture

Monorepo (pnpm/npm workspaces):

```
apps/web            React + TypeScript + Vite + Tailwind + shadcn/ui — Dashboard, Search, Family Graph
apps/api            Fastify + TypeScript — REST API, AI Orchestrator entrypoint
packages/database    Postgres schema, migrations, query layer (no ORM magic — explicit SQL/Kysely)
packages/types       Shared TS types/interfaces across apps
packages/search      Unified search (ID / phone / name / address, fuzzy matching)
packages/entity-resolution   EntityResolutionService, confidence levels, conflict detection
packages/relationships       RelationshipEngine (parents/children/siblings/.../graph traversal)
packages/synthetic-generator SyntheticDataGenerator + families + intentional duplicates/conflicts
packages/ai          AI Orchestrator: tool-based, no arbitrary SQL, no guessing
packages/shared      Cross-cutting utils (normalization, logging, config)
scripts/             generate-data.ts, import-data.ts, benchmark.ts
```

## ⚠️ Sandbox Environment Notice

This project was built and tested inside a sandbox with **no network access,
no Docker, no Postgres, no Redis, and no `npm install`** (registry returns
403). To still deliver real, executed, tested code instead of an untested
skeleton, the business logic was written against **backend-agnostic
repository interfaces** (`packages/database/src/repository.ts`) with two
implementations:

- **SQLite** (`packages/database/src/sqlite`) — real, runs in this sandbox via
  Node's built-in `node:sqlite`. All 44 automated tests run against this.
- **Postgres** (`packages/database/src/postgres`) — the production backend,
  same interface, uses `pg`. Written but **not executed here** (no `pg`
  package, no Postgres server available in this sandbox).

Similarly: the HTTP API is built on Node's built-in `node:http` (a
dependency-free stand-in for Fastify, since `fastify` can't be installed
here) and was tested with real sockets. Redis/BullMQ are represented by the
in-process `RateLimiter` and the synchronous job flow in the import engine;
a real Redis-backed queue adapter is not implemented/tested here.

**In a normal networked environment** (e.g. via Claude Code or any machine
with internet access), run:
```bash
npm install
docker compose up -d
npm run migrate   # applies packages/database/migrations/001_init.sql to real Postgres
npm run test      # same test suites, now can also target Postgres
```

## Build Plan (12 Phases)

This project is built **phase by phase**, matching the original spec. After each phase:
run tests → confirm the app still boots → confirm migrations apply → confirm no TS errors →
confirm no broken imports → update this README → only then move to the next phase.

Status legend: **RAN** = executed in this sandbox with a real pass/fail result. **CODE ONLY** = written to spec, not executed here (needs infra this sandbox lacks).

- [x] Phase 1 — Project scaffold — **RAN**
- [x] Phase 2 — Database: SQLite backend **RAN** (3 integration tests); Postgres backend — **CODE ONLY**
- [x] Phase 3 — SyntheticDataGenerator: families/duplicates/conflicts/streaming JSONL — **RAN** (4 tests + 5k/300k real generations)
- [x] Phase 4 — Import engine: streaming, batching, checkpoint/resume, malformed-line handling, upload validation — **RAN** (3 tests incl. real crash+resume)
- [x] Phase 5 — Search engine: ID/phone/name/address, normalization, fuzzy score, pagination cap — **RAN** (5 tests)
- [x] Phase 6 — Entity Resolution: match types, confidence levels, conflict detection — **RAN** (6 tests)
- [x] Phase 7 — Relationship Engine: siblings/extended family/graph traversal, evidence-only — **RAN** (5 tests)
- [x] Phase 8 — UI components (Dashboard/PersonProfile/FamilyGraph SVG) — **RAN** (2 SSR render tests). Vite/Tailwind/shadcn build pipeline — **CODE ONLY / NOT BUILT** (no npm registry access)
- [x] Phase 9 — AI Orchestrator: whitelisted tool catalog, guardrails, audit logging — **RAN** (4 tests). Real LLM completion call — **NOT EXERCISED** (no network/API access)
- [x] Phase 10 — Performance: benchmark script — **RAN** at 5,000 and 300,000 people on SQLite. **The spec's 5GB/Postgres-scale benchmark was NOT run** (needs real infra)
- [x] Phase 11 — Security: rate limiter, upload/ZIP-bomb validation, bearer-token auth, audit log — **RAN** (tests across import-engine/server/rate-limiter)
- [x] Phase 12 — Full consolidated test suite (44 tests, all packages, one invocation) + real `tsc` typecheck — **RAN**

Docker Compose / real Postgres / real Redis+BullMQ / `npm install` / Vite build — all **CODE ONLY, NOT EXECUTED**: this sandbox has no network access, no Docker daemon, and no `psql`/`redis-server` binaries (verified by direct attempt — see chat transcript for the actual `npm install` 403 and missing-binary checks).

## Quickstart (once Phase 2+ exist)

```bash
docker compose up -d
npm install
npm run migrate
npm run seed
npm run dev
# → http://localhost:3000
```

## Environment Variables

See `.env.example`. Never commit real secrets.
