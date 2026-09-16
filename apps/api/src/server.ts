import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { Database } from "@sdl/database";
import { RelationshipEngine } from "@sdl/relationships";
import { SearchService } from "@sdl/search";
import { AiOrchestrator } from "@sdl/ai";
import { RateLimiter } from "@sdl/shared";

/**
 * Minimal HTTP API — a deliberate stand-in for Fastify (section 55), because
 * `fastify` cannot be installed in this sandbox (no npm registry access).
 * Built entirely on node:http so it's real, dependency-free, and actually
 * runs+is tested here. Swapping in real Fastify in a networked environment
 * is a mechanical change: same routes, same service layer underneath.
 *
 * Implements (section 55/56):
 *   GET  /api/people/:id
 *   GET  /api/people/:id/parents|children|siblings|family
 *   POST /api/search
 *   GET  /api/sources
 *   GET  /api/conflicts/:id
 * Plus section 43 security: a bearer-token check and a rate limiter.
 */
export function createApiServer(db: Database, opts: { apiToken?: string } = {}) {
  const relationships = new RelationshipEngine(db.people, db.relationships);
  const search = new SearchService(db.people);
  const ai = new AiOrchestrator(db);
  const limiter = new RateLimiter(50, 10); // 50 burst, refill 10/sec per client

  return createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const start = Date.now();
    try {
      if (opts.apiToken) {
        const auth = req.headers["authorization"];
        if (auth !== `Bearer ${opts.apiToken}`) {
          return sendJson(res, 401, { error: "unauthorized" });
        }
      }

      const clientKey = (req.socket.remoteAddress ?? "unknown") + (req.headers["x-user"] ?? "");
      if (!limiter.tryConsume(clientKey)) {
        return sendJson(res, 429, { error: "rate limited" });
      }

      const url = new URL(req.url ?? "/", "http://localhost");
      const segments = url.pathname.split("/").filter(Boolean);

      let result: unknown;
      let status = 200;

      if (segments[0] === "api" && segments[1] === "people" && segments[2] && !segments[3]) {
        result = await db.people.findBySyntheticId(segments[2]);
        if (!result) status = 404;
      } else if (segments[0] === "api" && segments[1] === "people" && segments[2] && segments[3] === "parents") {
        result = await relationships.getParents(segments[2]);
      } else if (segments[0] === "api" && segments[1] === "people" && segments[2] && segments[3] === "children") {
        result = await relationships.getChildren(segments[2]);
      } else if (segments[0] === "api" && segments[1] === "people" && segments[2] && segments[3] === "siblings") {
        result = await relationships.getSiblings(segments[2]);
      } else if (segments[0] === "api" && segments[1] === "people" && segments[2] && segments[3] === "family") {
        result = await relationships.getExtendedFamily(segments[2]);
      } else if (segments[0] === "api" && segments[1] === "sources" && req.method === "GET") {
        result = await db.sources.list();
      } else if (segments[0] === "api" && segments[1] === "conflicts" && segments[2]) {
        result = await db.conflicts.findByPerson(segments[2]);
      } else if (segments[0] === "api" && segments[1] === "ai" && segments[2] === "close-family" && segments[3]) {
        result = await ai.findCloseFamily(segments[3]);
      } else if (segments[0] === "api" && segments[1] === "search" && req.method === "POST") {
        const body = await readBody(req);
        const parsed = JSON.parse(body || "{}");
        result = await search.search({ query: parsed.query, type: parsed.mode ?? parsed.type });
      } else {
        status = 404;
        result = { error: "not found" };
      }

      await db.auditLogs.record({
        user: (req.headers["x-user"] as string) ?? "anonymous",
        timestamp: new Date().toISOString(),
        action: `${req.method} ${url.pathname}`,
        target: url.pathname,
        result: String(status),
        durationMs: Date.now() - start,
      });

      sendJson(res, status, result);
    } catch (err) {
      sendJson(res, 500, { error: (err as Error).message });
    }
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk: Buffer) => (data += chunk));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}
