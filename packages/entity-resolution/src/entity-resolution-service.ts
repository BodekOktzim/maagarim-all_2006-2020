import type { Person, EntityMatch, MatchType, ConfidenceLevel } from "@sdl/types";
import { normalizePhone, normalizeName, normalizeAddress, similarityScore } from "@sdl/shared";

/**
 * EntityResolutionService
 * ------------------------
 * Decides whether two synthetic records refer to the same synthetic entity,
 * and records the evidence for that decision (section 13/14).
 *
 * Hard rule (section 15): confidence can only be upgraded with NEW evidence —
 * this service never mutates a LOW match into CONFIRMED on its own; it always
 * returns the level implied by the evidence actually compared.
 */
export class EntityResolutionService {
  /**
   * Compares two records field-by-field and returns the strongest applicable
   * match type + confidence + evidence trail.
   */
  compare(
    a: { sourceName: string; person: Pick<Person, "firstName" | "lastName" | "phone" | "email" | "address"> & { syntheticPersonId: string | null } },
    b: { sourceName: string; person: Pick<Person, "firstName" | "lastName" | "phone" | "email" | "address"> & { syntheticPersonId: string | null } },
  ): EntityMatch {
    // EXACT_ID — strongest possible signal (section 15: Same ID -> CONFIRMED)
    if (a.person.syntheticPersonId && a.person.syntheticPersonId === b.person.syntheticPersonId) {
      return {
        matchType: "EXACT_ID",
        confidence: 1,
        confidenceLevel: "CONFIRMED",
        evidence: [{ field: "person_id", sourceA: a.sourceName, sourceB: b.sourceName, value: a.person.syntheticPersonId }],
      };
    }

    const evidence: EntityMatch["evidence"] = [];
    let phoneMatch = false;
    let emailMatch = false;
    let nameScore = 0;
    let addressMatch = false;

    if (a.person.phone && b.person.phone) {
      const na = normalizePhone(a.person.phone);
      const nb = normalizePhone(b.person.phone);
      if (na && na === nb) {
        phoneMatch = true;
        evidence.push({ field: "phone", sourceA: a.sourceName, sourceB: b.sourceName, value: na });
      }
    }
    if (a.person.email && b.person.email && a.person.email.toLowerCase() === b.person.email.toLowerCase()) {
      emailMatch = true;
      evidence.push({ field: "email", sourceA: a.sourceName, sourceB: b.sourceName, value: a.person.email.toLowerCase() });
    }
    if (a.person.firstName && a.person.lastName && b.person.firstName && b.person.lastName) {
      const nameA = `${a.person.firstName} ${a.person.lastName}`;
      const nameB = `${b.person.firstName} ${b.person.lastName}`;
      nameScore = similarityScore(nameA, nameB);
      if (nameScore > 0.7) {
        evidence.push({ field: "name", sourceA: a.sourceName, sourceB: b.sourceName, value: `${normalizeName(nameA)} ~ ${normalizeName(nameB)} (${nameScore.toFixed(2)})` });
      }
    }
    if (a.person.address && b.person.address && normalizeAddress(a.person.address) === normalizeAddress(b.person.address)) {
      addressMatch = true;
      evidence.push({ field: "address", sourceA: a.sourceName, sourceB: b.sourceName, value: normalizeAddress(a.person.address) });
    }

    // Section 15 rules, applied from strongest to weakest combination.
    if (phoneMatch && nameScore > 0.85) {
      return { matchType: "MULTI_FIELD_MATCH", confidence: 0.95, confidenceLevel: "HIGH", evidence };
    }
    if (emailMatch) {
      return { matchType: "EXACT_EMAIL", confidence: 0.9, confidenceLevel: "HIGH", evidence };
    }
    if (phoneMatch) {
      return { matchType: "EXACT_PHONE", confidence: 0.8, confidenceLevel: "MEDIUM", evidence };
    }
    if (nameScore > 0.85 && addressMatch) {
      return { matchType: "MULTI_FIELD_MATCH", confidence: 0.75, confidenceLevel: "MEDIUM", evidence };
    }
    if (addressMatch) {
      return { matchType: "ADDRESS_MATCH", confidence: 0.4, confidenceLevel: "LOW", evidence };
    }
    if (nameScore > 0.85) {
      // Section 11 rule made explicit: a high name score alone is LOW confidence,
      // never proof of identity.
      return { matchType: "NAME_MATCH", confidence: nameScore * 0.5, confidenceLevel: "LOW", evidence };
    }

    return { matchType: "NAME_MATCH", confidence: 0, confidenceLevel: "UNRESOLVED", evidence: [] };
  }

  /**
   * Section 16 — Conflict Detection: if two sources disagree on a field value
   * for the same synthetic_person_id, NOTHING is deleted; both are surfaced.
   */
  detectFieldConflict(
    personId: string,
    field: string,
    observations: Array<{ source: string; value: string; timestamp: string; confidence: ConfidenceLevel }>,
  ): { hasConflict: boolean; distinctValues: string[] } {
    const distinct = [...new Set(observations.map((o) => o.value))];
    return { hasConflict: distinct.length > 1, distinctValues: distinct };
  }
}
