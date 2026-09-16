import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { openSqliteDatabase } from "./sqlite-database.ts";
import type { Person } from "@sdl/types";

function makePerson(overrides: Partial<Person>): Person {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    syntheticPersonId: "P000000",
    firstName: null,
    lastName: null,
    phone: null,
    email: null,
    address: null,
    city: null,
    birthYear: null,
    fatherId: null,
    motherId: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

test("SQLite database: schema applies and family (father/mother/children) round-trips", async () => {
  const db = openSqliteDatabase(":memory:");
  try {
    const father = makePerson({ syntheticPersonId: "P000001", firstName: "Avi", lastName: "Cohen" });
    const mother = makePerson({ syntheticPersonId: "P000002", firstName: "Dana", lastName: "Cohen" });
    const yossi = makePerson({ syntheticPersonId: "P000101", firstName: "Yossi", lastName: "Cohen", fatherId: "P000001", motherId: "P000002" });
    const moshe = makePerson({ syntheticPersonId: "P000102", firstName: "Moshe", lastName: "Cohen", fatherId: "P000001", motherId: "P000002" });

    await db.people.upsertMany([father, mother, yossi, moshe]);

    assert.equal(await db.people.count(), 4);

    const found = await db.people.findBySyntheticId("P000101");
    assert.equal(found?.firstName, "Yossi");

    const siblings = await db.people.findByParents("P000001", "P000002", "P000101");
    assert.equal(siblings.length, 1);
    assert.equal(siblings[0].syntheticPersonId, "P000102");

    const children = await db.people.findChildrenOf("P000001");
    assert.equal(children.length, 2);
  } finally {
    db.close();
  }
});

test("SQLite database: relationship + evidence round-trip", async () => {
  const db = openSqliteDatabase(":memory:");
  try {
    const yossi = makePerson({ syntheticPersonId: "P000101", firstName: "Yossi" });
    const moshe = makePerson({ syntheticPersonId: "P000102", firstName: "Moshe" });
    await db.people.upsertMany([yossi, moshe]);

    const rel = await db.relationships.upsert({
      sourcePersonId: "P000101",
      targetPersonId: "P000102",
      relationshipType: "SIBLING",
      confidence: "CONFIRMED",
      status: "CONFIRMED",
      evidence: [
        { sourceName: "SYNTHETIC_SOURCE_01", field: "father_id", value: "P000001", evidenceType: "STRUCTURAL" },
        { sourceName: "SYNTHETIC_SOURCE_01", field: "mother_id", value: "P000002", evidenceType: "STRUCTURAL" },
      ],
    });

    assert.equal(rel.evidence.length, 2);

    const found = await db.relationships.findForPerson("P000101");
    assert.equal(found.length, 1);
    assert.equal(found[0].evidence.length, 2);
  } finally {
    db.close();
  }
});

test("SQLite database: import job + checkpoint round-trip (section 27, Resume Import)", async () => {
  const db = openSqliteDatabase(":memory:");
  try {
    const job = await db.importJobs.create({
      file: "dataset.jsonl",
      sizeBytes: 1_000_000,
      format: "jsonl",
      totalRecords: 100,
      speedRecordsPerSec: null,
      status: "PROCESSING",
    });

    await db.importJobs.saveCheckpoint(job.id, "dataset.jsonl", 382_920, 60, "PAUSED");
    const checkpoint = await db.importJobs.getCheckpoint(job.id);
    assert.equal(checkpoint?.recordsProcessed, 60);

    await db.importJobs.updateProgress(job.id, 100, 0, 31200);
    const updated = await db.importJobs.get(job.id);
    assert.equal(updated?.processedRecords, 100);
    assert.equal(updated?.status, "PROCESSING"); // status field itself unchanged by updateProgress
  } finally {
    db.close();
  }
});
