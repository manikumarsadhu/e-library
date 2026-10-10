import crypto from "crypto";

/**
 * Extracts a Google Drive file ID from a URL, share link, or raw ID.
 * @param {string} input
 * @returns {string|null}
 */
export function parseGoogleDriveFileId(input) {
  if (!input || typeof input !== "string") return null;
  const str = input.trim();

  // Match /d/<id> from any Google URL (drive.google.com/file/d/..., docs.google.com/document/d/..., etc.)
  const matchD = str.match(/\/d\/([a-zA-Z0-9_-]{20,60})/i);
  if (matchD && matchD[1]) {
    return matchD[1];
  }

  // If it's a URL with ?id=<id> or &id=<id>
  const matchIdParam = str.match(/[?&]id=([a-zA-Z0-9_-]{20,60})/i);
  if (matchIdParam && matchIdParam[1]) {
    return matchIdParam[1];
  }

  // Raw file ID (alphanumeric with - and _, typically 20 to 60 chars)
  if (/^[a-zA-Z0-9_-]{20,60}$/.test(str)) {
    return str;
  }

  return null;
}

export function makeGoogleDriveKey(fileId) {
  return `gdrive:${fileId}`;
}

export function parseGoogleDriveKey(key) {
  if (!key || typeof key !== "string" || !key.startsWith("gdrive:")) return null;
  const fileId = key.slice(7).trim();
  if (!fileId) return null;
  return { fileId };
}

export function hashPasscode(passcode) {
  if (!passcode || typeof passcode !== "string") return null;
  const trimmed = passcode.trim();
  if (!trimmed) return null;
  return crypto.createHash("sha256").update(trimmed).digest("hex");
}

export function verifyPasscode(passcode, expectedHash) {
  if (!passcode || !expectedHash) return false;
  const calculatedHash = hashPasscode(passcode);
  if (!calculatedHash) return false;
  const bufA = Buffer.from(calculatedHash, "hex");
  const bufB = Buffer.from(expectedHash, "hex");
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Fetches the Google Drive file stream.
 * Supports direct Drive uploads and Google Docs PDF exports.
 * @param {string} fileId
 */
export async function fetchGoogleDriveFile(fileId) {
  const directUrl = `https://drive.google.com/uc?export=download&id=${encodeURIComponent(fileId)}&confirm=t`;
  const response = await fetch(directUrl, {
    redirect: "follow",
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    },
  });

  let contentType = response.headers.get("content-type") || "";

  // If direct uc download returned HTML, try Google Doc export as PDF
  if (contentType.includes("text/html")) {
    const docExportUrl = `https://docs.google.com/document/d/${encodeURIComponent(fileId)}/export?format=pdf`;
    try {
      const docRes = await fetch(docExportUrl, {
        redirect: "follow",
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        },
      });
      const docType = docRes.headers.get("content-type") || "";
      if (docRes.ok && !docType.includes("text/html")) {
        return docRes;
      }
    } catch {
      // Fall through to error below
    }
  }

  if (!response.ok) {
    throw new Error(`Google Drive returned status ${response.status}. Ensure file is shared to "Anyone with the link".`);
  }

  contentType = response.headers.get("content-type") || "";
  // If Google Drive returns HTML, it's usually a login/permission error page rather than the file
  if (contentType.includes("text/html")) {
    const textSample = await response.text();
    if (textSample.includes("Access denied") || textSample.includes("Sign in") || textSample.includes("accounts.google.com")) {
      throw new Error('Google Drive file is private. Please set sharing permission to "Anyone with the link can view".');
    }
  }

  return response;
}

/**
 * Fetches the document thumbnail (page 1) from Google Drive.
 * @param {string} fileId
 * @param {number} [width=600]
 */
export async function fetchGoogleDriveThumbnail(fileId, width = 600) {
  const thumbUrl = `https://drive.google.com/thumbnail?id=${encodeURIComponent(fileId)}&sz=w${width}`;
  const response = await fetch(thumbUrl, {
    redirect: "follow",
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    },
  });

  if (!response.ok) {
    throw new Error(`Google Drive thumbnail returned status ${response.status}`);
  }

  return response;
}
