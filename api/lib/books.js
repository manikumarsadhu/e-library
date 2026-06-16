import crypto from "crypto";
import { deleteCloudinaryAsset } from "./cloudinary.js";
import { getDb, getRows } from "./db.js";
import { escapeLike } from "./search.js";

const BOOK_COLUMNS =
  "id, title, author, year, cover_key, file_key, created_at, updated_at";

export function rowToBook(row) {
  return {
    id: row.id,
    title: row.title,
    author: row.author,
    year: row.year,
    cover_key: row.cover_key,
    file_key: row.file_key,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function computePageOffset(page, limit) {
  return (page - 1) * limit;
}

export async function listBooks({ query, page, limit }) {
  const db = getDb();
  const q = (query || "").trim();
  const offset = computePageOffset(page, limit);

  if (q) {
    const pattern = `%${escapeLike(q)}%`;
    const countResult = await db.execute(
      `SELECT COUNT(*) AS total FROM books
       WHERE LOWER(title) LIKE LOWER(?)
          OR LOWER(author) LIKE LOWER(?)
          OR CAST(year AS CHAR) LIKE ?`,
      [pattern, pattern, pattern]
    );
    const total = Number(getRows(countResult)[0]?.total || 0);
    const listResult = await db.execute(
      `SELECT ${BOOK_COLUMNS} FROM books
       WHERE LOWER(title) LIKE LOWER(?)
          OR LOWER(author) LIKE LOWER(?)
          OR CAST(year AS CHAR) LIKE ?
       ORDER BY title ASC
       LIMIT ? OFFSET ?`,
      [pattern, pattern, pattern, limit, offset]
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

  const countResult = await db.execute(`SELECT COUNT(*) AS total FROM books`);
  const total = Number(getRows(countResult)[0]?.total || 0);
  const listResult = await db.execute(
    `SELECT ${BOOK_COLUMNS} FROM books
     ORDER BY title ASC
     LIMIT ? OFFSET ?`,
    [limit, offset]
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
  const { title, author, year } = body || {};
  if (!title?.trim() || !author?.trim()) {
    throw new Error("title and author are required");
  }
  const id = crypto.randomUUID();
  const db = getDb();
  await db.execute(
    `INSERT INTO books (id, title, author, year) VALUES (?, ?, ?, ?)`,
    [id, title.trim(), author.trim(), year || null]
  );
  return getBook(id);
}

export async function updateBook(id, body) {
  const existing = await getBook(id);
  if (!existing) return null;

  const title = body.title !== undefined ? body.title.trim() : existing.title;
  const author = body.author !== undefined ? body.author.trim() : existing.author;
  const year = body.year !== undefined ? body.year : existing.year;

  if (!title || !author) {
    throw new Error("title and author cannot be empty");
  }

  const db = getDb();
  await db.execute(
    `UPDATE books SET title = ?, author = ?, year = ? WHERE id = ?`,
    [title, author, year || null, id]
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
