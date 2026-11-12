import { getDb } from "./db.js";

function cloudinaryConfigured() {
  return Boolean(
    process.env.CLOUDINARY_CLOUD_NAME &&
      process.env.CLOUDINARY_API_KEY &&
      process.env.CLOUDINARY_API_SECRET
  );
}

export async function healthCheck() {
  const result = {
    ok: true,
    db: "ok",
    cloudinary: cloudinaryConfigured() ? "configured" : "missing_env",
  };

  try {
    const db = getDb();
    await db.execute("SELECT 1 AS ok");
  } catch {
    result.ok = false;
    result.db = "error";
  }

  return result;
}
