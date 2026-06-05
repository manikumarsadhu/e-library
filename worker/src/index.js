import { connect } from "@tidbcloud/serverless";

const BOOK_COLUMNS =
  "id, title, author, year, status, cover_key, file_key, created_at, updated_at";

function getDb(env) {
  if (!env.TIDB_HOST || !env.TIDB_USER || !env.TIDB_PASSWORD || !env.TIDB_DATABASE) {
    throw new Error("TiDB credentials are not configured");
  }
  return connect({
    host: env.TIDB_HOST,
    username: env.TIDB_USER,
    password: env.TIDB_PASSWORD,
    database: env.TIDB_DATABASE,
  });
}

function corsHeaders(env, request) {
  const origin = request.headers.get("Origin");
  const allowed = env.CORS_ORIGIN || "*";
  const allowOrigin =
    allowed === "*" ? "*" : origin === allowed ? origin : allowed;
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
  };
}

function jsonResponse(env, request, data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders(env, request),
    },
  });
}

function errorResponse(env, request, message, status = 400) {
  return jsonResponse(env, request, { error: message }, status);
}

function requireAuth(env, request) {
  const apiKey = env.API_KEY;
  if (!apiKey) return true;
  const auth = request.headers.get("Authorization");
  if (auth === `Bearer ${apiKey}`) return true;
  return false;
}

function getRows(result) {
  if (Array.isArray(result)) return result;
  if (result?.rows) return result.rows;
  return [];
}

