export function setCorsHeaders(req, res) {
  const allowed = process.env.CORS_ORIGIN || "*";
  const origin = req.headers.origin;
  const allowOrigin = allowed === "*" ? "*" : origin === allowed ? origin : allowed;
  res.setHeader("Access-Control-Allow-Origin", allowOrigin);
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Max-Age", "86400");
}

export function requireAuth(req) {
  const apiKey = process.env.API_KEY;
  if (!apiKey) {
    return process.env.NODE_ENV !== "production";
  }
  return req.headers.authorization === `Bearer ${apiKey}`;
}
