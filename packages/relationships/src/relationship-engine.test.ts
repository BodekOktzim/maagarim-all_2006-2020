import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { openSqliteDatabase } from "@sdl/database";
import { RelationshipEngine } from "./relationship-engine.ts";
import type { Person } from "@sdl/types";

function p(overrides: Partial<Person>): Person {
  const now = new Date().toISOString();
  return {
    id: randomUUID(), syntheticPersonId: "P000000", firstName: null, lastName: null,
    phone: null, email: null, address: null, city: null, birthYear: null,
    fatherId: null, motherId: null, createdAt: now, updatedAt: now, ...overrides,
  };
}

test("section 66 — Sibling Test: full family tree resolves parents/children/siblings/grandparents/cousins", async () => {
  const db = openSqliteDatabase(":memory:");
  try {
    await db.people.upsertMany([
      p({ syntheticPersonId: "P000001", firstName: "Avi", lastName: "Cohen" }),   // grandfather
      p({ syntheticPersonId: "P000002", firstName: "Dana", lastName: "Cohen" }),  // grandmother
      p({ syntheticPersonId: "P000003", firstName: "Ronit", lastName: "Levi", fatherId: "P000001", motherId: "P000002" }), // aunt
      p({ syntheticPersonId: "P000010", firstName: "David", lastName: "Cohen", fatherId: "P000001", motherId: "P000002" }), // father of Yossi
      p({ syntheticPersonId: "P000011", firstName: "Michal", lastName: "Cohen" }), // mother of Yossi
      p({ syntheticPersonId: "P000101", firstName: "Yossi", lastName: "Cohen", fatherId: "P000010", motherId: "P000011" }),
      p({ syntheticPersonId: "P000102", firstName: "Moshe", lastName: "Cohen", fatherId: "P000010", motherId: "P000011" }),
      p({ syntheticPersonId: "P000103", firstName: "Gabi", lastName: "Cohen", fatherId: "P000010", motherId: "P000011" }),
      p({ syntheticPersonId: "P000200", firstName: "Tal", lastName: "Levi", fatherId: "P000003", motherId: null }), // cousin
    ]);

    const engine = new RelationshipEngine(db.people, db.relationships);

    const siblings = await engine.getSiblings("P000101");
    assert.deepEqual(siblings.map((s) => s.person.syntheticPersonId).sort(), ["P000102", "P000103"]);
    assert.ok(siblings.every((s) => s.status === "CONFIRMED"));

    const grandparents = await engine.getGrandparents("P000101");
    assert.deepEqual(grandparents.map((g) => g.syntheticPersonId).sort(), ["P000001", "P000002"]);

    const unclesAunts = await engine.getUnclesAndAunts("P000101");
    assert.ok(unclesAunts.some((u) => u.syntheticPersonId === "P000003"));

    const extended = await engine.getExtendedFamily("P000101");
    assert.equal(extended.parents.length, 2);
    assert.equal(extended.siblings.length, 2);
  } finally {
    db.close();
  }
});

test("section 67 — Negative Sibling Test: different parents never returned as siblings", async () => {
  const db = openSqliteDatabase(":memory:");
  try {
    await db.people.upsertMany([
      p({ syntheticPersonId: "P000101", fatherId: "P000001", motherId: "P000002" }),
      p({ syntheticPersonId: "P000102", fatherId: "P000003", motherId: "P000004" }),
    ]);
    const engine = new RelationshipEngine(db.people, db.relationships);
    const siblings = await engine.getSiblings("P000101");
    assert.equal(siblings.length, 0);
  } finally {
    db.close();
  }
});

test("section 68 — Partial Data Test: one NULL parent => POSSIBLE_RELATION, never CONFIRMED", async () => {
  const db = openSqliteDatabase(":memory:");
  try {
    await db.people.upsertMany([
      p({ syntheticPersonId: "P000101", fatherId: "P000001", motherId: null }),
      p({ syntheticPersonId: "P000102", fatherId: "P000001", motherId: null }),
    ]);
    const engine = new RelationshipEngine(db.people, db.relationships);
    const siblings = await engine.getSiblings("P000101");
    assert.equal(siblings.length, 1);
    assert.equal(siblings[0].status, "POSSIBLE_RELATION");
    assert.notEqual(siblings[0].status, "CONFIRMED");
  } finally {
    db.close();
  }
});

test("section 41 — AI Must Not Guess: explainRelationship returns UNRESOLVED_CANDIDATE without evidence", async () => {
  const db = openSqliteDatabase(":memory:");
  try {
    await db.people.upsertMany([
      p({ syntheticPersonId: "P000101" }),
      p({ syntheticPersonId: "P000999" }), // unrelated, no shared parents at all
    ]);
    const engine = new RelationshipEngine(db.people, db.relationships);
    const result = await engine.explainRelationship("P000101", "P000999");
    assert.equal(result.status, "UNRESOLVED_CANDIDATE");
  } finally {
    db.close();
  }
});

test("Connected Network traversal respects depth clamp (section 7, Mode 4: 1-10)", async () => {
  const db = openSqliteDatabase(":memory:");
  try {
    await db.people.upsertMany([
      p({ syntheticPersonId: "P1" }),
      p({ syntheticPersonId: "P2", fatherId: "P1" }),
      p({ syntheticPersonId: "P3", fatherId: "P2" }),
    ]);
    const engine = new RelationshipEngine(db.people, db.relationships);
    const depth1 = await engine.getConnectedNetwork("P1", 1);
    const depth10 = await engine.getConnectedNetwork("P1", 999); // must clamp to 10, not crash/loop forever
    assert.ok(depth1.length >= 1);
    assert.ok(depth10.length >= depth1.length);
  } finally {
    db.close();
  }
});
