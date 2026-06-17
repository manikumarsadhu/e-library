import test from "node:test";
import assert from "node:assert/strict";
import { computePageOffset, rowToBook } from "../api/lib/books.js";

test("computePageOffset returns stable pagination offset", () => {
  assert.equal(computePageOffset(1, 20), 0);
  assert.equal(computePageOffset(3, 20), 40);
});

test("rowToBook keeps expected API shape", () => {
  const row = {
    id: "1",
    title: "Title",
    author: "Author",
    year: 2020,
    cover_key: "cover",
    file_key: "file",
    outline: null,
    created_at: "now",
    updated_at: "now",
  };
  const mapped = rowToBook(row);
  assert.deepEqual(mapped, row);
});
