import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { connect } from "@tidbcloud/serverless";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables from .env
const envPath = path.join(__dirname, "../.env");
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, "utf8");
  envContent.split(/\r?\n/).forEach((line) => {
    const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
    if (match) {
      const key = match[1];
      let val = match[2] || "";
      if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
      if (val.startsWith("'") && val.endsWith("'")) val = val.slice(1, -1);
      process.env[key] = val;
    }
  });
}

const host = process.env.TIDB_HOST;
const username = process.env.TIDB_USER;
const password = process.env.TIDB_PASSWORD;
const database = process.env.TIDB_DATABASE;

if (!host || !username || !password || !database) {
  console.error("Error: TiDB database environment variables are not fully configured in .env");
  process.exit(1);
}

const db = connect({ host, username, password, database });

async function run() {
  console.log("Connecting to TiDB Cloud and running migrations...");

  try {
    // 1. Create categories table
    console.log("Creating categories table...");
    await db.execute(`
      CREATE TABLE IF NOT EXISTS categories (
        id CHAR(36) PRIMARY KEY,
        name VARCHAR(100) NOT NULL UNIQUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 2. Check if category_id column already exists in books
    console.log("Checking if category_id column exists on books...");
    const checkCol = await db.execute(`
      SELECT COLUMN_NAME 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'books' AND COLUMN_NAME = 'category_id'
    `, [database]);

    const rows = checkCol?.rows || checkCol || [];
    if (rows.length === 0) {
      console.log("Adding category_id column to books...");
      await db.execute(`
        ALTER TABLE books ADD COLUMN category_id CHAR(36) NULL
      `);
    } else {
      console.log("category_id column already exists, skipping ALTER TABLE.");
    }

    console.log("Migrations ran successfully!");
    process.exit(0);
  } catch (err) {
    console.error("Migration failed:", err);
    process.exit(1);
  }
}

run();
