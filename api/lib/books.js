import crypto from "crypto";
import { deleteCloudinaryAsset } from "./cloudinary.js";
import { getDb, getRows } from "./db.js";
import { escapeLike } from "./search.js";

const BOOK_COLUMNS =
  "id, title, author, year, cover_key, file_key, outline, category_id, created_at, updated_at";

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
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function computePageOffset(page, limit) {
  return (page - 1) * limit;
}

export async function listBooks({ query, page, limit, category_id }) {
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

  const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";

  const countResult = await db.execute(
    `SELECT COUNT(*) AS total FROM books ${whereSql}`,
    params
  );
  const total = Number(getRows(countResult)[0]?.total || 0);

  const listResult = await db.execute(
    `SELECT ${BOOK_COLUMNS} FROM books ${whereSql} ORDER BY title ASC LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  const books = getRows(listResult).map(rowToBook);

  return {
    books,
    total,
    page,
    limit,
    pages: Math.max(1, Math.ceil(total / limit)),
  };
}

export async function getBook(id) {
  const db = getDb();
  const result = await db.execute(
    `SELECT ${BOOK_COLUMNS} FROM books WHERE id = ? LIMIT 1`,
    [id]
  );
  const row = getRows(result)[0];
  return row ? rowToBook(row) : null;
}

export async function createBook(body) {
  const { title, author, year, category_id } = body || {};
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

  const id = crypto.randomUUID();
  const db = getDb();
  await db.execute(
    `INSERT INTO books (id, title, author, year, category_id) VALUES (?, ?, ?, ?, ?)`,
    [id, trimmedTitle, trimmedAuthor, validYear, validCategoryId]
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

export async function deleteBook(id) {
  const existing = await getBook(id);
  if (!existing) return false;

  await deleteCloudinaryAsset(existing.cover_key);
  await deleteCloudinaryAsset(existing.file_key);

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
