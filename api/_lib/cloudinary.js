import crypto from "crypto";
import { v2 as cloudinary } from "cloudinary";

function assertCloudinaryConfigured() {
  if (
    !process.env.CLOUDINARY_CLOUD_NAME ||
    !process.env.CLOUDINARY_API_KEY ||
    !process.env.CLOUDINARY_API_SECRET
  ) {
    throw new Error("Cloudinary is not configured");
  }
}

export function configureCloudinary() {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
  });
}

export function createCloudinaryUploadSignature(bookId, kind) {
  assertCloudinaryConfigured();
  const folder = kind === "cover" ? "e-library/covers" : "e-library/files";
  const public_id = `${bookId}_${crypto.randomUUID()}`;
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = cloudinary.utils.api_sign_request(
    { folder, public_id, timestamp },
    process.env.CLOUDINARY_API_SECRET
  );
  return {
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    timestamp,
    folder,
    public_id,
    signature,
    resource_type: "image",
  };
}

export function parseCloudinaryKey(key) {
  if (!key || !key.startsWith("cloudinary:")) return null;
  const parts = key.split(":");
  if (parts.length < 4) return null;
  return {
    resource_type: parts[1],
    public_id: parts[2],
    url: parts.slice(3).join(":"),
  };
}

export function makeCloudinaryKey(resourceType, publicId, url) {
  return `cloudinary:${resourceType}:${publicId}:${url}`;
}

export async function deleteCloudinaryAsset(key) {
  const parsed = parseCloudinaryKey(key);
  if (!parsed) return;
  try {
    configureCloudinary();
    await cloudinary.uploader.destroy(parsed.public_id, {
      resource_type: parsed.resource_type,
    });
  } catch (err) {
    console.error(`Failed to delete Cloudinary asset ${parsed.public_id}:`, err);
  }
}

export function uploadToCloudinary(buffer, options) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(options, (error, result) => {
      if (error) return reject(error);
      resolve(result);
    });
    stream.end(buffer);
  });
}
