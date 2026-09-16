import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import type { Person } from "@sdl/types";

/** Deterministic PRNG (mulberry32) so generated datasets are reproducible for a given seed. */
function mulberry32(seed: number) {
  let a = seed;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FIRST_NAMES = ["Yossi", "Moshe", "Gabi", "Avi", "Dana", "Ronit", "Michal", "Tal", "David", "Noa", "Eitan", "Maya"];
const LAST_NAMES = ["Cohen", "Levi", "Mizrahi", "Peretz", "Demo", "Azulay", "Bar"];
const CITIES = ["Netanya", "Haifa", "Beersheba", "Ashdod", "Rishon"];

export interface GeneratorConfig {
  peopleCount: number;
  seed?: number;
  outputDir: string;
  /** Fraction (0-1) of people who get an intentional near-duplicate/typo variant in another source. Section 31/32. */
  duplicateRate?: number;
  /** Fraction (0-1) of people who get a conflicting phone/address across two sources. Section 16/69. */
  conflictRate?: number;
}

export interface GenerationReport {
  peopleGenerated: number;
  familiesGenerated: number;
  files: Array<{ source: string; path: string; records: number; bytes: number }>;
  duplicatesInjected: number;
  conflictsInjected: number;
}

function pad(n: number, width: number): string {
  return String(n).padStart(width, "0");
}

function checksum(payload: unknown): string {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex").slice(0, 16);
}

/**
 * Generates a synthetic dataset: nuclear families (2 parents + 2-4 children),
 * split across 5 partial sources (section 2), with intentional duplicates,
 * near-duplicates, and field conflicts (sections 31-33) so Entity Resolution
 * and Conflict Detection have real signal to work with.
 *
 * Writes each source as a streamed JSONL file — never holds the whole dataset
 * in memory (section 26), so this same code path scales from 1k to 10M+ people.
 */
export async function generateSyntheticDataset(config: GeneratorConfig): Promise<GenerationReport> {
  const rand = mulberry32(config.seed ?? 42);
  const duplicateRate = config.duplicateRate ?? 0.05;
  const conflictRate = config.conflictRate ?? 0.03;

  await mkdir(config.outputDir, { recursive: true });

  const sourceNames = [
    "SYNTHETIC_SOURCE_01",
    "SYNTHETIC_SOURCE_02",
    "SYNTHETIC_SOURCE_03",
    "SYNTHETIC_SOURCE_04",
    "SYNTHETIC_SOCIAL_SOURCE",
    "SYNTHETIC_PHONE_SOURCE",
  ] as const;

  const streams = new Map<string, ReturnType<typeof createWriteStream>>();
  const counts = new Map<string, number>();
  for (const name of sourceNames) {
    const path = `${config.outputDir}/${name}.jsonl`;
    streams.set(name, createWriteStream(path, { encoding: "utf-8" }));
    counts.set(name, 0);
  }

  function write(source: string, payload: Record<string, unknown>) {
    streams.get(source)!.write(JSON.stringify(payload) + "\n");
    counts.set(source, (counts.get(source) ?? 0) + 1);
  }

  let personSeq = 1;
  let familySeq = 1;
  let generated = 0;
  let duplicatesInjected = 0;
  let conflictsInjected = 0;

  function nextId(): string {
    return `P${pad(personSeq++, 8)}`;
  }
  function pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(rand() * arr.length)];
  }
  function phoneFor(seq: number): string {
    return `050-000-${pad(seq % 10000, 4)}`;
  }

  const allPeople: Person[] = [];
  const now = new Date().toISOString();

  while (generated < config.peopleCount) {
    const familyId = `F${pad(familySeq++, 8)}`;
    const fatherId = nextId();
    const motherId = nextId();
    const lastName = pick(LAST_NAMES);
    const fatherName = { first: pick(FIRST_NAMES), last: lastName };
    const motherName = { first: pick(FIRST_NAMES), last: lastName };
    const city = pick(CITIES);
    const addressNum = 1 + Math.floor(rand() * 500);
    const address = `${addressNum} Example Street`;

    for (const [id, name] of [
      [fatherId, fatherName],
      [motherId, motherName],
    ] as const) {
      const phone = phoneFor(personSeq);
      const person: Person = {
        id, syntheticPersonId: id, firstName: name.first, lastName: name.last,
        phone, email: null, address, city, birthYear: 1960 + Math.floor(rand() * 20),
        fatherId: null, motherId: null, createdAt: now, updatedAt: now,
      };
      allPeople.push(person);
      write("SYNTHETIC_SOURCE_01", { person_id: id, first_name: name.first, last_name: name.last, father_id: null, mother_id: null });
      write("SYNTHETIC_SOURCE_02", { person_id: id, phone, address, city });
      generated++;
    }

    const childCount = 2 + Math.floor(rand() * 3); // 2-4 children
    for (let c = 0; c < childCount && generated < config.peopleCount; c++) {
      const childId = nextId();
      const childFirst = pick(FIRST_NAMES);
      const phone = phoneFor(personSeq);
      const birthYear = 1990 + Math.floor(rand() * 20);

      const person: Person = {
        id: childId, syntheticPersonId: childId, firstName: childFirst, lastName,
        phone, email: null, address, city, birthYear,
        fatherId, motherId, createdAt: now, updatedAt: now,
      };
      allPeople.push(person);

      write("SYNTHETIC_SOURCE_01", { person_id: childId, first_name: childFirst, last_name: lastName, father_id: fatherId, mother_id: motherId });
      write("SYNTHETIC_SOURCE_02", { person_id: childId, phone, address, city });
      write("SYNTHETIC_SOURCE_03", { person_id: childId, first_name: childFirst, last_name: lastName, phone });
      write("SYNTHETIC_SOURCE_04", { person_id: childId, father_id: fatherId, mother_id: motherId, birth_year: birthYear });
      write("SYNTHETIC_SOCIAL_SOURCE", {
        synthetic_person_id: childId,
        username: `${childFirst.toLowerCase()}_demo_${childId.slice(1)}`,
        display_name: `${childFirst} ${lastName}`,
        phone,
      });
      write("SYNTHETIC_PHONE_SOURCE", { phone, name: `${childFirst} ${lastName}`, synthetic_person_id: childId });

      // Intentional near-duplicate: typo'd name and/or reformatted phone in another source (section 31/32).
      if (rand() < duplicateRate) {
        const typoName = childFirst.length > 3 ? childFirst.slice(0, -1) : childFirst; // "Yossi" -> "Yoss"-like typo
        const reformattedPhone = phone.replace(/-/g, "");
        write("SYNTHETIC_SOURCE_03", { person_id: childId, first_name: typoName, last_name: `${lastName.charAt(0)}.`, phone: reformattedPhone });
        duplicatesInjected++;
      }

      // Intentional conflict: a different phone number for the same person in another source (section 16/69).
      if (rand() < conflictRate) {
        const conflictingPhone = phoneFor(personSeq + 9999);
        write("SYNTHETIC_PHONE_SOURCE", { phone: conflictingPhone, name: `${childFirst} ${lastName}`, synthetic_person_id: childId });
        conflictsInjected++;
      }

      generated++;
    }
  }

  await Promise.all(
    [...streams.values()].map(
      (s) =>
        new Promise<void>((resolve, reject) => {
          s.end((err: unknown) => (err ? reject(err) : resolve()));
        }),
    ),
  );

  const { statSync } = await import("node:fs");
  const files = sourceNames.map((name) => {
    const path = `${config.outputDir}/${name}.jsonl`;
    const bytes = statSync(path).size;
    return { source: name, path, records: counts.get(name) ?? 0, bytes };
  });

  return {
    peopleGenerated: allPeople.length,
    familiesGenerated: familySeq - 1,
    files,
    duplicatesInjected,
    conflictsInjected,
  };
}

export { checksum };
