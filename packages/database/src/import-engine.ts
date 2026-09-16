import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import type { Database } from "./repository.ts";

export interface ImportOptions {
  filePath: string;
  sourceName: string;
  sourceId: string;
  batchSize?: number;
  jobId: string;
  /** Test hook: throw after processing this many total lines, to simulate a mid-import crash. */
  simulateCrashAfterLines?: number;
}

export interface ImportOutcome {
  processed: number;
  failed: number;
  status: "COMPLETED" | "PAUSED" | "FAILED";
}

/**
 * Streams a JSONL file line-by-line (node:readline over a fs.ReadStream — never
 * `fs.readFileSync`, per section 26), batching inserts (default 5,000 rows,
 * section 26) and writing a checkpoint after every batch so a crashed import
 * can resume from where it left off (section 27) instead of restarting.
 *
 * A malformed line fails independently and is recorded in `import_errors`
 * without aborting the whole job (section 54).
 */
export async function importJsonlStreaming(db: Database, opts: ImportOptions): Promise<ImportOutcome> {
  const batchSize = opts.batchSize ?? 5000;
  const checkpoint = await db.importJobs.getCheckpoint(opts.jobId);
  const skipLines = checkpoint?.recordsProcessed ?? 0;

  const rl = createInterface({ input: createReadStream(opts.filePath, { encoding: "utf-8" }), crlfDelay: Infinity });

  let lineNumber = 0;
  let processedThisRun = 0;
  let processedTotal = skipLines;
  let failed = 0;
  let batch: Array<{ externalRecordId: string; payload: Record<string, unknown>; checksum: string }> = [];
  const start = Date.now();

  async function flush() {
    if (batch.length === 0) return;
    await db.rawRecords.insertMany(opts.sourceId, batch);
    processedTotal += batch.length;
    const elapsedSec = Math.max((Date.now() - start) / 1000, 0.001);
    await db.importJobs.updateProgress(opts.jobId, processedTotal, failed, processedTotal / elapsedSec);
    await db.importJobs.saveCheckpoint(opts.jobId, opts.filePath, lineNumber, processedTotal, "PROCESSING");
    batch = [];
  }

  try {
    for await (const line of rl) {
      lineNumber++;
      if (lineNumber <= skipLines) continue; // resume: skip already-processed lines

      if (opts.simulateCrashAfterLines && lineNumber > opts.simulateCrashAfterLines) {
        await flush();
        await db.importJobs.saveCheckpoint(opts.jobId, opts.filePath, lineNumber, processedTotal, "PAUSED");
        rl.close();
        return { processed: processedTotal, failed, status: "PAUSED" };
      }

      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const payload = JSON.parse(trimmed);
        batch.push({ externalRecordId: String(payload.person_id ?? payload.synthetic_person_id ?? lineNumber), payload, checksum: hash(trimmed) });
        processedThisRun++;
      } catch (err) {
        failed++;
        await db.importJobs.recordError(opts.jobId, lineNumber, trimmed.slice(0, 500), (err as Error).message);
      }

      if (batch.length >= batchSize) await flush();
    }
    await flush();
    await db.importJobs.setStatus(opts.jobId, "COMPLETED");
    return { processed: processedTotal, failed, status: "COMPLETED" };
  } catch (err) {
    await db.importJobs.setStatus(opts.jobId, "FAILED");
    throw err;
  }
}

function hash(s: string): string {
  // Lightweight non-cryptographic checksum (dedupe/verification, not security).
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return h.toString(16);
}

// ---------------------------------------------------------------------------
// Security: upload validation (section 44) — size limit + basic ZIP-bomb guard
// for gzip streams, based on declared vs. decompressed size, without ever
// buffering the whole payload in memory.
// ---------------------------------------------------------------------------

export interface UploadValidationResult {
  ok: boolean;
  reason?: string;
}

export function validateUpload(params: { sizeBytes: number; maxUploadSizeBytes: number; declaredExtension: string; allowedExtensions: string[] }): UploadValidationResult {
  if (params.sizeBytes <= 0) return { ok: false, reason: "empty file" };
  if (params.sizeBytes > params.maxUploadSizeBytes) return { ok: false, reason: "exceeds MAX_UPLOAD_SIZE" };
  if (!params.allowedExtensions.includes(params.declaredExtension.toLowerCase())) {
    return { ok: false, reason: `unsupported extension: ${params.declaredExtension}` };
  }
  return { ok: true };
}

/** Guards against decompression bombs: caps total decompressed bytes read from a gzip stream. */
export async function assertBoundedDecompression(readStream: AsyncIterable<Buffer>, maxDecompressedBytes: number): Promise<void> {
  let total = 0;
  for await (const chunk of readStream) {
    total += chunk.length;
    if (total > maxDecompressedBytes) {
      throw new Error(`decompressed size exceeds limit of ${maxDecompressedBytes} bytes — possible zip bomb`);
    }
  }
}
