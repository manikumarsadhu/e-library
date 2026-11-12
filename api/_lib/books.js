import crypto from "crypto";
import { deleteCloudinaryAsset } from "./cloudinary.js";
import { getDb, getRows } from "./db.js";
import { escapeLike } from "./search.js";
import {
  parseGoogleDriveFileId,
  makeGoogleDriveKey,
  hashPasscode,
  verifyPasscode,
} from "./gdrive.js";

const BOOK_COLUMNS =
  "id, title, author, year, cover_key, file_key, outline, category_id, storage_source, visibility, passcode_hash, created_at, updated_at";

export function rowToBook(row) {
  return {
    id: row.id,
    title: row.title,
    author: row.author,
    year: row.year,
    cover_key: row.cover_key,
    file_key: row.file_key,
    outline: row.outline ?? null,
    category_id: row.category_id ?? null,
    storage_source: row.storage_source || "cloudinary",
    visibility: row.visibility || "public",
    has_passcode: Boolean(row.passcode_hash),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function toPublicBook(row, { hasPin = false } = {}) {
  return {
    id: row.id,
    title: row.title,
    author: row.author,
    year: row.year ?? null,
    category_id: row.category_id ?? null,
    has_file: Boolean(row.file_key),
    has_cover: Boolean(row.cover_key || row.file_key),
    is_private: row.visibility === "private",
    can_delete: Boolean(hasPin && row.passcode_hash),
  };
}

export function computePageOffset(page, limit) {
  return (page - 1) * limit;
}

export async function listBooks({ query, page, limit, category_id, passcode, scope, isAdmin }) {
  const db = getDb();
  const q = (query || "").trim();
  const offset = computePageOffset(page, limit);

  const whereClauses = [];
  const params = [];

  if (q) {
    const pattern = `%${escapeLike(q)}%`;
    whereClauses.push(
      `(LOWER(title) LIKE LOWER(?) OR LOWER(author) LIKE LOWER(?) OR CAST(year AS CHAR) LIKE ?)`
    );
    params.push(pattern, pattern, pattern);
  }

  if (category_id) {
    whereClauses.push(`category_id = ?`);
    params.push(category_id);
  }

  // Access control:
  // Admin sees all books.
  // When a visitor enters their passcode/PIN:
  // - Default: Filter directly to their collection (books uploaded with that passcode).
  // - If scope === "all": Include all public books with matching books prioritized first.
  // When no passcode is entered: Show all public books.
  let pinHash = null;
  if (!isAdmin) {
    if (passcode && typeof passcode === "string" && passcode.trim()) {
      pinHash = hashPasscode(passcode);
      if (scope === "all") {
        whereClauses.push(`(visibility = 'public' OR passcode_hash = ?)`);
        params.push(pinHash);
      } else {
        whereClauses.push(`passcode_hash = ?`);
        params.push(pinHash);
      }
    } else {
      whereClauses.push(`visibility = 'public'`);
    }
  }

  const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";

  const countResult = await db.execute(
    `SELECT COUNT(*) AS total FROM books ${whereSql}`,
    params
  );
  const total = Number(getRows(countResult)[0]?.total || 0);

  const orderSql = (scope === "all" && pinHash)
    ? `ORDER BY (passcode_hash = ?) DESC, title ASC`
    : `ORDER BY title ASC`;
  const orderParams = (scope === "all" && pinHash) ? [pinHash] : [];

  const listResult = await db.execute(
    `SELECT ${BOOK_COLUMNS} FROM books ${whereSql} ${orderSql} LIMIT ? OFFSET ?`,
    [...params, ...orderParams, limit, offset]
  );
  const hasPin = Boolean(pinHash);
  const books = getRows(listResult).map((row) =>
    isAdmin ? rowToBook(row) : toPublicBook(row, { hasPin })
  );

  return {
    books,
    total,
    page,
    limit,
    pages: Math.max(1, Math.ceil(total / limit)),
  };
}

export async function getBook(id, { isAdmin = true, hasPin = false } = {}) {
  const db = getDb();
  const result = await db.execute(
    `SELECT ${BOOK_COLUMNS} FROM books WHERE id = ? LIMIT 1`,
    [id]
  );
  const row = getRows(result)[0];
  if (!row) return null;
  return isAdmin ? rowToBook(row) : toPublicBook(row, { hasPin });
}

export async function getBookSecret(id) {
  const db = getDb();
  const result = await db.execute(
    `SELECT id, passcode_hash, storage_source, cover_key, file_key, visibility, outline FROM books WHERE id = ? LIMIT 1`,
    [id]
  );
  return getRows(result)[0] || null;
}

export async function canReadBook(id, { passcode = "", isAdmin = false } = {}) {
  const secret = await getBookSecret(id);
  if (!secret) return { exists: false, allowed: false, secret: null };
  if (isAdmin || secret.visibility !== "private") {
    return { exists: true, allowed: true, secret };
  }
  const allowed = Boolean(
    passcode && secret.passcode_hash && verifyPasscode(passcode, secret.passcode_hash)
  );
  return { exists: true, allowed, secret };
}

export async function hasRegisteredDriveFile(fileId) {
  if (!/^[a-zA-Z0-9_-]{20,60}$/.test(fileId || "")) return false;
  const db = getDb();
  const result = await db.execute(
    `SELECT id FROM books WHERE file_key = ? LIMIT 1`,
    [makeGoogleDriveKey(fileId)]
  );
  return getRows(result).length > 0;
}

export async function createBook(body, { isAdmin = false } = {}) {
  const { title, author, year, category_id, gdrive_url, passcode, visibility } = body || {};
  if (typeof title !== "string" || typeof author !== "string") {
    throw new Error("title and author are required");
  }
  const trimmedTitle = title.trim();
  const trimmedAuthor = author.trim();
  if (!trimmedTitle || !trimmedAuthor) {
    throw new Error("title and author are required");
  }
  if (trimmedTitle.length > 255 || trimmedAuthor.length > 255) {
    throw new Error("title and author must not exceed 255 characters");
  }
  let validYear = null;
  if (year !== undefined && year !== null && year !== "") {
    const numYear = Number(year);
    if (!Number.isInteger(numYear) || numYear < 1000 || numYear > 2100) {
      throw new Error("year must be an integer between 1000 and 2100");
    }
    validYear = numYear;
  }

  let validCategoryId = null;
  if (typeof category_id === "string" && category_id.trim()) {
    validCategoryId = category_id.trim();
  }

  let storageSource = "cloudinary";
  let fileKey = null;
  let passcodeHash = null;
  const bookVisibility = visibility === "private" ? "private" : "public";

  if (gdrive_url) {
    const fileId = parseGoogleDriveFileId(gdrive_url);
    if (!fileId) {
      throw new Error("Invalid Google Drive link. Please paste a valid Google Drive share link or file ID.");
    }
    storageSource = "gdrive";
    fileKey = makeGoogleDriveKey(fileId);

    // Customer uploads require a passcode so they can manage/unlock their books
    if (!isAdmin && (!passcode || typeof passcode !== "string" || passcode.trim().length < 4)) {
      throw new Error("A passcode of at least 4 characters is required to upload your book.");
    }
  }

  if (passcode && typeof passcode === "string" && passcode.trim()) {
    passcodeHash = hashPasscode(passcode);
  }

  const id = crypto.randomUUID();
  const db = getDb();
  await db.execute(
    `INSERT INTO books (id, title, author, year, category_id, storage_source, visibility, passcode_hash, file_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, trimmedTitle, trimmedAuthor, validYear, validCategoryId, storageSource, bookVisibility, passcodeHash, fileKey]
  );
  return getBook(id);
}

export async function updateBook(id, body) {
  const existing = await getBook(id);
  if (!existing) return null;

  let title = existing.title;
  let author = existing.author;
  let year = existing.year;
  let category_id = existing.category_id;

  if (body.title !== undefined) {
    if (typeof body.title !== "string" || !body.title.trim()) {
      throw new Error("title and author cannot be empty");
    }
    title = body.title.trim();
    if (title.length > 255) {
      throw new Error("title and author must not exceed 255 characters");
    }
  }

  if (body.author !== undefined) {
    if (typeof body.author !== "string" || !body.author.trim()) {
      throw new Error("title and author cannot be empty");
    }
    author = body.author.trim();
    if (author.length > 255) {
      throw new Error("title and author must not exceed 255 characters");
    }
  }

  if (body.year !== undefined) {
    if (body.year !== null && body.year !== "") {
      const numYear = Number(body.year);
      if (!Number.isInteger(numYear) || numYear < 1000 || numYear > 2100) {
        throw new Error("year must be an integer between 1000 and 2100");
      }
      year = numYear;
    } else {
      year = null;
    }
  }

  if (body.category_id !== undefined) {
    if (typeof body.category_id === "string" && body.category_id.trim()) {
      category_id = body.category_id.trim();
    } else {
      category_id = null;
    }
  }

  const db = getDb();
  await db.execute(
    `UPDATE books SET title = ?, author = ?, year = ?, category_id = ? WHERE id = ?`,
    [title, author, year, category_id, id]
  );
  return getBook(id);
}

export async function setBookAssetKey(bookId, kind, key) {
  const column = kind === "cover" ? "cover_key" : "file_key";
  const db = getDb();
  await db.execute(`UPDATE books SET ${column} = ? WHERE id = ?`, [key, bookId]);
}

export async function deleteBook(id, { passcode, isAdmin = false } = {}) {
  const secret = await getBookSecret(id);
  if (!secret) return false;

  if (!isAdmin) {
    if (!secret.passcode_hash) {
      throw new Error("Admin authorization required to delete this book");
    }
    if (!verifyPasscode(passcode, secret.passcode_hash)) {
      throw new Error("Incorrect passcode for this book");
    }
  }

  if (secret.storage_source === "cloudinary") {
    await deleteCloudinaryAsset(secret.cover_key);
    await deleteCloudinaryAsset(secret.file_key);
  }

  const db = getDb();
  await db.execute(`DELETE FROM books WHERE id = ?`, [id]);
  return true;
}

export async function getBookOutline(id) {
  const db = getDb();
  const result = await db.execute(
    `SELECT outline FROM books WHERE id = ? LIMIT 1`,
    [id]
  );
  const row = getRows(result)[0];
  if (!row) return null;
  const raw = row.outline;
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function setBookOutline(id, outlineData) {
  const db = getDb();
  const json = JSON.stringify(outlineData);
  await db.execute(
    `UPDATE books SET outline = ? WHERE id = ?`,
    [json, id]
  );
}
