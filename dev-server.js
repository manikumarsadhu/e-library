import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import handler from "./api/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 1. Load .env file manually
try {
  const envPath = path.join(__dirname, ".env");
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
} catch (err) {
  console.error("Failed to load .env file:", err);
}

const PORT = process.env.PORT || 3000;
const FRONTEND_DIR = path.join(__dirname, "frontend");

const MIME_TYPES = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "application/javascript",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

const server = http.createServer((req, res) => {
  // Add Vercel response helper mocks
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (data) => {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(data));
    return res;
  };
  res.redirect = (statusCode, url) => {
    let code = 302;
    let targetUrl = url;
    if (typeof statusCode === "string") {
      targetUrl = statusCode;
      code = 302;
    } else if (typeof statusCode === "number") {
      code = statusCode;
    }
    res.writeHead(code, { Location: targetUrl });
    res.end();
    return res;
  };

  // Safely handle client disconnects on req, res, and socket
  req.on("error", (err) => {
    if (err.code !== "ECONNRESET") console.warn("Client req error:", err.message);
  });
  res.on("error", (err) => {
    if (err.code !== "ECONNRESET" && err.code !== "EPIPE") console.warn("Client res error:", err.message);
  });
  req.socket?.on("error", (err) => {
    if (err.code !== "ECONNRESET" && err.code !== "EPIPE") console.warn("Client socket error:", err.message);
  });

  const parsedUrl = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const pathname = parsedUrl.pathname;

  // Route API requests to our serverless function handler
  if (pathname.startsWith("/api/")) {
    const contentType = req.headers["content-type"] || "";
    // Pre-parse application/json bodies for POST/PATCH
    if (contentType.includes("application/json") && (req.method === "POST" || req.method === "PATCH")) {
      let body = "";
      req.on("data", (chunk) => {
        body += chunk;
      });
      req.on("end", () => {
        try {
          req.body = body ? JSON.parse(body) : {};
        // eslint-disable-next-line no-unused-vars
        } catch (_err) {
          req.body = {};
        }
        Promise.resolve(handler(req, res)).catch((err) => {
          if (!res.destroyed && !res.writableEnded) {
            res.statusCode = 500;
            res.end(JSON.stringify({ error: err?.message || "Internal server error" }));
          }
        });
      });
    } else {
      // Direct pass for GET, DELETE, and multipart/form-data POST (parsed via busboy)
      Promise.resolve(handler(req, res)).catch((err) => {
        if (!res.destroyed && !res.writableEnded) {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: err?.message || "Internal server error" }));
        }
      });
    }
  } else {
    // Serve static files from the frontend folder
    let filePath = path.join(FRONTEND_DIR, pathname === "/" ? "index.html" : pathname);

    if (!filePath.startsWith(FRONTEND_DIR)) {
      res.statusCode = 403;
      res.end("Forbidden");
      return;
    }

    fs.stat(filePath, (err, stats) => {
      if (err || !stats.isFile()) {
        filePath = path.join(FRONTEND_DIR, "index.html");
      }

      const ext = path.extname(filePath).toLowerCase();
      const contentType = MIME_TYPES[ext] || "application/octet-stream";

      if (res.destroyed || res.writableEnded) return;

      res.writeHead(200, { "Content-Type": contentType });
      const stream = fs.createReadStream(filePath);
      stream.on("error", () => {
        if (!res.destroyed && !res.headersSent) {
          res.writeHead(500, { "Content-Type": "text/plain" });
          res.end("Internal Server Error");
        }
      });
      res.on("close", () => {
        stream.destroy();
      });
      stream.pipe(res);
    });
  }
});

server.on("error", (err) => {
  console.error("Server error:", err);
});

process.on("uncaughtException", (err) => {
  if (err?.code === "ECONNRESET" || err?.code === "EPIPE" || err?.code === "ERR_STREAM_PREMATURE_CLOSE") {
    return; // Normal browser navigation disconnect (e.g. user pressed Back or refreshed)
  }
  console.error("Uncaught exception in dev server:", err);
});

process.on("unhandledRejection", (err) => {
  if (err?.code === "ECONNRESET" || err?.code === "EPIPE" || err?.code === "ERR_STREAM_PREMATURE_CLOSE") {
    return;
  }
  console.error("Unhandled rejection in dev server:", err);
});

server.listen(PORT, () => {
  console.log(`Local development server running at http://localhost:${PORT}`);
});
