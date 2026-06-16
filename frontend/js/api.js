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

export async function fetchBooks(query = "", page = 1, limit = 20) {
  const url = new URL(`${API_BASE_URL}/api/books`);
  if (query.trim()) url.searchParams.set("q", query.trim());
  url.searchParams.set("page", String(page));
  url.searchParams.set("limit", String(limit));
  const res = await fetch(url.toString(), { headers: headers() });
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
