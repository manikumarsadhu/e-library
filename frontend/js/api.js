import { API_BASE_URL } from "./config.js";

const API_KEY_STORAGE = "elibrary_api_key";

export function getApiKey() {
  return sessionStorage.getItem(API_KEY_STORAGE) || "";
}

export function setApiKey(key) {
  if (key) {
    sessionStorage.setItem(API_KEY_STORAGE, key);
  } else {
    sessionStorage.removeItem(API_KEY_STORAGE);
  }
}

function headers(includeAuth = false) {
  const h = { Accept: "application/json" };
  if (includeAuth) {
    const key = getApiKey();
    if (key) h.Authorization = `Bearer ${key}`;
  }
  return h;
}

async function parseResponse(res) {
  const text = await res.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { error: text };
    }
  }
  if (!res.ok) {
    const message = data?.error || res.statusText || "Request failed";
    throw new Error(message);
  }
  return data;
}

export function fileUrl(key) {
  if (!key) return null;
  return `${API_BASE_URL}/api/files/${encodeURIComponent(key)}`;
}

export async function validateApiKey(key) {
  if (!key) return false;
  try {
    const res = await fetch(`${API_BASE_URL}/api/auth`, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${key}`,
      },
    });
    return res.status === 200;
  } catch {
    return false;
  }
}

export async function verifyAdminTrigger(trigger) {
  if (!trigger) return false;
  try {
    const res = await fetch(`${API_BASE_URL}/api/auth/trigger`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ trigger }),
    });
    if (!res.ok) return false;
    const data = await res.json();
    return Boolean(data.unlocked);
  } catch {
    return false;
  }
}

const USER_PIN_STORAGE = "elibrary_user_pin";

export function getUserPin() {
  return sessionStorage.getItem(USER_PIN_STORAGE) || "";
}

export function setUserPin(pin) {
  if (pin) {
    sessionStorage.setItem(USER_PIN_STORAGE, pin.trim());
  } else {
    sessionStorage.removeItem(USER_PIN_STORAGE);
  }
}

export async function fetchBooks(query = "", page = 1, limit = 20, category_id = "", pin = "") {
  const url = new URL(`${API_BASE_URL}/api/books`);
  if (query.trim()) url.searchParams.set("q", query.trim());
  url.searchParams.set("page", String(page));
  url.searchParams.set("limit", String(limit));
  if (category_id) url.searchParams.set("category_id", category_id);
  const activePin = pin || getUserPin();
  if (activePin) url.searchParams.set("pin", activePin);
  const res = await fetch(url.toString(), { headers: headers(true) });
  const data = await parseResponse(res);
  return {
    books: data.books || [],
    total: Number(data.total || 0),
    page: Number(data.page || page),
    limit: Number(data.limit || limit),
    pages: Number(data.pages || 1),
  };
}

export async function createBook(payload) {
  const res = await fetch(`${API_BASE_URL}/api/books`, {
    method: "POST",
    headers: { ...headers(true), "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await parseResponse(res);
  return data.book;
}

export async function updateBook(id, payload) {
  const res = await fetch(`${API_BASE_URL}/api/books/${id}`, {
    method: "PATCH",
    headers: { ...headers(true), "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await parseResponse(res);
  return data.book;
}

export async function deleteBook(id, pin = "") {
  const h = headers(true);
  const activePin = pin || getUserPin();
  if (activePin) {
    h["x-access-pin"] = activePin;
  }
  const url = new URL(`${API_BASE_URL}/api/books/${id}`);
  if (activePin) {
    url.searchParams.set("pin", activePin);
  }
  const res = await fetch(url.toString(), {
    method: "DELETE",
    headers: h,
  });
  return parseResponse(res);
}

const MAX_COVER_SIZE = 5 * 1024 * 1024;
const MAX_FILE_SIZE = 25 * 1024 * 1024;
const ALLOWED_COVER_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

async function uploadAsset(bookId, kind, file) {
  const maxSize = kind === "cover" ? MAX_COVER_SIZE : MAX_FILE_SIZE;
  if (file.size > maxSize) {
    throw new Error(`File size exceeds maximum allowed limit of ${maxSize / (1024 * 1024)} MB`);
  }
  const isAllowedCover = ALLOWED_COVER_TYPES.has(file.type);
  const isPdf = file.type === "application/pdf" || (!file.type && /\.pdf$/i.test(file.name));
  if (kind === "cover" && !isAllowedCover) {
    throw new Error("Cover must be JPEG, PNG, WebP, or GIF");
  }
  if (kind === "file" && !isPdf && !isAllowedCover) {
    throw new Error("File must be PDF or an image");
  }

  // Upload directly to Cloudinary from the browser to bypass Vercel's 4.5 MB function body limit
  const sigRes = await fetch(`${API_BASE_URL}/api/books/${bookId}/upload-signature`, {
    method: "POST",
    headers: { ...headers(true), "Content-Type": "application/json" },
    body: JSON.stringify({ kind }),
  });
  const sig = await parseResponse(sigRes);

  const form = new FormData();
  form.append("file", file);
  form.append("api_key", sig.api_key);
  form.append("timestamp", String(sig.timestamp));
  form.append("folder", sig.folder);
  form.append("public_id", sig.public_id);
  form.append("signature", sig.signature);

  const cloudRes = await fetch(
    `https://api.cloudinary.com/v1_1/${encodeURIComponent(sig.cloud_name)}/${sig.resource_type}/upload`,
    { method: "POST", body: form }
  );
  const cloudData = await cloudRes.json().catch(() => null);
  if (!cloudRes.ok) {
    throw new Error(cloudData?.error?.message || "Cloudinary upload failed");
  }

  const saveRes = await fetch(`${API_BASE_URL}/api/books/${bookId}/${kind}`, {
    method: "POST",
    headers: { ...headers(true), "Content-Type": "application/json" },
    body: JSON.stringify({
      public_id: cloudData.public_id,
      secure_url: cloudData.secure_url,
      resource_type: cloudData.resource_type || sig.resource_type,
    }),
  });
  const data = await parseResponse(saveRes);
  return data.book;
}

export function uploadCover(bookId, file) {
  return uploadAsset(bookId, "cover", file);
}

export function uploadFile(bookId, file) {
  return uploadAsset(bookId, "file", file);
}

export async function fetchCategories() {
  const res = await fetch(`${API_BASE_URL}/api/categories`, { headers: headers() });
  const data = await parseResponse(res);
  return data.categories || [];
}

export async function createCategory(payload) {
  const res = await fetch(`${API_BASE_URL}/api/categories`, {
    method: "POST",
    headers: { ...headers(true), "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await parseResponse(res);
  return data.category;
}

export async function updateCategory(id, payload) {
  const res = await fetch(`${API_BASE_URL}/api/categories/${id}`, {
    method: "PATCH",
    headers: { ...headers(true), "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await parseResponse(res);
  return data.category;
}

export async function deleteCategory(id) {
  const res = await fetch(`${API_BASE_URL}/api/categories/${id}`, {
    method: "DELETE",
    headers: headers(true),
  });
  return parseResponse(res);
}
