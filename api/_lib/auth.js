import crypto from "crypto";

export function setCorsHeaders(req, res) {
  const defaultOrigin = process.env.NODE_ENV === "production" ? "https://e-library-beta-ruby.vercel.app" : "*";
  const allowed = process.env.CORS_ORIGIN || defaultOrigin;
  const origin = req.headers.origin;
  const allowOrigin = allowed === "*" ? "*" : origin === allowed ? origin : allowed;
  res.setHeader("Access-Control-Allow-Origin", allowOrigin);
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With, X-Access-Pin");
  res.setHeader("Access-Control-Max-Age", "86400");

  // Security Headers
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
}

function sha256Buffer(value) {
  return crypto.createHash("sha256").update(String(value)).digest();
}

export function requireAuth(req) {
  const apiKey = process.env.API_KEY;
  if (!apiKey) {
    return process.env.NODE_ENV !== "production";
  }
  const authHeader = req.headers.authorization || "";
  if (!authHeader.startsWith("Bearer ")) return false;

  const token = authHeader.slice(7);
  // Hash both sides to avoid leaking API_KEY length via timing
  return crypto.timingSafeEqual(sha256Buffer(token), sha256Buffer(apiKey));
}
