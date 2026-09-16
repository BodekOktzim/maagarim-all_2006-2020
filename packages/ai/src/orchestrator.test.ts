import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { openSqliteDatabase } from "@sdl/database";
import { AiOrchestrator, ToolNotAllowedError } from "./orchestrator.ts";
import type { Person } from "@sdl/types";

function p(overrides: Partial<Person>): Person {
  const now = new Date().toISOString();
  return {
    id: randomUUID(), syntheticPersonId: "P000000", firstName: null, lastName: null,
    phone: null, email: null, address: null, city: null, birthYear: null,
    fatherId: null, motherId: null, createdAt: now, updatedAt: now, ...overrides,
  };
}

test("section 39 — AI cannot call a tool outside the whitelist (no raw SQL access)", async () => {
  const db = openSqliteDatabase(":memory:");
  try {
    const orchestrator = new AiOrchestrator(db);
    await assert.rejects(
      () => orchestrator.callTool({ tool: "run_raw_sql", args: { query: "DROP TABLE people;" } }),
      ToolNotAllowedError,
    );
  } finally {
    db.close();
  }
});

test("section 40 — 'Find the close family of P000101' runs the documented 4-tool playbook and returns real data", async () => {
  const db = openSqliteDatabase(":memory:");
  try {
    await db.people.upsertMany([
      p({ syntheticPersonId: "P000001", firstName: "Avi" }),
      p({ syntheticPersonId: "P000002", firstName: "Dana" }),
      p({ syntheticPersonId: "P000101", firstName: "Yossi", fatherId: "P000001", motherId: "P000002" }),
      p({ syntheticPersonId: "P000102", firstName: "Moshe", fatherId: "P000001", motherId: "P000002" }),
    ]);
    const orchestrator = new AiOrchestrator(db);
    const result = await orchestrator.findCloseFamily("P000101");

    assert.equal((result.person as Person).firstName, "Yossi");
    assert.equal((result.parents as Person[]).length, 2);
    assert.equal((result.siblings as any[]).length, 1);

    // Every tool call must have produced an audit log row (section 42).
    const logs = await db.auditLogs.recent(10);
    assert.ok(logs.length >= 3, "expected audit entries for search_person/get_parents/get_children/get_siblings");
    assert.ok(logs.every((l) => l.user === "ai_orchestrator"));
  } finally {
    db.close();
  }
});

test("section 41 — AI must not guess: unknown person yields the exact required refusal sentence", async () => {
  const db = openSqliteDatabase(":memory:");
  try {
    const orchestrator = new AiOrchestrator(db);
    const result = await orchestrator.findCloseFamily("P999999");
    assert.equal(result.answer, "I cannot establish this relationship from the available synthetic data.");
  } finally {
    db.close();
  }
});

test("compare_records tool routes through EntityResolutionService, not a free-form AI guess", async () => {
  const db = openSqliteDatabase(":memory:");
  try {
    await db.people.upsertMany([
      p({ syntheticPersonId: "P000101", firstName: "Yossi", lastName: "Cohen", phone: "0500001234" }),
      p({ syntheticPersonId: "P000102", firstName: "Yosi", lastName: "Cohen", phone: "0500001234" }),
    ]);
    const orchestrator = new AiOrchestrator(db);
    const match = await orchestrator.callTool({ tool: "compare_records", args: { idA: "P000101", idB: "P000102" } });
    assert.equal((match as any).confidenceLevel, "HIGH");
  } finally {
    db.close();
  }
});
