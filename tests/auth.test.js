import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "stream";
import { requireAuth } from "../api/_lib/auth.js";
import { handleChatRoute, verifyAiOrigin } from "../api/_lib/ai.js";
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

test("verifyAiOrigin blocks mismatched origin in production unless admin", () => {
  const oldEnv = process.env.NODE_ENV;
  const oldCors = process.env.CORS_ORIGIN;
  process.env.NODE_ENV = "production";
  process.env.CORS_ORIGIN = "https://e-library-beta-ruby.vercel.app";

  try {
    assert.equal(verifyAiOrigin({ headers: {} }, false), false);
    assert.equal(verifyAiOrigin({ headers: { origin: "https://evil.example" } }, false), false);
    assert.equal(
      verifyAiOrigin({ headers: { origin: "https://e-library-beta-ruby.vercel.app" } }, false),
      true
    );
    assert.equal(verifyAiOrigin({ headers: {} }, true), true);
  } finally {
    if (oldEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = oldEnv;
    if (oldCors === undefined) delete process.env.CORS_ORIGIN;
    else process.env.CORS_ORIGIN = oldCors;
  }
});

test("handleChatRoute rejects requests without bookId", async () => {
  let statusCode = 0;
  let jsonBody = null;
  const req = { headers: {}, body: { prompt: "hi" } };
  const res = {
    status(code) {
      statusCode = code;
      return this;
    },
    json(payload) {
      jsonBody = payload;
      return this;
    },
  };
  await handleChatRoute(req, res);
  assert.equal(statusCode, 400);
  assert.equal(jsonBody?.error, "bookId is required");
});
