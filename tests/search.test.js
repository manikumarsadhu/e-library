import test from "node:test";
import assert from "node:assert/strict";
import { escapeLike } from "../api/lib/search.js";

test("escapeLike escapes SQL LIKE wildcards and backslashes", () => {
  assert.equal(escapeLike("100%_match\\path"), "100\\%\\_match\\\\path");
});
