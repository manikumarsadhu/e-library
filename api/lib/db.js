import { connect } from "@tidbcloud/serverless";

export function getDb() {
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

export function getRows(result) {
  if (Array.isArray(result)) return result;
  if (result?.rows) return result.rows;
  return [];
}