function rowToBook(row) {
  return {
    id: row.id,
    title: row.title,
    author: row.author,
    year: row.year,
    status: row.status,
    cover_key: row.cover_key,
    file_key: row.file_key,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

async function listBooks(env, query) {
  const db = getDb(env);
  const q = query.trim();
  if (q) {
    const pattern = `%${q}%`;
    const result = await db.execute(
      `SELECT ${BOOK_COLUMNS} FROM books
       WHERE title LIKE ? OR author LIKE ?
       ORDER BY title ASC`,
      [pattern, pattern]
    );
    return getRows(result).map(rowToBook);
  }
  const result = await db.execute(
    `SELECT ${BOOK_COLUMNS} FROM books ORDER BY title ASC`
  );
  return getRows(result).map(rowToBook);
}

async function getBook(env, id) {
  const db = getDb(env);
  const result = await db.execute(
    `SELECT ${BOOK_COLUMNS} FROM books WHERE id = ? LIMIT 1`,
    [id]
  );
  const row = getRows(result)[0];
  return row ? rowToBook(row) : null;
}

async function createBook(env, body) {
  const { title, author, year, status = "available" } = body;
  if (!title?.trim() || !author?.trim()) {
    throw new Error("title and author are required");
  }
  const id = crypto.randomUUID();
  const db = getDb(env);
  await db.execute(
    `INSERT INTO books (id, title, author, year, status) VALUES (?, ?, ?, ?, ?)`,
    [id, title.trim(), author.trim(), year || null, status]
  );
  return getBook(env, id);
}

async function updateBook(env, id, body) {
  const existing = await getBook(env, id);
  if (!existing) return null;

  const title = body.title !== undefined ? body.title.trim() : existing.title;
  const author = body.author !== undefined ? body.author.trim() : existing.author;
  const year = body.year !== undefined ? body.year : existing.year;
  const status = body.status !== undefined ? body.status : existing.status;

  if (!title || !author) {
    throw new Error("title and author cannot be empty");
  }
  if (status !== "available" && status !== "on_loan") {
    throw new Error("status must be available or on_loan");
  }

  const db = getDb(env);
  await db.execute(
    `UPDATE books SET title = ?, author = ?, year = ?, status = ? WHERE id = ?`,
    [title, author, year || null, status, id]
  );
  return getBook(env, id);
}

async function deleteR2Object(bucket, key) {
  if (key) {
    try {
      await bucket.delete(key);
    } catch {
      /* ignore missing objects */
    }
  }
}

async function deleteBook(env, id, bucket) {
  const existing = await getBook(env, id);
  if (!existing) return false;

  await deleteR2Object(bucket, existing.cover_key);
  await deleteR2Object(bucket, existing.file_key);

  const db = getDb(env);
  await db.execute(`DELETE FROM books WHERE id = ?`, [id]);
  return true;
}

function extensionForType(contentType, fallback) {
  const map = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
    "application/pdf": "pdf",
  };
  return map[contentType] || fallback;
}

async function uploadAsset(env, bookId, request, bucket, kind) {
  const book = await getBook(env, bookId);
  if (!book) return { error: "Book not found", status: 404 };

  const formData = await request.formData();
  const file = formData.get("file");
  if (!file || typeof file === "string") {
    return { error: "file field is required", status: 400 };
  }

  const allowedCovers = ["image/jpeg", "image/png", "image/webp", "image/gif"];
  const allowedFiles = ["application/pdf", ...allowedCovers];

  const allowed = kind === "cover" ? allowedCovers : allowedFiles;
  if (!allowed.includes(file.type)) {
    return {
      error:
        kind === "cover"
          ? "Cover must be JPEG, PNG, WebP, or GIF"
          : "File must be PDF or an image",
      status: 400,
    };
  }

  const ext = extensionForType(file.type, kind === "cover" ? "jpg" : "bin");
  const prefix = kind === "cover" ? "covers" : "files";
  const key = `${prefix}/${bookId}/${crypto.randomUUID()}.${ext}`;

  const oldKey = kind === "cover" ? book.cover_key : book.file_key;
  await bucket.put(key, await file.arrayBuffer(), {
    httpMetadata: { contentType: file.type },
  });
  if (oldKey && oldKey !== key) {
    await deleteR2Object(bucket, oldKey);
  }

  const column = kind === "cover" ? "cover_key" : "file_key";
  const db = getDb(env);
  await db.execute(`UPDATE books SET ${column} = ? WHERE id = ?`, [key, bookId]);

  return { book: await getBook(env, bookId) };
}

async function serveFile(bucket, key) {
  const object = await bucket.get(key);
  if (!object) return null;

  const headers = new Headers();
  if (object.httpMetadata?.contentType) {
    headers.set("Content-Type", object.httpMetadata.contentType);
  }
  headers.set("Cache-Control", "public, max-age=3600");

  return new Response(object.body, { headers });
}

function parsePath(url) {
  const path = new URL(url).pathname.replace(/\/+$/, "") || "/";
  const parts = path.split("/").filter(Boolean);
  return { path, parts };
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(env, request),
      });
    }

    const { parts } = parsePath(request.url);
    const method = request.method;

    try {
      // GET /api/books
      if (method === "GET" && parts[0] === "api" && parts[1] === "books" && parts.length === 2) {
        const url = new URL(request.url);
        const books = await listBooks(env, url.searchParams.get("q") || "");
        return jsonResponse(env, request, { books });
      }

      // GET /api/books/:id
      if (method === "GET" && parts[0] === "api" && parts[1] === "books" && parts.length === 3) {
        const book = await getBook(env, parts[2]);
        if (!book) return errorResponse(env, request, "Book not found", 404);
        return jsonResponse(env, request, { book });
      }

      // GET /api/files/*
      if (method === "GET" && parts[0] === "api" && parts[1] === "files" && parts.length >= 3) {
        const key = parts.slice(2).join("/");
        const fileResponse = await serveFile(env.BOOKS_BUCKET, decodeURIComponent(key));
        if (!fileResponse) return errorResponse(env, request, "File not found", 404);
        const headers = new Headers(fileResponse.headers);
        Object.assign(headers, corsHeaders(env, request));
        return new Response(fileResponse.body, { status: 200, headers });
      }

      const needsAuth =
        method === "POST" || method === "PATCH" || method === "DELETE";
      if (needsAuth && !requireAuth(env, request)) {
        return errorResponse(env, request, "Unauthorized", 401);
      }

      // POST /api/books
      if (method === "POST" && parts[0] === "api" && parts[1] === "books" && parts.length === 2) {
        const body = await request.json();
        const book = await createBook(env, body);
        return jsonResponse(env, request, { book }, 201);
      }

      // PATCH /api/books/:id
      if (method === "PATCH" && parts[0] === "api" && parts[1] === "books" && parts.length === 3) {
        const body = await request.json();
        const book = await updateBook(env, parts[2], body);
        if (!book) return errorResponse(env, request, "Book not found", 404);
        return jsonResponse(env, request, { book });
      }

      // DELETE /api/books/:id
      if (method === "DELETE" && parts[0] === "api" && parts[1] === "books" && parts.length === 3) {
        const deleted = await deleteBook(env, parts[2], env.BOOKS_BUCKET);
        if (!deleted) return errorResponse(env, request, "Book not found", 404);
        return jsonResponse(env, request, { ok: true });
      }

      // POST /api/books/:id/cover
      if (
        method === "POST" &&
        parts[0] === "api" &&
        parts[1] === "books" &&
        parts.length === 4 &&
        parts[3] === "cover"
      ) {
        const result = await uploadAsset(env, parts[2], request, env.BOOKS_BUCKET, "cover");
        if (result.error) return errorResponse(env, request, result.error, result.status);
        return jsonResponse(env, request, { book: result.book });
      }

      // POST /api/books/:id/file
      if (
        method === "POST" &&
        parts[0] === "api" &&
        parts[1] === "books" &&
        parts.length === 4 &&
        parts[3] === "file"
      ) {
        const result = await uploadAsset(env, parts[2], request, env.BOOKS_BUCKET, "file");
        if (result.error) return errorResponse(env, request, result.error, result.status);
        return jsonResponse(env, request, { book: result.book });
      }

      return errorResponse(env, request, "Not found", 404);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Internal server error";
      const status = message.includes("not configured") ? 503 : 500;
      return errorResponse(env, request, message, status);
    }
  },
};
