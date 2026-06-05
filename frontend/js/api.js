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
  const encoded = key.split("/").map(encodeURIComponent).join("/");
  return `${API_BASE_URL}/api/files/${encoded}`;
}

export async function fetchBooks(query = "") {
  const url = new URL(`${API_BASE_URL}/api/books`);
  if (query.trim()) url.searchParams.set("q", query.trim());
  const res = await fetch(url.toString(), { headers: headers() });
  const data = await parseResponse(res);
  return data.books || [];
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

export async function updateBookStatus(id, status) {
  const res = await fetch(`${API_BASE_URL}/api/books/${id}`, {
    method: "PATCH",
    headers: { ...headers(true), "Content-Type": "application/json" },
    body: JSON.stringify({ status }),
  });
  const data = await parseResponse(res);
  return data.book;
}

export async function deleteBook(id) {
  const res = await fetch(`${API_BASE_URL}/api/books/${id}`, {
    method: "DELETE",
    headers: headers(true),
  });
  return parseResponse(res);
}

export async function uploadCover(bookId, file) {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`${API_BASE_URL}/api/books/${bookId}/cover`, {
    method: "POST",
    headers: headers(true),
    body: form,
  });
  const data = await parseResponse(res);
  return data.book;
}

export async function uploadFile(bookId, file) {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`${API_BASE_URL}/api/books/${bookId}/file`, {
    method: "POST",
    headers: headers(true),
    body: form,
  });
  const data = await parseResponse(res);
  return data.book;
}
