import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "stream";
import { requireAuth } from "../api/_lib/auth.js";
import { readJsonBody } from "../api/_lib/body.js";
import { checkRateLimit } from "../api/_lib/rate-limit.js";

test("allows unauthenticated access in non-production when API_KEY missing", () => {
  const oldNodeEnv = process.env.NODE_ENV;
  const oldApiKey = process.env.API_KEY;
  process.env.NODE_ENV = "development";
  delete process.env.API_KEY;

  assert.equal(requireAuth({ headers: {} }), true);

  process.env.NODE_ENV = oldNodeEnv;
  process.env.API_KEY = oldApiKey;
});

test("requires auth in production when API_KEY missing", () => {
  const oldNodeEnv = process.env.NODE_ENV;
  const oldApiKey = process.env.API_KEY;
  process.env.NODE_ENV = "production";
  delete process.env.API_KEY;

  assert.equal(requireAuth({ headers: {} }), false);

  process.env.NODE_ENV = oldNodeEnv;
  process.env.API_KEY = oldApiKey;
});

test("validates bearer token when API_KEY is configured", () => {
  const oldApiKey = process.env.API_KEY;
  process.env.API_KEY = "top-secret";

  assert.equal(
    requireAuth({ headers: { authorization: "Bearer top-secret" } }),
    true
  );
  assert.equal(requireAuth({ headers: { authorization: "Bearer nope" } }), false);

  process.env.API_KEY = oldApiKey;
});

test("readJsonBody rejects payloads larger than 1 MB", async () => {
  const bigStream = Readable.from([Buffer.alloc(1024 * 1024 + 1, "a")]);
  await assert.rejects(() => readJsonBody(bigStream), /Request body too large/);
});

test("checkRateLimit blocks requests exceeding limit", () => {
  const key = `test-${Date.now()}`;
  assert.equal(checkRateLimit({ key, limit: 2, windowMs: 60_000 }).allowed, true);
  assert.equal(checkRateLimit({ key, limit: 2, windowMs: 60_000 }).allowed, true);
  const blocked = checkRateLimit({ key, limit: 2, windowMs: 60_000 });
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.retryAfterSeconds >= 1);
});
