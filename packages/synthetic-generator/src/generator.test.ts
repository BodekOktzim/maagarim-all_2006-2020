import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateSyntheticDataset } from "./generator.ts";

test("generates the expected people count across a small family-based dataset (section 28/29)", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sdl-gen-"));
  try {
    const report = await generateSyntheticDataset({ peopleCount: 200, seed: 1, outputDir: dir });
    // Family units are 2 parents + 2-4 children, so we may slightly overshoot the target.
    assert.ok(report.peopleGenerated >= 200);
    assert.ok(report.familiesGenerated > 0);
    assert.equal(report.files.length, 6);
    for (const f of report.files) {
      assert.ok(f.bytes > 0, `${f.source} should not be empty`);
      assert.ok(f.records > 0, `${f.source} should have records`);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("SOURCE_01 rows are valid JSONL and encode father_id/mother_id for children (section 2)", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sdl-gen-"));
  try {
    await generateSyntheticDataset({ peopleCount: 50, seed: 2, outputDir: dir });
    const raw = await readFile(join(dir, "SYNTHETIC_SOURCE_01.jsonl"), "utf-8");
    const lines: Array<{ father_id: string | null }> = raw
      .trim()
      .split("\n")
      .map((l: string) => JSON.parse(l));
    assert.ok(lines.length > 0);
    const child = lines.find((l) => l.father_id !== null);
    assert.ok(child, "expected at least one child row with a father_id");
    assert.match(child!.father_id!, /^P\d{8}$/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("intentional duplicates and conflicts are actually injected when rates > 0 (sections 31-33)", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sdl-gen-"));
  try {
    const report = await generateSyntheticDataset({
      peopleCount: 300, seed: 3, outputDir: dir, duplicateRate: 0.5, conflictRate: 0.5,
    });
    assert.ok(report.duplicatesInjected > 0, "expected duplicate records to be injected");
    assert.ok(report.conflictsInjected > 0, "expected conflicting records to be injected");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("generation is deterministic for a fixed seed (reproducible datasets)", async () => {
  const dirA = await mkdtemp(join(tmpdir(), "sdl-gen-"));
  const dirB = await mkdtemp(join(tmpdir(), "sdl-gen-"));
  try {
    const a = await generateSyntheticDataset({ peopleCount: 40, seed: 7, outputDir: dirA });
    const b = await generateSyntheticDataset({ peopleCount: 40, seed: 7, outputDir: dirB });
    const rawA = await readFile(join(dirA, "SYNTHETIC_SOURCE_01.jsonl"), "utf-8");
    const rawB = await readFile(join(dirB, "SYNTHETIC_SOURCE_01.jsonl"), "utf-8");
    assert.equal(rawA, rawB);
    assert.equal(a.peopleGenerated, b.peopleGenerated);
  } finally {
    await rm(dirA, { recursive: true, force: true });
    await rm(dirB, { recursive: true, force: true });
  }
});
