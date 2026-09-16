import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizePhone, normalizeAddress, similarityScore } from "./normalize.ts";

test("normalizePhone collapses all synthetic formats to the same digits (section 10)", () => {
  const a = normalizePhone("050-000-0001");
  const b = normalizePhone("0500000001");
  const c = normalizePhone("+972500000001");
  assert.equal(a, "0500000001");
  assert.equal(b, "0500000001");
  assert.equal(c, "0500000001");
  assert.equal(a, b);
  assert.equal(b, c);
});

test("normalizeAddress unifies St./Street variants (section 12)", () => {
  const a = normalizeAddress("10 Example St.");
  const b = normalizeAddress("10 Example Street");
  const c = normalizeAddress("10 EXAMPLE STREET");
  assert.equal(a, b);
  assert.equal(b, c);
});

test("similarityScore: 'Yossi Cohen' vs 'Yosi Cohen' is high but not identity (section 11)", () => {
  const score = similarityScore("Yossi Cohen", "Yosi Cohen");
  assert.ok(score > 0.85, `expected high similarity, got ${score}`);
  assert.ok(score < 1, "must not claim identity for a spelling variant");
});

test("similarityScore: unrelated names score low", () => {
  const score = similarityScore("Yossi Cohen", "Ahmad Khalil");
  assert.ok(score < 0.5, `expected low similarity, got ${score}`);
});
