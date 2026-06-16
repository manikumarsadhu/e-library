import Busboy from "busboy";
import crypto from "crypto";
import {
  configureCloudinary,
  deleteCloudinaryAsset,
  makeCloudinaryKey,
  uploadToCloudinary,
} from "./cloudinary.js";
import { getBook, setBookAssetKey } from "./books.js";

function parseMultipart(req) {
  return new Promise((resolve, reject) => {
    try {
      const busboy = Busboy({ headers: req.headers });
      let fileBuffer = null;
      let mimeType = null;

      busboy.on("file", (_name, file, info) => {
        mimeType = info.mimeType;
        const chunks = [];
        file.on("data", (chunk) => chunks.push(chunk));
        file.on("end", () => {
          fileBuffer = Buffer.concat(chunks);
        });
      });

      busboy.on("finish", () => resolve({ fileBuffer, mimeType }));
      busboy.on("error", reject);
      req.pipe(busboy);
    } catch (err) {
      reject(err);
    }
  });
}

export async function uploadAsset(bookId, req, kind) {
  const book = await getBook(bookId);
  if (!book) return { error: "Book not found", status: 404 };

  configureCloudinary();
  const contentType = req.headers["content-type"] || "";
  if (!contentType.includes("multipart/form-data")) {
    return { error: "Content-Type must be multipart/form-data", status: 400 };
  }

  let fileBuffer;
  let mimeType;
  try {
    const parsed = await parseMultipart(req);
    fileBuffer = parsed.fileBuffer;
    mimeType = parsed.mimeType;
  } catch (err) {
    return { error: `Failed to parse file: ${err.message}`, status: 400 };
  }

  if (!fileBuffer) return { error: "file field is required", status: 400 };

  const allowedCovers = ["image/jpeg", "image/png", "image/webp", "image/gif"];
  const allowedFiles = ["application/pdf", ...allowedCovers];
  const allowed = kind === "cover" ? allowedCovers : allowedFiles;

  if (!allowed.includes(mimeType)) {
    return {
      error:
        kind === "cover"
          ? "Cover must be JPEG, PNG, WebP, or GIF"
          : "File must be PDF or an image",
      status: 400,
    };
  }

  const options = {
    public_id: `${bookId}_${crypto.randomUUID()}`,
    folder: kind === "cover" ? "e-library/covers" : "e-library/files",
    resource_type: "image",
  };

  let uploadResult;
  try {
    uploadResult = await uploadToCloudinary(fileBuffer, options);
  } catch (err) {
    return { error: `Cloudinary upload failed: ${err.message}`, status: 500 };
  }

  const newKey = makeCloudinaryKey(
    uploadResult.resource_type,
    uploadResult.public_id,
    uploadResult.secure_url
  );
  const oldKey = kind === "cover" ? book.cover_key : book.file_key;
  await setBookAssetKey(bookId, kind, newKey);
  if (oldKey) await deleteCloudinaryAsset(oldKey);

  return { book: await getBook(bookId) };
}
