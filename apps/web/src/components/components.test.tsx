import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { openSqliteDatabase } from "@sdl/database";
import { RelationshipEngine } from "@sdl/relationships";
import { FamilyGraph } from "./FamilyGraph.tsx";
import { PersonProfile, Dashboard } from "./PersonProfile.tsx";
import type { Person } from "@sdl/types";

function p(overrides: Partial<Person>): Person {
  const now = new Date().toISOString();
  return {
    id: randomUUID(), syntheticPersonId: "P000000", firstName: null, lastName: null,
    phone: null, email: null, address: null, city: null, birthYear: null,
    fatherId: null, motherId: null, createdAt: now, updatedAt: now, ...overrides,
  };
}

test("FamilyGraph renders real relationship-engine output as SVG without throwing", async () => {
  const db = openSqliteDatabase(":memory:");
  try {
    await db.people.upsertMany([
      p({ syntheticPersonId: "P000001", firstName: "Avi" }),
      p({ syntheticPersonId: "P000002", firstName: "Dana" }),
      p({ syntheticPersonId: "P000101", firstName: "Yossi", fatherId: "P000001", motherId: "P000002" }),
      p({ syntheticPersonId: "P000102", firstName: "Moshe", fatherId: "P000001", motherId: "P000002" }),
    ]);
    const engine = new RelationshipEngine(db.people, db.relationships);
    const person = (await db.people.findBySyntheticId("P000101"))!;
    const parents = await engine.getParents("P000101");
    const siblings = await engine.getSiblings("P000101");

    const html = renderToStaticMarkup(React.createElement(FamilyGraph, { person, parents, siblings }));

    assert.match(html, /<svg/);
    assert.match(html, /Yossi/);
    assert.match(html, /Moshe/);
    assert.match(html, /Avi/);
  } finally {
    db.close();
  }
});

test("PersonProfile and Dashboard render with real field values", () => {
  const person = p({ syntheticPersonId: "P000101", firstName: "Yossi", lastName: "Cohen", phone: "050-000-1234" });
  const profileHtml = renderToStaticMarkup(React.createElement(PersonProfile, { person, sourceCount: 3, relationshipCount: 7 }));
  assert.match(profileHtml, /Yossi Cohen/);
  assert.match(profileHtml, /P000101/);

  const dashboardHtml = renderToStaticMarkup(
    React.createElement(Dashboard, { totalPeople: 1000, totalRecords: 5000, totalRelationships: 250, totalSources: 6, conflicts: 12 }),
  );
  assert.match(dashboardHtml, /1,000/);
  assert.match(dashboardHtml, /Conflicts/);
});
