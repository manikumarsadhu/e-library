import test from "node:test";
import assert from "node:assert/strict";
import { v2 as cloudinary } from "cloudinary";
import { computePageOffset, rowToBook } from "../api/_lib/books.js";
import { createCloudinaryUploadSignature } from "../api/_lib/cloudinary.js";
import {
  parseGoogleDriveFileId,
  makeGoogleDriveKey,
  parseGoogleDriveKey,
  hashPasscode,
  verifyPasscode,
} from "../api/_lib/gdrive.js";

test("computePageOffset returns stable pagination offset", () => {
  assert.equal(computePageOffset(1, 20), 0);
  assert.equal(computePageOffset(3, 20), 40);
});

test("rowToBook keeps expected API shape and defaults for storage and visibility", () => {
  const row = {
    id: "1",
    title: "Title",
    author: "Author",
    year: 2020,
    cover_key: "cover",
    file_key: "file",
    outline: null,
    category_id: null,
    storage_source: "gdrive",
    visibility: "private",
    passcode_hash: "abcd",
    created_at: "now",
    updated_at: "now",
  };
  const mapped = rowToBook(row);
  assert.deepEqual(mapped, {
    id: "1",
    title: "Title",
    author: "Author",
    year: 2020,
    cover_key: "cover",
    file_key: "file",
    outline: null,
    category_id: null,
    storage_source: "gdrive",
    visibility: "private",
    has_passcode: true,
    created_at: "now",
    updated_at: "now",
  });
});

test("parseGoogleDriveFileId extracts file ID from multiple Google Drive link formats", () => {
  const standardLink = "https://drive.google.com/file/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs/view?usp=sharing";
  assert.equal(parseGoogleDriveFileId(standardLink), "1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs");

  const openLink = "https://drive.google.com/open?id=1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs";
  assert.equal(parseGoogleDriveFileId(openLink), "1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs");

  const ucLink = "https://drive.google.com/uc?export=download&id=1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs";
  assert.equal(parseGoogleDriveFileId(ucLink), "1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs");

  const rawId = "1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs";
  assert.equal(parseGoogleDriveFileId(rawId), "1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs");

  const docLink = "https://docs.google.com/document/d/1lQZcUi0UVN8V8RqyGm9bl22LiKdr2IB02sem-RDZ2ew/edit?usp=drive_link";
  assert.equal(parseGoogleDriveFileId(docLink), "1lQZcUi0UVN8V8RqyGm9bl22LiKdr2IB02sem-RDZ2ew");

  assert.equal(parseGoogleDriveFileId("invalid-url-here"), null);
});

test("makeGoogleDriveKey and parseGoogleDriveKey round-trip", () => {
  const key = makeGoogleDriveKey("abc123xyz456_def789");
  assert.equal(key, "gdrive:abc123xyz456_def789");
  assert.deepEqual(parseGoogleDriveKey(key), { fileId: "abc123xyz456_def789" });
  assert.equal(parseGoogleDriveKey("cloudinary:foo:bar"), null);
});

test("hashPasscode and verifyPasscode correctly validate user passcodes", () => {
  const hash = hashPasscode("mySecretPin123");
  assert.ok(hash);
  assert.equal(verifyPasscode("mySecretPin123", hash), true);
  assert.equal(verifyPasscode("wrongPin", hash), false);
  assert.equal(verifyPasscode("", hash), false);

  const pinHash = hashPasscode("1234");
  assert.equal(pinHash, "03ac674216f3e15c761ee1a5e255f067953623c8b388b4459e13f978d7c846f4");
  assert.equal(verifyPasscode("1234", pinHash), true);
});

test("createCloudinaryUploadSignature signs direct upload params", () => {
  const prev = {
    name: process.env.CLOUDINARY_CLOUD_NAME,
    key: process.env.CLOUDINARY_API_KEY,
    secret: process.env.CLOUDINARY_API_SECRET,
  };
  process.env.CLOUDINARY_CLOUD_NAME = "demo-cloud";
  process.env.CLOUDINARY_API_KEY = "demo-key";
  process.env.CLOUDINARY_API_SECRET = "demo-secret";

  try {
    const sig = createCloudinaryUploadSignature("book-123", "file");
    assert.equal(sig.cloud_name, "demo-cloud");
    assert.equal(sig.api_key, "demo-key");
    assert.equal(sig.folder, "e-library/files");
    assert.equal(sig.resource_type, "image");
    assert.ok(sig.public_id.startsWith("book-123_"));
    const expected = cloudinary.utils.api_sign_request(
      { folder: sig.folder, public_id: sig.public_id, timestamp: sig.timestamp },
      "demo-secret"
    );
    assert.equal(sig.signature, expected);
  } finally {
    for (const [envKey, val] of [
      ["CLOUDINARY_CLOUD_NAME", prev.name],
      ["CLOUDINARY_API_KEY", prev.key],
      ["CLOUDINARY_API_SECRET", prev.secret],
    ]) {
      if (val === undefined) delete process.env[envKey];
      else process.env[envKey] = val;
    }
  }
});
