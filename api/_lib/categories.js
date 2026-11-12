import crypto from "crypto";
import { getDb, getRows } from "./db.js";

export async function listCategories() {
  const db = getDb();
  const result = await db.execute(
    `SELECT id, name, created_at FROM categories ORDER BY name ASC`
  );
  return getRows(result).map((row) => ({
    id: row.id,
    name: row.name,
    created_at: row.created_at,
  }));
}

export async function getCategory(id) {
  const db = getDb();
  const result = await db.execute(
    `SELECT id, name, created_at FROM categories WHERE id = ? LIMIT 1`,
    [id]
  );
  const row = getRows(result)[0];
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    created_at: row.created_at,
  };
}

export async function createCategory(body) {
  const { name } = body || {};
  if (typeof name !== "string") {
    throw new Error("Category name is required");
  }
  const trimmedName = name.trim();
  if (!trimmedName) {
    throw new Error("Category name cannot be empty");
  }
  if (trimmedName.length > 100) {
    throw new Error("Category name must not exceed 100 characters");
  }

  const id = crypto.randomUUID();
  const db = getDb();
  await db.execute(
    `INSERT INTO categories (id, name) VALUES (?, ?)`,
    [id, trimmedName]
  );
  return getCategory(id);
}

export async function updateCategory(id, body) {
  const { name } = body || {};
  if (typeof name !== "string") {
    throw new Error("Category name is required");
  }
  const trimmedName = name.trim();
  if (!trimmedName) {
    throw new Error("Category name cannot be empty");
  }
  if (trimmedName.length > 100) {
    throw new Error("Category name must not exceed 100 characters");
  }

  const existing = await getCategory(id);
  if (!existing) return null;

  const db = getDb();
  await db.execute(
    `UPDATE categories SET name = ? WHERE id = ?`,
    [trimmedName, id]
  );
  return getCategory(id);
}

export async function deleteCategory(id) {
  const existing = await getCategory(id);
  if (!existing) return false;

  const db = getDb();
  // Standard foreign key check/action is handled if constraint is set,
  // but to be safe, any book pointing to this category_id will be set to NULL.
  // We can do this explicitly to ensure referential integrity.
  await db.execute(
    `UPDATE books SET category_id = NULL WHERE category_id = ?`,
    [id]
  );
  await db.execute(
    `DELETE FROM categories WHERE id = ?`,
    [id]
  );
  return true;
}
