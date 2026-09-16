import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openSqliteDatabase } from "./sqlite/sqlite-database.ts";
import { importJsonlStreaming, validateUpload } from "./import-engine.ts";
import { generateSyntheticDataset } from "@sdl/synthetic-generator";

test("section 27 — Resume Import: crash mid-way then resume yields the same final count as an uninterrupted import", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sdl-import-"));
  try {
    const gen = await generateSyntheticDataset({ peopleCount: 300, seed: 11, outputDir: dir });
    const file = gen.files.find((f) => f.source === "SYNTHETIC_SOURCE_01")!;

    // --- Baseline: uninterrupted import into DB A ---
    const dbA = openSqliteDatabase(":memory:");
    const sourceA = await dbA.sources.upsert({ name: "SYNTHETIC_SOURCE_01", type: "structured", description: "", version: "1.0" });
    const jobA = await dbA.importJobs.create({ file: file.path, sizeBytes: file.bytes, format: "jsonl", totalRecords: file.records, speedRecordsPerSec: null, status: "PROCESSING" });
    const outcomeA = await importJsonlStreaming(dbA, { filePath: file.path, sourceName: "SYNTHETIC_SOURCE_01", sourceId: sourceA.id, jobId: jobA.id, batchSize: 37 });
    assert.equal(outcomeA.status, "COMPLETED");
    assert.equal(outcomeA.failed, 0);

    // --- Interrupted: DB B, crash after 100 lines, then resume with a fresh call ---
    const dbB = openSqliteDatabase(":memory:");
    const sourceB = await dbB.sources.upsert({ name: "SYNTHETIC_SOURCE_01", type: "structured", description: "", version: "1.0" });
    const jobB = await dbB.importJobs.create({ file: file.path, sizeBytes: file.bytes, format: "jsonl", totalRecords: file.records, speedRecordsPerSec: null, status: "PROCESSING" });

    const crashed = await importJsonlStreaming(dbB, {
      filePath: file.path, sourceName: "SYNTHETIC_SOURCE_01", sourceId: sourceB.id, jobId: jobB.id,
      batchSize: 37, simulateCrashAfterLines: 100,
    });
    assert.equal(crashed.status, "PAUSED");
    assert.ok(crashed.processed < outcomeA.processed, "should have stopped short of full completion");

    const checkpoint = await dbB.importJobs.getCheckpoint(jobB.id);
    assert.ok(checkpoint && checkpoint.recordsProcessed > 0, "checkpoint must have been persisted");

    // Resume: same jobId, engine reads the checkpoint and skips already-processed lines.
    const resumed = await importJsonlStreaming(dbB, { filePath: file.path, sourceName: "SYNTHETIC_SOURCE_01", sourceId: sourceB.id, jobId: jobB.id, batchSize: 37 });
    assert.equal(resumed.status, "COMPLETED");
    assert.equal(resumed.processed, outcomeA.processed, "resumed import must reach the same final count as the uninterrupted one");

    dbA.close();
    dbB.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("section 54 — a malformed line fails independently without aborting the whole import", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sdl-import-bad-"));
  try {
    const { writeFile } = await import("node:fs/promises");
    const filePath = join(dir, "mixed.jsonl");
    await writeFile(
      filePath,
      [
        JSON.stringify({ person_id: "P00000001", first_name: "Yossi" }),
        "{not valid json!!",
        JSON.stringify({ person_id: "P00000002", first_name: "Moshe" }),
      ].join("\n"),
    );

    const db = openSqliteDatabase(":memory:");
    const source = await db.sources.upsert({ name: "SYNTHETIC_SOURCE_01", type: "structured", description: "", version: "1.0" });
    const job = await db.importJobs.create({ file: filePath, sizeBytes: 100, format: "jsonl", totalRecords: 3, speedRecordsPerSec: null, status: "PROCESSING" });
    const outcome = await importJsonlStreaming(db, { filePath, sourceName: "SYNTHETIC_SOURCE_01", sourceId: source.id, jobId: job.id });

    assert.equal(outcome.status, "COMPLETED");
    assert.equal(outcome.processed, 2, "2 valid lines should have been imported");
    assert.equal(outcome.failed, 1, "1 malformed line should be recorded as failed, not crash the job");
    db.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("section 44 — upload validation rejects oversized/unsupported files without buffering them", () => {
  const tooBig = validateUpload({ sizeBytes: 6 * 1024 * 1024 * 1024, maxUploadSizeBytes: 5 * 1024 * 1024 * 1024, declaredExtension: ".jsonl", allowedExtensions: [".csv", ".json", ".jsonl"] });
  assert.equal(tooBig.ok, false);

  const badExt = validateUpload({ sizeBytes: 1000, maxUploadSizeBytes: 5 * 1024 * 1024 * 1024, declaredExtension: ".exe", allowedExtensions: [".csv", ".json", ".jsonl"] });
  assert.equal(badExt.ok, false);

  const good = validateUpload({ sizeBytes: 1000, maxUploadSizeBytes: 5 * 1024 * 1024 * 1024, declaredExtension: ".jsonl", allowedExtensions: [".csv", ".json", ".jsonl"] });
  assert.equal(good.ok, true);
});
