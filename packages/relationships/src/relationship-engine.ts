import type { Person, RelationshipEvidenceItem, RelationshipStatus, SyntheticPersonId } from "@sdl/types";
import type { PersonRepository, RelationshipRepository } from "@sdl/database";

/**
 * RelationshipEngine
 * -------------------
 * Every relationship this engine returns is derived from explicit field-level
 * evidence (section 6/79). Hard rule (section 4/41): NEVER infer a relationship
 * from matching last name / address / phone / first name / "AI thinks so" —
 * only structural evidence (father_id / mother_id / explicit SPOUSE rows) counts.
 *
 * Depends only on @sdl/database's repository interfaces, so it runs unchanged
 * against SQLite (sandbox/tests) or Postgres (production).
 */
export class RelationshipEngine {
  constructor(
    private readonly people: PersonRepository,
    private readonly relationships: RelationshipRepository,
  ) {}

  async getParents(personId: SyntheticPersonId): Promise<Person[]> {
    const person = await this.people.findBySyntheticId(personId);
    if (!person) return [];
    const ids = [person.fatherId, person.motherId].filter((id): id is string => id !== null);
    if (ids.length === 0) return [];
    return this.people.findByIds(ids);
  }

  async getChildren(personId: SyntheticPersonId): Promise<Person[]> {
    return this.people.findChildrenOf(personId);
  }

  async getSiblings(personId: SyntheticPersonId): Promise<SiblingResult[]> {
    const person = await this.people.findBySyntheticId(personId);
    if (!person) return [];
    const { fatherId, motherId } = person;

    if (fatherId && motherId) {
      const rows = await this.people.findByParents(fatherId, motherId, personId);
      return rows.map((p) => ({
        person: p,
        status: "CONFIRMED" as RelationshipStatus,
        evidence: [
          { field: "father_id", source: "SYNTHETIC_SOURCE_01", value: fatherId },
          { field: "mother_id", source: "SYNTHETIC_SOURCE_01", value: motherId },
        ],
      }));
    }

    if (fatherId) {
      const rows = await this.people.findByFather(fatherId, personId);
      return rows.map((p) => ({
        person: p,
        status: "POSSIBLE_RELATION" as RelationshipStatus,
        evidence: [{ field: "father_id", source: "SYNTHETIC_SOURCE_01", value: fatherId }],
      }));
    }

    if (motherId) {
      const rows = await this.people.findByMother(motherId, personId);
      return rows.map((p) => ({
        person: p,
        status: "POSSIBLE_RELATION" as RelationshipStatus,
        evidence: [{ field: "mother_id", source: "SYNTHETIC_SOURCE_01", value: motherId }],
      }));
    }

    return [];
  }

  async getGrandparents(personId: SyntheticPersonId): Promise<Person[]> {
    const parents = await this.getParents(personId);
    const out: Person[] = [];
    for (const parent of parents) out.push(...(await this.getParents(parent.syntheticPersonId)));
    return dedupe(out);
  }

  async getGrandchildren(personId: SyntheticPersonId): Promise<Person[]> {
    const children = await this.getChildren(personId);
    const out: Person[] = [];
    for (const child of children) out.push(...(await this.getChildren(child.syntheticPersonId)));
    return dedupe(out);
  }

  async getUnclesAndAunts(personId: SyntheticPersonId): Promise<Person[]> {
    const parents = await this.getParents(personId);
    const out: Person[] = [];
    for (const parent of parents) {
      const sibs = await this.getSiblings(parent.syntheticPersonId);
      out.push(...sibs.map((s) => s.person));
    }
    return dedupe(out);
  }

  async getCousins(personId: SyntheticPersonId): Promise<Person[]> {
    const unclesAunts = await this.getUnclesAndAunts(personId);
    const out: Person[] = [];
    for (const rel of unclesAunts) out.push(...(await this.getChildren(rel.syntheticPersonId)));
    return dedupe(out);
  }

  async getSpouse(personId: SyntheticPersonId): Promise<Person[]> {
    return this.relationships.findSpouse(personId);
  }

  async getExtendedFamily(personId: SyntheticPersonId) {
    const [parents, children, siblings, grandparents, grandchildren, unclesAndAunts, cousins, spouse] =
      await Promise.all([
        this.getParents(personId),
        this.getChildren(personId),
        this.getSiblings(personId),
        this.getGrandparents(personId),
        this.getGrandchildren(personId),
        this.getUnclesAndAunts(personId),
        this.getCousins(personId),
        this.getSpouse(personId),
      ]);
    return { parents, children, siblings, grandparents, grandchildren, unclesAndAunts, cousins, spouse };
  }

  async getConnectedNetwork(personId: SyntheticPersonId, maxDepth = 3): Promise<NetworkNode[]> {
    const depth = Math.min(Math.max(maxDepth, 1), 10);
    const visited = new Set<string>([personId]);
    const nodes: NetworkNode[] = [{ personId, depth: 0 }];
    let frontier = [personId];

    for (let d = 1; d <= depth; d++) {
      const next: string[] = [];
      for (const id of frontier) {
        const ext = await this.getExtendedFamily(id);
        const neighbours = [...ext.parents, ...ext.children, ...ext.siblings.map((s) => s.person), ...ext.spouse];
        for (const n of neighbours) {
          if (!visited.has(n.syntheticPersonId)) {
            visited.add(n.syntheticPersonId);
            nodes.push({ personId: n.syntheticPersonId, depth: d });
            next.push(n.syntheticPersonId);
          }
        }
      }
      frontier = next;
      if (frontier.length === 0) break;
    }
    return nodes;
  }

  async explainRelationship(
    personA: SyntheticPersonId,
    personB: SyntheticPersonId,
  ): Promise<{ status: RelationshipStatus; evidence: RelationshipEvidenceItem[] } | { status: "UNRESOLVED_CANDIDATE" }> {
    const siblings = await this.getSiblings(personA);
    const match = siblings.find((s) => s.person.syntheticPersonId === personB);
    if (match) return { status: match.status, evidence: match.evidence };
    return { status: "UNRESOLVED_CANDIDATE" };
  }
}

export interface SiblingResult {
  person: Person;
  status: RelationshipStatus;
  evidence: RelationshipEvidenceItem[];
}
export interface NetworkNode {
  personId: SyntheticPersonId;
  depth: number;
}

function dedupe(people: Person[]): Person[] {
  const seen = new Set<string>();
  return people.filter((p) => (seen.has(p.syntheticPersonId) ? false : (seen.add(p.syntheticPersonId), true)));
}
