import type { Database } from "@sdl/database";
import { RelationshipEngine } from "@sdl/relationships";
import { SearchService } from "@sdl/search";
import { EntityResolutionService } from "@sdl/entity-resolution";
import type { SyntheticPersonId } from "@sdl/types";

/**
 * AI Orchestrator
 * ----------------
 * Section 38/39: the AI layer NEVER gets a raw DB handle or SQL access. It
 * only ever calls one of the named tools below, each backed by a validated
 * service (RelationshipEngine / SearchService / EntityResolutionService).
 *
 * Section 41/78: the orchestrator itself enforces "AI must not guess" —
 * relationship tools return the engine's own status (CONFIRMED /
 * POSSIBLE_RELATION / UNRESOLVED_CANDIDATE) verbatim. Nothing here upgrades
 * a status or invents evidence; callAiTool() is a closed whitelist and
 * throws on anything not in it (including any attempt to pass raw SQL).
 */

export const AI_TOOL_NAMES = [
  "search_person",
  "search_phone",
  "search_name",
  "get_parents",
  "get_children",
  "get_siblings",
  "get_extended_family",
  "get_relationships",
  "get_sources",
  "compare_records",
  "get_conflicts",
] as const;
export type AiToolName = (typeof AI_TOOL_NAMES)[number];

export interface AiToolCall {
  tool: string;
  args: Record<string, unknown>;
}

export class ToolNotAllowedError extends Error {
  constructor(tool: string) {
    super(`Tool "${tool}" is not in the whitelisted AI tool catalog. The AI orchestrator has no raw SQL or DB access (section 39).`);
    this.name = "ToolNotAllowedError";
  }
}

export class AiOrchestrator {
  private readonly relationships: RelationshipEngine;
  private readonly search: SearchService;
  private readonly entityResolution = new EntityResolutionService();

  constructor(private readonly db: Database) {
    this.relationships = new RelationshipEngine(db.people, db.relationships);
    this.search = new SearchService(db.people);
  }

  /** The single entrypoint the AI is allowed to call through. Closed whitelist. */
  async callTool(call: AiToolCall): Promise<unknown> {
    if (!AI_TOOL_NAMES.includes(call.tool as AiToolName)) {
      throw new ToolNotAllowedError(call.tool);
    }
    const start = Date.now();
    const result = await this.dispatch(call.tool as AiToolName, call.args);
    await this.db.auditLogs.record({
      user: "ai_orchestrator",
      timestamp: new Date().toISOString(),
      action: call.tool,
      target: JSON.stringify(call.args),
      result: "ok",
      durationMs: Date.now() - start,
    });
    return result;
  }

  private async dispatch(tool: AiToolName, args: Record<string, unknown>): Promise<unknown> {
    switch (tool) {
      case "search_person":
        return this.db.people.findBySyntheticId(args.id as SyntheticPersonId);
      case "search_phone":
        return this.search.search({ query: args.phone as string, type: "phone" });
      case "search_name":
        return this.search.search({ query: args.name as string, type: "name" });
      case "get_parents":
        return this.relationships.getParents(args.id as SyntheticPersonId);
      case "get_children":
        return this.relationships.getChildren(args.id as SyntheticPersonId);
      case "get_siblings":
        return this.relationships.getSiblings(args.id as SyntheticPersonId);
      case "get_extended_family":
        return this.relationships.getExtendedFamily(args.id as SyntheticPersonId);
      case "get_relationships":
        return this.db.relationships.findForPerson(args.id as SyntheticPersonId);
      case "get_sources":
        return this.db.rawRecords.findByPerson(args.id as SyntheticPersonId);
      case "compare_records": {
        const [a, b] = await Promise.all([
          this.db.people.findBySyntheticId(args.idA as SyntheticPersonId),
          this.db.people.findBySyntheticId(args.idB as SyntheticPersonId),
        ]);
        if (!a || !b) return { error: "one or both records not found" };
        return this.entityResolution.compare({ sourceName: "lookup", person: a }, { sourceName: "lookup", person: b });
      }
      case "get_conflicts":
        return this.db.conflicts.findByPerson(args.id as SyntheticPersonId);
    }
  }

  /**
   * Section 40 example, implemented literally: "Find the close family of X"
   * runs the fixed 4-step tool sequence — this is NOT a free-form LLM
   * plan, it's the orchestrator executing the documented playbook.
   * A real LLM would choose among such playbooks; wiring an actual model
   * call requires network access this sandbox doesn't have (see README).
   */
  async findCloseFamily(id: SyntheticPersonId) {
    const person = await this.callTool({ tool: "search_person", args: { id } });
    if (!person) {
      return { answer: "I cannot establish this relationship from the available synthetic data.", person: null };
    }
    const [parents, children, siblings] = await Promise.all([
      this.callTool({ tool: "get_parents", args: { id } }),
      this.callTool({ tool: "get_children", args: { id } }),
      this.callTool({ tool: "get_siblings", args: { id } }),
    ]);
    return { person, parents, children, siblings };
  }
}
