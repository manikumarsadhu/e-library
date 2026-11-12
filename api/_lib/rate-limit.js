const buckets = new Map();

export function getClientIp(req) {
  const realIp = req.headers?.["x-real-ip"] || req.headers?.["x-vercel-forwarded-for"];
  if (realIp) return String(realIp).split(",")[0].trim();
  const forwarded = req.headers?.["x-forwarded-for"];
  if (forwarded) return String(forwarded).split(",")[0].trim();
  return req.socket?.remoteAddress || "unknown";
}

export function checkRateLimit({ key, limit, windowMs }) {
  const now = Date.now();
  const windowStart = now - windowMs;
  if (buckets.size > 1000) {
    for (const [k, list] of buckets.entries()) {
      const fresh = list.filter((ts) => ts > windowStart);
      if (fresh.length === 0) buckets.delete(k);
      else buckets.set(k, fresh);
    }
  }
  const entries = (buckets.get(key) || []).filter((ts) => ts > windowStart);

  if (entries.length >= limit) {
    const oldest = entries[0];
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((oldest + windowMs - now) / 1000)
    );
    buckets.set(key, entries);
    return { allowed: false, retryAfterSeconds };
  }

  entries.push(now);
  buckets.set(key, entries);
  return { allowed: true, retryAfterSeconds: 0 };
}
