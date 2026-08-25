import crypto from "crypto";

export function setCorsHeaders(req, res) {
  const allowed = process.env.CORS_ORIGIN || "*";
  const origin = req.headers.origin;
  const allowOrigin = allowed === "*" ? "*" : origin === allowed ? origin : allowed;
  res.setHeader("Access-Control-Allow-Origin", allowOrigin);
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Max-Age", "86400");

  // Security Headers
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
}

export function requireAuth(req) {
  const apiKey = process.env.API_KEY;
  if (!apiKey) {
    return process.env.NODE_ENV !== "production";
  }
  const authHeader = req.headers.authorization || "";
  if (!authHeader.startsWith("Bearer ")) return false;

  const token = authHeader.slice(7);
  const tokenBuf = Buffer.from(token);
  const keyBuf = Buffer.from(apiKey);

  if (tokenBuf.length !== keyBuf.length) return false;
  return crypto.timingSafeEqual(tokenBuf, keyBuf);
}
