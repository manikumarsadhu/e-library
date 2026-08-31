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
  verifyAdminTrigger,
  fetchCategories,
  createCategory,
  updateCategory,
  deleteCategory,
} from "./api.js";

const bookList = document.getElementById("book-list");
const bookCount = document.getElementById("book-count");
const statusMessage = document.getElementById("status-message");
const searchInput = document.getElementById("search");
const apiKeyInput = document.getElementById("api-key");
const adminWrap = document.getElementById("admin-wrap");
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

// Category UI Elements
const filterCategorySelect = document.getElementById("filter-category");
const categorySelect = document.getElementById("category");
const editCategorySelect = document.getElementById("edit-category");
const categoryModal = document.getElementById("category-modal");
const manageCategoriesBtn = document.getElementById("manage-categories-btn");
const categoryModalList = document.getElementById("category-modal-list");
const categoryAddForm = document.getElementById("category-add-form");
const categoryCloseBtn = document.getElementById("category-close-btn");

let allBooks = [];
let allCategories = [];
let currentCategoryFilter = sessionStorage.getItem("elibrary_category_filter") || "";
let searchDebounce = null;
let currentPage = parseInt(sessionStorage.getItem("elibrary_current_page") || "1", 10);
const pageSize = 6;
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

  if (book.category_id) {
    const cat = allCategories.find((c) => c.id === book.category_id);
    if (cat) {
      const badge = createEl("span", "book-category-badge", cat.name);
      body.appendChild(badge);
    }
  }

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

async function loadCategories() {
  try {
    allCategories = await fetchCategories();
    populateCategoryFiltersDropdown();
    populateCategoryDropdowns();
    renderCategoryModalList();
  } catch (err) {
    console.error("Failed to load categories:", err);
  }
}

function populateCategoryFiltersDropdown() {
  if (!filterCategorySelect) return;
  
  // Clear and add "All" option
  filterCategorySelect.replaceChildren(createEl("option", "", "All"));
  filterCategorySelect.options[0].value = "";

  allCategories.forEach((cat) => {
    const opt = createEl("option", "", cat.name);
    opt.value = cat.id;
    filterCategorySelect.appendChild(opt);
  });

  // Restore active filter selection
  filterCategorySelect.value = currentCategoryFilter || "";
}

function populateCategoryDropdowns() {
  if (!categorySelect || !editCategorySelect) return;
  
  // Clear other than first "None" option
  categorySelect.replaceChildren(createEl("option", "", "None"));
  categorySelect.options[0].value = "";
  
  editCategorySelect.replaceChildren(createEl("option", "", "None"));
  editCategorySelect.options[0].value = "";

  allCategories.forEach((cat) => {
    const optAdd = createEl("option", "", cat.name);
    optAdd.value = cat.id;
    categorySelect.appendChild(optAdd);

    const optEdit = createEl("option", "", cat.name);
    optEdit.value = cat.id;
    editCategorySelect.appendChild(optEdit);
  });
}

function renderCategoryModalList() {
  if (!categoryModalList) return;
  categoryModalList.replaceChildren();
  if (allCategories.length === 0) {
    categoryModalList.appendChild(createEl("li", "", "No categories created yet."));
    return;
  }

  allCategories.forEach((cat) => {
    const li = createEl("li");
    li.dataset.categoryId = cat.id;

    const nameSpan = createEl("span", "category-name-span", cat.name);
    li.appendChild(nameSpan);

    const actions = createEl("div", "category-item-actions");

    const editBtn = createEl("button", "btn btn-secondary", "Edit");
    editBtn.type = "button";
    editBtn.addEventListener("click", () => {
      enterCategoryEditState(li, cat);
    });

    const deleteBtn = createEl("button", "btn btn-danger", "Delete");
    deleteBtn.type = "button";
    deleteBtn.addEventListener("click", async () => {
      if (!confirm(`Delete category "${cat.name}"? Books in this category will not be deleted, but will have no category.`)) return;
      try {
        await deleteCategory(cat.id);
        if (currentCategoryFilter === cat.id) {
          currentCategoryFilter = "";
          currentPage = 1;
        }
        await loadCategories();
        await loadBooks();
      } catch (err) {
        alert(err.message || "Failed to delete category");
      }
    });

    actions.appendChild(editBtn);
    actions.appendChild(deleteBtn);
    li.appendChild(actions);
    categoryModalList.appendChild(li);
  });
}

function enterCategoryEditState(li, cat) {
  li.replaceChildren();

  const input = createEl("input", "category-edit-input");
  input.type = "text";
  input.value = cat.name;
  input.maxLength = 100;
  li.appendChild(input);

  const actions = createEl("div", "category-item-actions");

  const saveBtn = createEl("button", "btn btn-primary", "Save");
  saveBtn.type = "button";
  saveBtn.addEventListener("click", async () => {
    const newName = input.value.trim();
    if (!newName) return;
    try {
      await updateCategory(cat.id, { name: newName });
      await loadCategories();
      await loadBooks();
    } catch (err) {
      alert(err.message || "Failed to save category");
    }
  });

  const cancelBtn = createEl("button", "btn btn-secondary", "Cancel");
  cancelBtn.type = "button";
  cancelBtn.addEventListener("click", () => {
    renderCategoryModalList();
  });

  actions.appendChild(saveBtn);
  actions.appendChild(cancelBtn);
  li.appendChild(actions);
  input.focus();
}

