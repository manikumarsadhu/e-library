import { connect } from "@tidbcloud/serverless";
import { v2 as cloudinary } from "cloudinary";
import Busboy from "busboy";
import crypto from "crypto";

function configureCloudinary() {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
  });
}

const BOOK_COLUMNS =
  "id, title, author, year, cover_key, file_key, created_at, updated_at";

function getDb() {
  const host = process.env.TIDB_HOST;
  const username = process.env.TIDB_USER;
  const password = process.env.TIDB_PASSWORD;
  const database = process.env.TIDB_DATABASE;

  if (!host || !username || !password || !database) {
    throw new Error("TiDB credentials are not configured");
  }
  return connect({
    host,
    username,
    password,
    database,
  });
}

function setCorsHeaders(req, res) {
  const allowed = process.env.CORS_ORIGIN || "*";
  const origin = req.headers.origin;
  const allowOrigin = allowed === "*" ? "*" : origin === allowed ? origin : allowed;
  res.setHeader("Access-Control-Allow-Origin", allowOrigin);
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Max-Age", "86400");
}

function requireAuth(req) {
  const apiKey = process.env.API_KEY;
  if (!apiKey) return true; // Matches the worker template (open if no API_KEY set)
  const auth = req.headers.authorization;
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
    cover_key: row.cover_key,
    file_key: row.file_key,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

// Database Operations
async function listBooks(query) {
  const db = getDb();
  const q = (query || "").trim();
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

async function getBook(id) {
  const db = getDb();
  const result = await db.execute(
    `SELECT ${BOOK_COLUMNS} FROM books WHERE id = ? LIMIT 1`,
    [id]
  );
  const row = getRows(result)[0];
  return row ? rowToBook(row) : null;
}

async function createBook(body) {
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

async function updateBook(id, body) {
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

// Cloudinary helpers
function parseCloudinaryKey(key) {
  if (!key) return null;
  if (key.startsWith("cloudinary:")) {
    const parts = key.split(":");
    if (parts.length >= 4) {
      return {
        resource_type: parts[1],
        public_id: parts[2],
        url: parts.slice(3).join(":"),
      };
    }
  }
  return null;
}

function makeCloudinaryKey(resourceType, publicId, url) {
  return `cloudinary:${resourceType}:${publicId}:${url}`;
}

async function deleteCloudinaryAsset(key) {
  const parsed = parseCloudinaryKey(key);
  if (parsed) {
    try {
      configureCloudinary();
      await cloudinary.uploader.destroy(parsed.public_id, {
        resource_type: parsed.resource_type,
      });
    } catch (err) {
      console.error(`Failed to delete Cloudinary asset ${parsed.public_id}:`, err);
    }
  }
}

async function deleteBook(id) {
  const existing = await getBook(id);
  if (!existing) return false;

  // Cleanup Cloudinary uploads
  await deleteCloudinaryAsset(existing.cover_key);
  await deleteCloudinaryAsset(existing.file_key);

  const db = getDb();
  await db.execute(`DELETE FROM books WHERE id = ?`, [id]);
  return true;
}

// Multipart Form Parsing with Busboy
function parseMultipart(req) {
  return new Promise((resolve, reject) => {
    try {
      const busboy = Busboy({ headers: req.headers });
      let fileBuffer = null;
      let mimeType = null;
      let filename = null;
      let fieldName = null;

      busboy.on("file", (name, file, info) => {
        fieldName = name;
        filename = info.filename;
        mimeType = info.mimeType;
        const chunks = [];
        file.on("data", (chunk) => {
          chunks.push(chunk);
        });
        file.on("end", () => {
          fileBuffer = Buffer.concat(chunks);
        });
      });

      busboy.on("finish", () => {
        resolve({ fileBuffer, mimeType, filename, fieldName });
      });

      busboy.on("error", (err) => {
        reject(err);
      });

      req.pipe(busboy);
    } catch (err) {
      reject(err);
    }
  });
}

function uploadToCloudinary(buffer, options) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(options, (error, result) => {
      if (error) return reject(error);
      resolve(result);
    });
    stream.end(buffer);
  });
}

async function uploadAsset(bookId, req, res, kind) {
  const book = await getBook(bookId);
  if (!book) return { error: "Book not found", status: 404 };

  configureCloudinary();

  const contentType = req.headers["content-type"] || "";
  if (!contentType.includes("multipart/form-data")) {
    return { error: "Content-Type must be multipart/form-data", status: 400 };
  }

  let fileBuffer, mimeType;
  try {
    const parsed = await parseMultipart(req);
    fileBuffer = parsed.fileBuffer;
    mimeType = parsed.mimeType;
  } catch (err) {
    return { error: `Failed to parse file: ${err.message}`, status: 400 };
  }

  if (!fileBuffer) {
    return { error: "file field is required", status: 400 };
  }

  const allowedCovers = ["image/jpeg", "image/png", "image/webp", "image/gif"];
  const allowedFiles = ["application/pdf", ...allowedCovers];
  const allowed = kind === "cover" ? allowedCovers : allowedFiles;

  if (!allowed.includes(mimeType)) {
    return {
      error:
        kind === "cover"
          ? "Cover must be JPEG, PNG, WebP, or GIF"
          : "File must be PDF or an image",
      status: 400,
    };
  }

  // Upload configuration
  const customPublicId = `${bookId}_${crypto.randomUUID()}`;
  // Both covers and PDF files are uploaded as "image" in Cloudinary.
  // This allows PDF uploads to bypass Cloudinary's strict 10MB "raw" file size limit on the free tier (images have a 25MB limit).
  const resourceType = "image";

  const options = {
    public_id: customPublicId,
    folder: kind === "cover" ? "e-library/covers" : "e-library/files",
    resource_type: resourceType,
  };


  let uploadResult;
  try {
    uploadResult = await uploadToCloudinary(fileBuffer, options);
  } catch (err) {
    return { error: `Cloudinary upload failed: ${err.message}`, status: 500 };
  }

  const newKey = makeCloudinaryKey(
    uploadResult.resource_type,
    uploadResult.public_id,
    uploadResult.secure_url
  );

  // Store new key and retrieve old key for deletion
  const oldKey = kind === "cover" ? book.cover_key : book.file_key;
  const column = kind === "cover" ? "cover_key" : "file_key";

  const db = getDb();
  await db.execute(`UPDATE books SET ${column} = ? WHERE id = ?`, [newKey, bookId]);

  // Clean up old asset from Cloudinary
  if (oldKey) {
    await deleteCloudinaryAsset(oldKey);
  }

  return { book: await getBook(bookId) };
}

// Vercel Serverless Function Handler
export default async function handler(req, res) {
  setCorsHeaders(req, res);

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  const parsedUrl = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const path = parsedUrl.pathname.replace(/\/+$/, "") || "/";
  const parts = path.split("/").filter(Boolean);
  const method = req.method;

  try {
    // GET /api/books
    if (method === "GET" && parts[0] === "api" && parts[1] === "books" && parts.length === 2) {
      const q = parsedUrl.searchParams.get("q") || "";
      const books = await listBooks(q);
      return res.status(200).json({ books });
    }

    // GET /api/auth
    if (method === "GET" && parts[0] === "api" && parts[1] === "auth" && parts.length === 2) {
      if (requireAuth(req)) {
        return res.status(200).json({ ok: true });
      }
      return res.status(401).json({ error: "Unauthorized" });
    }

    // GET /api/books/:id
    if (method === "GET" && parts[0] === "api" && parts[1] === "books" && parts.length === 3) {
      const book = await getBook(parts[2]);
      if (!book) return res.status(404).json({ error: "Book not found" });
      return res.status(200).json({ book });
    }

    // GET /api/files/:key
    if (method === "GET" && parts[0] === "api" && parts[1] === "files" && parts.length >= 3) {
      const key = parts.slice(2).join("/");
      const decodedKey = decodeURIComponent(key);
      const parsed = parseCloudinaryKey(decodedKey);
      if (!parsed) {
        return res.status(404).json({ error: "File not found or legacy storage" });
      }
      try {
        const response = await fetch(parsed.url);
        if (!response.ok) {
          return res.status(response.status).json({ error: "Failed to fetch file from storage" });
        }
        const contentType = response.headers.get("content-type") || "application/octet-stream";
        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        res.writeHead(200, {
          "Content-Type": contentType,
          "Content-Disposition": "inline",
          "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
        });
        return res.end(buffer);
      } catch (err) {
        console.error("Error proxying file:", err);
        return res.status(500).json({ error: "Internal server error proxying file" });
      }
    }

    // Auth verification for modifying methods
    const needsAuth = method === "POST" || method === "PATCH" || method === "DELETE";
    if (needsAuth && !requireAuth(req)) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    // POST /api/books
    if (method === "POST" && parts[0] === "api" && parts[1] === "books" && parts.length === 2) {
      const book = await createBook(req.body);
      return res.status(201).json({ book });
    }

    // PATCH /api/books/:id
    if (method === "PATCH" && parts[0] === "api" && parts[1] === "books" && parts.length === 3) {
      const book = await updateBook(parts[2], req.body);
      if (!book) return res.status(404).json({ error: "Book not found" });
      return res.status(200).json({ book });
    }

    // DELETE /api/books/:id
    if (method === "DELETE" && parts[0] === "api" && parts[1] === "books" && parts.length === 3) {
      const deleted = await deleteBook(parts[2]);
      if (!deleted) return res.status(404).json({ error: "Book not found" });
      return res.status(200).json({ ok: true });
    }

    // POST /api/books/:id/cover
    if (
      method === "POST" &&
      parts[0] === "api" &&
      parts[1] === "books" &&
      parts.length === 4 &&
      parts[3] === "cover"
    ) {
      const result = await uploadAsset(parts[2], req, res, "cover");
      if (result.error) return res.status(result.status).json({ error: result.error });
      return res.status(200).json({ book: result.book });
    }

    // POST /api/books/:id/file
    if (
      method === "POST" &&
      parts[0] === "api" &&
      parts[1] === "books" &&
      parts.length === 4 &&
      parts[3] === "file"
    ) {
      const result = await uploadAsset(parts[2], req, res, "file");
      if (result.error) return res.status(result.status).json({ error: result.error });
      return res.status(200).json({ book: result.book });
    }

    return res.status(404).json({ error: "Not found" });
  } catch (err) {
    console.error(err);
    const message = err instanceof Error ? err.message : "Internal server error";
    const status = message.includes("not configured") ? 503 : 500;
    return res.status(status).json({ error: message });
  }
}
