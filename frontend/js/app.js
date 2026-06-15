import {
  fetchBooks,
  createBook,
  deleteBook,
  uploadCover,
  uploadFile,
  fileUrl,
  getApiKey,
  setApiKey,
  validateApiKey,
} from "./api.js";

const bookList = document.getElementById("book-list");
const bookCount = document.getElementById("book-count");
const statusMessage = document.getElementById("status-message");
const searchInput = document.getElementById("search");
const apiKeyInput = document.getElementById("api-key");
const addForm = document.getElementById("add-form");

let allBooks = [];
let searchDebounce = null;

function setStatus(message, type = "") {
  statusMessage.textContent = message;
  statusMessage.className = `status-message${type ? ` ${type}` : ""}`;
}

function createEl(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}

function getPdfThumbnailUrl(fileKey) {
  if (!fileKey) return null;
  if (fileKey.startsWith("cloudinary:")) {
    const parts = fileKey.split(":");
    if (parts.length >= 4) {
      const url = parts.slice(3).join(":");
      // Change extension to jpg and request page 1 (pg_1)
      let thumbUrl = url.replace(/\.pdf$/i, ".jpg");
      thumbUrl = thumbUrl.replace("/upload/", "/upload/pg_1/");
      return thumbUrl;
    }
  }
  return null;
}

function renderCover(book) {
  const wrap = createEl("div", "book-cover");
  if (book.cover_key) {
    const img = document.createElement("img");
    img.src = fileUrl(book.cover_key);
    img.alt = `Cover of ${book.title}`;
    img.loading = "lazy";
    wrap.appendChild(img);
  } else if (book.file_key) {
    const thumbUrl = getPdfThumbnailUrl(book.file_key);
    if (thumbUrl) {
      const img = document.createElement("img");
      img.src = thumbUrl;
      img.alt = `Cover of ${book.title} (auto-generated)`;
      img.loading = "lazy";
      wrap.appendChild(img);
    } else {
      wrap.appendChild(createEl("span", "book-cover-placeholder", "No cover"));
    }
  } else {
    wrap.appendChild(createEl("span", "book-cover-placeholder", "No cover"));
  }
  return wrap;
}

function renderBookCard(book) {
  const card = createEl("article", "book-card");
  card.setAttribute("role", "listitem");
  card.dataset.id = book.id;

  card.appendChild(renderCover(book));

  const body = createEl("div", "book-body");
  body.appendChild(createEl("h3", "book-title", book.title));
  body.appendChild(
    createEl("p", "book-meta", `${book.author}${book.year ? ` · ${book.year}` : ""}`)
  );

  const actions = createEl("div", "book-actions");

  if (book.file_key) {
    const readBtn = createEl("button", "btn btn-ghost", "Read");
    readBtn.type = "button";
    readBtn.dataset.action = "preview";
    actions.appendChild(readBtn);
  }

  const deleteBtn = createEl("button", "btn btn-danger", "Delete");
  deleteBtn.type = "button";
  deleteBtn.dataset.action = "delete";
  actions.appendChild(deleteBtn);

  body.appendChild(actions);
  card.appendChild(body);
  return card;
}

function renderBooks(books) {
  bookList.replaceChildren();
  if (books.length === 0) {
    bookList.appendChild(createEl("p", "empty-state", "No books found."));
  } else {
    books.forEach((book) => bookList.appendChild(renderBookCard(book)));
  }
  const total = allBooks.length;
  const showing = books.length;
  bookCount.textContent =
    total === showing
      ? `${total} book${total === 1 ? "" : "s"}`
      : `Showing ${showing} of ${total} books`;
}

async function loadBooks() {
  setStatus("Loading…");
  try {
    const query = searchInput.value;
    allBooks = await fetchBooks(query);
    renderBooks(allBooks);
    setStatus("");
  } catch (err) {
    setStatus(err.message || "Failed to load books", "error");
    renderBooks([]);
  }
}

bookList.addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-action]");
  if (!btn) return;

  const card = btn.closest(".book-card");
  const id = card?.dataset.id;
  if (!id) return;

  // Read/preview action does NOT require Admin API key auth
  if (btn.dataset.action === "preview") {
    const book = allBooks.find((b) => b.id === id);
    if (book && book.file_key) {
      const viewerUrl = `viewer.html?file=${encodeURIComponent(fileUrl(book.file_key))}&title=${encodeURIComponent(book.title)}`;
      window.open(viewerUrl, "_blank");
    }
    return;
  }

  if (!getApiKey()) {
    setStatus("Enter your admin API key to manage books.", "error");
    apiKeyInput.focus();
    return;
  }

  if (btn.dataset.action === "delete") {
    const book = allBooks.find((b) => b.id === id);
    const label = book ? `"${book.title}"` : "this book";
    if (!confirm(`Delete ${label}? This cannot be undone.`)) return;

    setStatus("Deleting…");
    try {
      await deleteBook(id);
      setStatus("Book deleted.", "success");
      await loadBooks();
    } catch (err) {
      setStatus(err.message, "error");
    }
  }
});

addForm.addEventListener("submit", async (e) => {
  e.preventDefault();

  if (!getApiKey()) {
    setStatus("Enter your admin API key to add books.", "error");
    apiKeyInput.focus();
    return;
  }

  const title = addForm.title.value.trim();
  const author = addForm.author.value.trim();
  const yearVal = addForm.year.value;
  const year = yearVal ? parseInt(yearVal, 10) : null;
  const coverFile = addForm.cover.files[0];
  const pdfFile = addForm.pdf.files[0];

  setStatus("Adding book…");
  try {
    const book = await createBook({ title, author, year });
    if (coverFile) await uploadCover(book.id, coverFile);
    if (pdfFile) await uploadFile(book.id, pdfFile);
    addForm.reset();
    setStatus("Book added.", "success");
    await loadBooks();
  } catch (err) {
    setStatus(err.message, "error");
  }
});

searchInput.addEventListener("input", () => {
  clearTimeout(searchDebounce);
  searchDebounce = setTimeout(loadBooks, 300);
});

let authDebounce = null;

async function updateAdminUI() {
  const key = getApiKey();
  if (!key) {
    document.body.classList.remove("is-admin");
    return;
  }
  const isValid = await validateApiKey(key);
  document.body.classList.toggle("is-admin", isValid);
}

apiKeyInput.addEventListener("input", () => {
  const value = apiKeyInput.value.trim();
  setApiKey(value);
  if (!value) {
    clearTimeout(authDebounce);
    document.body.classList.remove("is-admin");
  } else {
    clearTimeout(authDebounce);
    authDebounce = setTimeout(updateAdminUI, 300);
  }
});

apiKeyInput.value = getApiKey();
updateAdminUI();

loadBooks();
