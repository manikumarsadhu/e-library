const buckets = new Map();

export function checkRateLimit({ key, limit, windowMs }) {
  const now = Date.now();
  const windowStart = now - windowMs;
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
