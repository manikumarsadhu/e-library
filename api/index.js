import { requireAuth, setCorsHeaders } from "./lib/auth.js";
import {
  createBook,
  deleteBook,
  getBook,
  listBooks,
  updateBook,
} from "./lib/books.js";
import { readJsonBody } from "./lib/body.js";
import { parseCloudinaryKey } from "./lib/cloudinary.js";
import { uploadAsset } from "./lib/multipart.js";
import { healthCheck } from "./lib/health.js";
import { checkRateLimit } from "./lib/rate-limit.js";

function parsePositiveInt(value, fallback) {
  const num = Number.parseInt(value ?? "", 10);
  return Number.isFinite(num) && num > 0 ? num : fallback;
}

function getClientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (forwarded) return String(forwarded).split(",")[0].trim();
  return req.socket?.remoteAddress || "unknown";
}

function applyRateLimit(req, res, key) {
  const perMin = parsePositiveInt(process.env.RATE_LIMIT_PER_MIN, 0);
  if (!perMin) return false;
  const result = checkRateLimit({
    key: `${getClientIp(req)}:${key}`,
    limit: perMin,
    windowMs: 60_000,
  });
  if (result.allowed) return false;
  res.setHeader("Retry-After", String(result.retryAfterSeconds));
  res.status(429).json({ error: "Too many requests. Please retry shortly." });
  return true;
}

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
    if (method === "GET" && parts[0] === "api" && parts[1] === "health" && parts.length === 2) {
      const result = await healthCheck();
      return res.status(result.ok ? 200 : 503).json(result);
    }

    if (method === "GET" && parts[0] === "api" && parts[1] === "books" && parts.length === 2) {
      if (applyRateLimit(req, res, "books")) return;
      const q = parsedUrl.searchParams.get("q") || "";
      const page = parsePositiveInt(parsedUrl.searchParams.get("page"), 1);
      const limit = Math.min(parsePositiveInt(parsedUrl.searchParams.get("limit"), 20), 100);
      const result = await listBooks({ query: q, page, limit });
      return res.status(200).json(result);
    }

    if (method === "GET" && parts[0] === "api" && parts[1] === "auth" && parts.length === 2) {
      if (requireAuth(req)) {
        return res.status(200).json({ ok: true });
      }
      return res.status(401).json({ error: "Unauthorized" });
    }

    if (method === "GET" && parts[0] === "api" && parts[1] === "books" && parts.length === 3) {
      const book = await getBook(parts[2]);
      if (!book) return res.status(404).json({ error: "Book not found" });
      return res.status(200).json({ book });
    }

    if (method === "GET" && parts[0] === "api" && parts[1] === "files" && parts.length >= 3) {
      if (applyRateLimit(req, res, "files")) return;
      const key = parts.slice(2).join("/");
      const decodedKey = decodeURIComponent(key);
      const parsed = parseCloudinaryKey(decodedKey);
      if (!parsed) {
        return res.status(404).json({ error: "File not found or legacy storage" });
      }
      return res.redirect(302, parsed.url);
    }

    const needsAuth = method === "POST" || method === "PATCH" || method === "DELETE";
    if (needsAuth && !requireAuth(req)) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    if (method === "POST" && parts[0] === "api" && parts[1] === "books" && parts.length === 2) {
      const body = await readJsonBody(req);
      const book = await createBook(body);
      return res.status(201).json({ book });
    }

    if (method === "PATCH" && parts[0] === "api" && parts[1] === "books" && parts.length === 3) {
      const body = await readJsonBody(req);
      const book = await updateBook(parts[2], body);
      if (!book) return res.status(404).json({ error: "Book not found" });
      return res.status(200).json({ book });
    }

    if (method === "DELETE" && parts[0] === "api" && parts[1] === "books" && parts.length === 3) {
      const deleted = await deleteBook(parts[2]);
      if (!deleted) return res.status(404).json({ error: "Book not found" });
      return res.status(200).json({ ok: true });
    }

    if (
      method === "POST" &&
      parts[0] === "api" &&
      parts[1] === "books" &&
      parts.length === 4 &&
      parts[3] === "cover"
    ) {
      const result = await uploadAsset(parts[2], req, "cover");
      if (result.error) return res.status(result.status).json({ error: result.error });
      return res.status(200).json({ book: result.book });
    }

    if (
      method === "POST" &&
      parts[0] === "api" &&
      parts[1] === "books" &&
      parts.length === 4 &&
      parts[3] === "file"
    ) {
      const result = await uploadAsset(parts[2], req, "file");
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