function openEditModal(book) {
  if (!book) return;
  lastFocusEl = document.activeElement;
  editIdInput.value = book.id;
  editTitleInput.value = book.title || "";
  editAuthorInput.value = book.author || "";
  editYearInput.value = book.year || "";
  editCategorySelect.value = book.category_id || "";
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

function renderSkeletonCards(count = 4) {
  if (!bookList) return;
  bookList.replaceChildren();
  for (let i = 0; i < count; i++) {
    const card = createEl("article", "skeleton-card");
    card.appendChild(createEl("div", "skeleton-box skeleton-cover"));
    card.appendChild(createEl("div", "skeleton-box skeleton-title"));
    card.appendChild(createEl("div", "skeleton-box skeleton-subtitle"));
    card.appendChild(createEl("div", "skeleton-box skeleton-button"));
    bookList.appendChild(card);
  }
}

async function loadBooks() {
  setStatus("Loading…");
  renderSkeletonCards(pageSize);
  try {
    const query = searchInput.value;
    sessionStorage.setItem("elibrary_search_query", query);
    sessionStorage.setItem("elibrary_current_page", String(currentPage));
    sessionStorage.setItem("elibrary_category_filter", currentCategoryFilter);

    const response = await fetchBooks(query, currentPage, pageSize, currentCategoryFilter);
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
      const viewerUrl = `viewer.html?file=${encodeURIComponent(fileUrl(book.file_key))}&title=${encodeURIComponent(book.title)}&id=${encodeURIComponent(id)}`;
      window.location.href = viewerUrl;
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
  const category_id = addForm.category_id.value;
  const coverFile = addForm.cover.files[0];
  const pdfFile = addForm.pdf.files[0];

  setStatus("Adding book…");
  try {
    const book = await createBook({ title, author, year, category_id });
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

searchInput.addEventListener("input", async () => {
  const query = searchInput.value.trim();
  if (query) {
    const isTrigger = await verifyAdminTrigger(query);
    if (isTrigger) {
      if (adminWrap) {
        adminWrap.style.display = "";
        apiKeyInput.focus();
      }
      searchInput.value = "";
      sessionStorage.removeItem("elibrary_search_query");
    }
  }

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
  setStatus("Refreshing…");
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
  const category_id = editForm.category_id.value;
  const coverFile = editCoverInput.files[0];
  const pdfFile = editPdfInput.files[0];

  setStatus("Saving changes…");
  try {
    await updateBook(id, { title, author, year, category_id });
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

// Category Modal Event Listeners
if (manageCategoriesBtn) {
  manageCategoriesBtn.addEventListener("click", () => {
    if (categoryModal.showModal) {
      categoryModal.showModal();
    } else {
      categoryModal.setAttribute("open", "");
      categoryModal.classList.add("fallback-open");
    }
  });
}

if (categoryCloseBtn) {
  categoryCloseBtn.addEventListener("click", () => {
    if (categoryModal.close) {
      categoryModal.close();
    } else {
      categoryModal.removeAttribute("open");
      categoryModal.classList.remove("fallback-open");
    }
  });
}

if (categoryAddForm) {
  categoryAddForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const nameInput = document.getElementById("new-category-name");
    const name = nameInput.value.trim();
    if (!name) return;
    try {
      await createCategory({ name });
      nameInput.value = "";
      await loadCategories();
    } catch (err) {
      alert(err.message || "Failed to create category");
    }
  });
}

if (filterCategorySelect) {
  filterCategorySelect.addEventListener("change", () => {
    currentCategoryFilter = filterCategorySelect.value;
    currentPage = 1;
    loadBooks();
  });
}

if (adminWrap) {
  adminWrap.style.display = "none";
}
sessionStorage.removeItem("elibrary_admin_unlocked");

const storedKey = getApiKey();
apiKeyInput.value = storedKey;
updateAdminUI();
footerYear.textContent = new Date().getFullYear();

const savedQuery = sessionStorage.getItem("elibrary_search_query");
if (savedQuery !== null) {
  searchInput.value = savedQuery;
} else if (searchInput.value.includes("@")) {
  // Clear browser-autofilled email from search box
  searchInput.value = "";
}

// Clear browser-autofilled passwords if no API key is stored in localStorage
const clearAutofill = () => {
  if (!getApiKey()) {
    apiKeyInput.value = "";
    apiKeyError.textContent = "";
    updateAdminUI();
  }
  if (!sessionStorage.getItem("elibrary_search_query") && searchInput.value.includes("@")) {
    searchInput.value = "";
  }
};

// Run autofill cleanup on load and after short browser autofill delay
clearAutofill();
setTimeout(clearAutofill, 50);
setTimeout(clearAutofill, 250);

// Load categories first, then load books to ensure category names are populated
loadCategories().then(() => {
  loadBooks();
});
