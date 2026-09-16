import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { openSqliteDatabase } from "@sdl/database";
import { createApiServer } from "./server.ts";
import type { Person } from "@sdl/types";

function p(overrides: Partial<Person>): Person {
  const now = new Date().toISOString();
  return {
    id: randomUUID(), syntheticPersonId: "P000000", firstName: null, lastName: null,
    phone: null, email: null, address: null, city: null, birthYear: null,
    fatherId: null, motherId: null, createdAt: now, updatedAt: now, ...overrides,
  };
}

async function withServer(fn: (baseUrl: string, db: ReturnType<typeof openSqliteDatabase>) => Promise<void>) {
  const db = openSqliteDatabase(":memory:");
  const server = createApiServer(db, { apiToken: "test-token" });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  try {
    await fn(`http://127.0.0.1:${port}`, db);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    db.close();
  }
}

test("HTTP: unauthenticated request is rejected with 401 (section 43)", async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/api/sources`);
    assert.equal(res.status, 401);
  });
});

test("HTTP: GET /api/people/:id returns the real record over a real socket", async () => {
  await withServer(async (base, db) => {
    await db.people.upsertMany([p({ syntheticPersonId: "P000101", firstName: "Yossi", lastName: "Cohen" })]);
    const res = await fetch(`${base}/api/people/P000101`, { headers: { Authorization: "Bearer test-token" } });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.firstName, "Yossi");
  });
});

test("HTTP: GET /api/people/:id/siblings returns CONFIRMED siblings over the wire", async () => {
  await withServer(async (base, db) => {
    await db.people.upsertMany([
      p({ syntheticPersonId: "P000101", fatherId: "P1", motherId: "P2" }),
      p({ syntheticPersonId: "P000102", fatherId: "P1", motherId: "P2" }),
    ]);
    const res = await fetch(`${base}/api/people/P000101/siblings`, { headers: { Authorization: "Bearer test-token" } });
    const body = await res.json();
    assert.equal(body.length, 1);
    assert.equal(body[0].status, "CONFIRMED");
  });
});

test("HTTP: POST /api/search resolves by phone end-to-end", async () => {
  await withServer(async (base, db) => {
    await db.people.upsertMany([p({ syntheticPersonId: "P000101", firstName: "Yossi", phone: "0500001234" })]);
    const res = await fetch(`${base}/api/search`, {
      method: "POST",
      headers: { Authorization: "Bearer test-token", "Content-Type": "application/json" },
      body: JSON.stringify({ query: "050-000-1234" }),
    });
    const body = await res.json();
    assert.equal(body.resolvedType, "phone");
    assert.equal(body.results.length, 1);
  });
});

test("HTTP: unknown route returns 404, and every request is audit-logged (section 42)", async () => {
  await withServer(async (base, db) => {
    const res = await fetch(`${base}/api/nonsense`, { headers: { Authorization: "Bearer test-token" } });
    assert.equal(res.status, 404);
    const logs = await db.auditLogs.recent(10);
    assert.ok(logs.some((l) => l.target === "/api/nonsense"));
  });
});
