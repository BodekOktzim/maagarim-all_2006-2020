import { test } from "node:test";
import assert from "node:assert/strict";
import { EntityResolutionService } from "./entity-resolution-service.ts";

const svc = new EntityResolutionService();

function person(overrides: Record<string, any>) {
  return { syntheticPersonId: null, firstName: null, lastName: null, phone: null, email: null, address: null, ...overrides };
}

test("section 13/70 — Duplicate Test: same ID from two sources => EXACT_ID / CONFIRMED", () => {
  const a = { sourceName: "SYNTHETIC_SOURCE_01", person: person({ syntheticPersonId: "P000101", firstName: "Yossi", lastName: "Cohen" }) };
  const b = { sourceName: "SYNTHETIC_SOURCE_02", person: person({ syntheticPersonId: "P000101", firstName: "Yosi", lastName: "Cohen" }) };
  const match = svc.compare(a, b);
  assert.equal(match.matchType, "EXACT_ID");
  assert.equal(match.confidenceLevel, "CONFIRMED");
  assert.equal(match.confidence, 1);
});

test("section 15 — same name + same phone => HIGH, not CONFIRMED (needs new evidence to upgrade)", () => {
  const a = { sourceName: "SYNTHETIC_SOURCE_01", person: person({ firstName: "Yossi", lastName: "Cohen", phone: "050-000-1234" }) };
  const b = { sourceName: "SYNTHETIC_SOURCE_02", person: person({ firstName: "Yossi", lastName: "Cohen", phone: "0500001234" }) };
  const match = svc.compare(a, b);
  assert.equal(match.confidenceLevel, "HIGH");
  assert.notEqual(match.confidenceLevel, "CONFIRMED");
});

test("section 15 — same name only => LOW, never auto-upgraded to CONFIRMED", () => {
  const a = { sourceName: "SYNTHETIC_SOURCE_01", person: person({ firstName: "Yossi", lastName: "Cohen" }) };
  const b = { sourceName: "SYNTHETIC_SOURCE_03", person: person({ firstName: "Yossi", lastName: "Cohen" }) };
  const match = svc.compare(a, b);
  assert.equal(match.confidenceLevel, "LOW");
});

test("unrelated people => UNRESOLVED, no fabricated evidence", () => {
  const a = { sourceName: "SYNTHETIC_SOURCE_01", person: person({ firstName: "Yossi", lastName: "Cohen" }) };
  const b = { sourceName: "SYNTHETIC_SOURCE_02", person: person({ firstName: "Ahmad", lastName: "Khalil" }) };
  const match = svc.compare(a, b);
  assert.equal(match.confidenceLevel, "UNRESOLVED");
  assert.equal(match.evidence.length, 0);
});

test("section 69 — Conflict Test: two sources disagree on phone => CONFLICT DETECTED, nothing deleted", () => {
  const result = svc.detectFieldConflict("P000101", "phone", [
    { source: "SYNTHETIC_SOURCE_02", value: "0500001111", timestamp: "2026-01-01T00:00:00Z", confidence: "HIGH" },
    { source: "SYNTHETIC_PHONE_SOURCE", value: "0500002222", timestamp: "2026-01-02T00:00:00Z", confidence: "MEDIUM" },
  ]);
  assert.equal(result.hasConflict, true);
  assert.deepEqual(result.distinctValues.sort(), ["0500001111", "0500002222"]);
});

test("no conflict when all sources agree on a field", () => {
  const result = svc.detectFieldConflict("P000101", "phone", [
    { source: "SYNTHETIC_SOURCE_02", value: "0500001111", timestamp: "2026-01-01T00:00:00Z", confidence: "HIGH" },
    { source: "SYNTHETIC_PHONE_SOURCE", value: "0500001111", timestamp: "2026-01-02T00:00:00Z", confidence: "MEDIUM" },
  ]);
  assert.equal(result.hasConflict, false);
});
