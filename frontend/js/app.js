import {
  fetchBooks,
  createBook,
  updateBook,
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
const apiKeyError = document.getElementById("api-key-error");
const footerYear = document.getElementById("footer-year");
const addForm = document.getElementById("add-form");
const pager = document.getElementById("pager");
const retryLoadBtn = document.getElementById("retry-load");
const prevPageBtn = document.getElementById("prev-page");
const nextPageBtn = document.getElementById("next-page");
const pageLabel = document.getElementById("page-label");
const editModal = document.getElementById("edit-modal");
const editForm = document.getElementById("edit-form");
const editCancelBtn = document.getElementById("edit-cancel");
const editIdInput = document.getElementById("edit-id");
const editTitleInput = document.getElementById("edit-title");
const editAuthorInput = document.getElementById("edit-author");
const editYearInput = document.getElementById("edit-year");
const editCoverInput = document.getElementById("edit-cover");
const editPdfInput = document.getElementById("edit-pdf");

let allBooks = [];
let searchDebounce = null;
let currentPage = 1;
const pageSize = 20;
let totalPages = 1;
let lastFocusEl = null;
const supportsDialog = typeof editModal.showModal === "function";

function setStatus(message, type = "") {
  statusMessage.textContent = message;
  statusMessage.className = `status-message${type ? ` ${type}` : ""}`;
  retryLoadBtn.hidden = type !== "error";
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

  const editBtn = createEl("button", "btn btn-secondary", "Edit");
  editBtn.type = "button";
  editBtn.dataset.action = "edit";
  actions.appendChild(editBtn);

  const deleteBtn = createEl("button", "btn btn-danger", "Delete");
  deleteBtn.type = "button";
  deleteBtn.dataset.action = "delete";
  actions.appendChild(deleteBtn);

  body.appendChild(actions);
  card.appendChild(body);
  return card;
}

function renderBooks(books, total) {
  bookList.replaceChildren();
  if (books.length === 0) {
    bookList.appendChild(createEl("p", "empty-state", "No books found."));
  } else {
    books.forEach((book) => bookList.appendChild(renderBookCard(book)));
  }
  const showing = books.length;
  bookCount.textContent = `Page ${currentPage} of ${totalPages} (${total} total, ${showing} shown)`;
  pageLabel.textContent = `Page ${currentPage}`;
  prevPageBtn.disabled = currentPage <= 1;
  nextPageBtn.disabled = currentPage >= totalPages;
  pager.hidden = totalPages <= 1;
}

function setApiKeyError(message) {
  apiKeyError.textContent = message;
  const hasError = Boolean(message);
  apiKeyInput.setAttribute("aria-invalid", hasError ? "true" : "false");
}

function getCurrentBook(id) {
  return allBooks.find((b) => b.id === id);
}

function openEditModal(book) {
  if (!book) return;
  lastFocusEl = document.activeElement;
  editIdInput.value = book.id;
  editTitleInput.value = book.title || "";
  editAuthorInput.value = book.author || "";
  editYearInput.value = book.year || "";
  editCoverInput.value = "";
  editPdfInput.value = "";
  document.body.classList.add("modal-open");
  if (supportsDialog) {
    editModal.showModal();
  } else {
    editModal.setAttribute("open", "");
    editModal.classList.add("fallback-open");
  }
  editTitleInput.focus();
}

function closeEditModal() {
  if (supportsDialog) {
    editModal.close();
  } else {
    editModal.removeAttribute("open");
    editModal.classList.remove("fallback-open");
  }
  document.body.classList.remove("modal-open");
  if (lastFocusEl && typeof lastFocusEl.focus === "function") {
    lastFocusEl.focus();
  }
}

async function loadBooks() {
  setStatus("Loading…");
  try {
    const query = searchInput.value;
    const response = await fetchBooks(query, currentPage, pageSize);
    if (currentPage > response.pages) {
      currentPage = response.pages;
      return loadBooks();
    }
    allBooks = response.books;
    totalPages = response.pages;
    renderBooks(allBooks, response.total);
    setStatus("");
  } catch (err) {
    setStatus(err.message || "Failed to load books", "error");
    allBooks = [];
    totalPages = 1;
    renderBooks([], 0);
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

  if (btn.dataset.action === "edit") {
    openEditModal(getCurrentBook(id));
    return;
  }

  if (btn.dataset.action === "delete") {
    const book = getCurrentBook(id);
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
    try {
      if (coverFile) await uploadCover(book.id, coverFile);
      if (pdfFile) await uploadFile(book.id, pdfFile);
    } catch (uploadErr) {
      await deleteBook(book.id).catch(() => {});
      throw new Error(`Upload failed — book was not saved. ${uploadErr.message}`);
    }
    addForm.reset();
    setStatus("Book added.", "success");
    currentPage = 1;
    await loadBooks();
  } catch (err) {
    setStatus(err.message, "error");
  }
});

searchInput.addEventListener("input", () => {
  clearTimeout(searchDebounce);
  searchDebounce = setTimeout(() => {
    currentPage = 1;
    loadBooks();
  }, 300);
});

let authDebounce = null;

async function updateAdminUI() {
  const key = getApiKey();
  if (!key) {
    document.body.classList.remove("is-admin");
    setApiKeyError("");
    return;
  }
  const isValid = await validateApiKey(key);
  document.body.classList.toggle("is-admin", isValid);
  setApiKeyError(isValid ? "" : "Invalid API key.");
}

apiKeyInput.addEventListener("input", () => {
  const value = apiKeyInput.value.trim();
  setApiKey(value);
  if (!value) {
    clearTimeout(authDebounce);
    document.body.classList.remove("is-admin");
    setApiKeyError("");
  } else {
    clearTimeout(authDebounce);
    authDebounce = setTimeout(updateAdminUI, 300);
  }
});

retryLoadBtn.addEventListener("click", () => {
  setStatus("Retrying…");
  loadBooks();
});

prevPageBtn.addEventListener("click", () => {
  if (currentPage <= 1) return;
  currentPage -= 1;
  loadBooks();
});

nextPageBtn.addEventListener("click", () => {
  if (currentPage >= totalPages) return;
  currentPage += 1;
  loadBooks();
});

editForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const id = editIdInput.value;
  if (!id) return;

  const title = editTitleInput.value.trim();
  const author = editAuthorInput.value.trim();
  const yearVal = editYearInput.value;
  const year = yearVal ? parseInt(yearVal, 10) : null;
  const coverFile = editCoverInput.files[0];
  const pdfFile = editPdfInput.files[0];

  setStatus("Saving changes…");
  try {
    await updateBook(id, { title, author, year });
    if (coverFile) await uploadCover(id, coverFile);
    if (pdfFile) await uploadFile(id, pdfFile);
    closeEditModal();
    setStatus("Book updated.", "success");
    await loadBooks();
  } catch (err) {
    setStatus(err.message, "error");
  }
});

editCancelBtn.addEventListener("click", closeEditModal);
editModal.addEventListener("cancel", (e) => {
  e.preventDefault();
  closeEditModal();
});

if (!supportsDialog) {
  editModal.addEventListener("click", (e) => {
    if (e.target === editModal) {
      closeEditModal();
    }
  });
}

apiKeyInput.value = getApiKey();
updateAdminUI();
footerYear.textContent = new Date().getFullYear();

loadBooks();
