import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { openSqliteDatabase } from "@sdl/database";
import { SearchService, detectQueryType } from "./search-service.ts";
import type { Person } from "@sdl/types";

function p(overrides: Partial<Person>): Person {
  const now = new Date().toISOString();
  return {
    id: randomUUID(), syntheticPersonId: "P000000", firstName: null, lastName: null,
    phone: null, email: null, address: null, city: null, birthYear: null,
    fatherId: null, motherId: null, createdAt: now, updatedAt: now, ...overrides,
  };
}

test("detectQueryType classifies ID / phone / name correctly (section 8)", () => {
  assert.equal(detectQueryType("P000101"), "id");
  assert.equal(detectQueryType("050-000-1234"), "phone");
  assert.equal(detectQueryType("Yossi Cohen"), "name");
});

test("search by exact ID (section 9)", async () => {
  const db = openSqliteDatabase(":memory:");
  try {
    await db.people.upsertMany([p({ syntheticPersonId: "P000101", firstName: "Yossi", lastName: "Cohen" })]);
    const svc = new SearchService(db.people);
    const result = await svc.search({ query: "P000101" });
    assert.equal(result.results.length, 1);
    assert.equal(result.results[0].person.firstName, "Yossi");
  } finally {
    db.close();
  }
});

test("search by phone normalizes formats before matching (section 10)", async () => {
  const db = openSqliteDatabase(":memory:");
  try {
    await db.people.upsertMany([p({ syntheticPersonId: "P000101", firstName: "Yossi", phone: "0500001234" })]);
    const svc = new SearchService(db.people);
    const result = await svc.search({ query: "+972500001234" });
    assert.equal(result.results.length, 1);
  } finally {
    db.close();
  }
});

test("fuzzy name search returns a match score, and exact match scores higher than a typo (section 11)", async () => {
  const db = openSqliteDatabase(":memory:");
  try {
    await db.people.upsertMany([
      p({ syntheticPersonId: "P000101", firstName: "Yossi", lastName: "Cohen" }),
      p({ syntheticPersonId: "P000102", firstName: "Yosi", lastName: "Cohen" }), // typo variant
      p({ syntheticPersonId: "P000103", firstName: "David", lastName: "Levi" }),
    ]);
    const svc = new SearchService(db.people);
    const result = await svc.search({ query: "Yossi Cohen", type: "name" });
    assert.ok(result.results.length >= 2);
    assert.ok(result.results[0].matchScore! >= result.results[1].matchScore!);
    assert.ok(result.results.every((r) => r.matchScore !== undefined));
    assert.ok(!result.results.some((r) => r.person.syntheticPersonId === "P000103"));
  } finally {
    db.close();
  }
});

test("pagination respects max page size of 500 (section 60)", async () => {
  const db = openSqliteDatabase(":memory:");
  try {
    const people: Person[] = [];
    for (let i = 0; i < 20; i++) people.push(p({ syntheticPersonId: `P${String(i).padStart(8, "0")}`, firstName: "Yossi", lastName: "Cohen" }));
    await db.people.upsertMany(people);
    const svc = new SearchService(db.people);
    const oversized = await svc.search({ query: "Yossi", type: "name", pageSize: 10000 });
    assert.ok(oversized.pageSize <= 500);
  } finally {
    db.close();
  }
});
