import { test } from "node:test";
import assert from "node:assert/strict";
import { RateLimiter } from "./rate-limiter.ts";

test("section 43 — rate limiter allows burst up to capacity then blocks", () => {
  const limiter = new RateLimiter(3, 1); // 3 tokens, refill 1/sec
  assert.equal(limiter.tryConsume("user1"), true);
  assert.equal(limiter.tryConsume("user1"), true);
  assert.equal(limiter.tryConsume("user1"), true);
  assert.equal(limiter.tryConsume("user1"), false, "4th immediate request should be blocked");
});

test("rate limiter tracks separate buckets per key", () => {
  const limiter = new RateLimiter(1, 1);
  assert.equal(limiter.tryConsume("userA"), true);
  assert.equal(limiter.tryConsume("userA"), false);
  assert.equal(limiter.tryConsume("userB"), true, "a different key must have its own bucket");
});

test("rate limiter refills over time", async () => {
  const limiter = new RateLimiter(1, 20); // refills fast: 20 tokens/sec
  assert.equal(limiter.tryConsume("userC"), true);
  assert.equal(limiter.tryConsume("userC"), false);
  await new Promise((r) => setTimeout(r, 100)); // 100ms * 20/s = ~2 tokens refilled
  assert.equal(limiter.tryConsume("userC"), true);
});
