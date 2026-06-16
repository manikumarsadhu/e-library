import test from "node:test";
import assert from "node:assert/strict";
import { requireAuth } from "../api/lib/auth.js";

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
