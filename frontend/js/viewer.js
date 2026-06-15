const { pdfjsLib } = window;
pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.worker.min.js";

const urlParams = new URLSearchParams(window.location.search);
const fileUrl = urlParams.get("file");
const docTitle = urlParams.get("title") || "Document Viewer";

document.getElementById("doc-title").textContent = docTitle;
document.title = `${docTitle} - Document Viewer`;

const container = document.getElementById("viewer-container");
const loadingEl = document.getElementById("loading");
const zoomInBtn = document.getElementById("zoom-in");
const zoomOutBtn = document.getElementById("zoom-out");
const zoomFitBtn = document.getElementById("zoom-fit");
const zoomValEl = document.getElementById("zoom-value");
const docPagesEl = document.getElementById("doc-pages");
const themeSelect = document.getElementById("theme-select");
const fullscreenToggle = document.getElementById("fullscreen-toggle");
const fullscreenIcon = document.getElementById("fullscreen-icon");

const resumeToast = document.getElementById("resume-toast");
const resumeMsg = document.getElementById("resume-msg");
const resumeYesBtn = document.getElementById("resume-yes");
const resumeNoBtn = document.getElementById("resume-no");

let pdfDoc = null;
let currentScale = 1.25;
let pageContainers = [];
let currentPage = 1;

// Storage keys
const THEME_STORAGE_KEY = "elibrary_viewer_theme";
const LAST_READ_PREFIX = "elibrary_last_read_";

// Disable context menu
document.addEventListener("contextmenu", (e) => e.preventDefault());

// Disable Ctrl+S, Ctrl+P, Ctrl+U (view source), etc. and Cmd equivalents
document.addEventListener("keydown", (e) => {
  const isCmdOrCtrl = e.ctrlKey || e.metaKey;
  if (isCmdOrCtrl) {
    const key = e.key.toLowerCase();
    if (key === "s" || key === "p" || key === "u") {
      e.preventDefault();
      e.stopPropagation();
    }
  }
});

// Setup Initial Theme
const savedTheme = localStorage.getItem(THEME_STORAGE_KEY) || "dark";
document.body.className = `theme-${savedTheme}`;
themeSelect.value = savedTheme;

// Theme Selector Listener
themeSelect.addEventListener("change", (e) => {
  const selectedTheme = e.target.value;
  document.body.className = `theme-${selectedTheme}`;
  localStorage.setItem(THEME_STORAGE_KEY, selectedTheme);
});

// Fullscreen Toggle Handler
fullscreenToggle.addEventListener("click", () => {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen().then(() => {
      updateFullscreenIcon(true);
    }).catch((err) => console.error("Error enabling fullscreen:", err));
  } else {
    document.exitFullscreen().then(() => {
      updateFullscreenIcon(false);
    });
  }
});

function updateFullscreenIcon(isFullscreen) {
  if (isFullscreen) {
    fullscreenIcon.innerHTML = `
      <path d="M4 14h6v6M20 10h-6V4M14 10l7-7M10 14l-7 7" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
    `;
  } else {
    fullscreenIcon.innerHTML = `
      <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" stroke="currentColor" stroke-width="2.5"/>
    `;
  }
}

// Fullscreen escape listener
document.addEventListener("fullscreenchange", () => {
  updateFullscreenIcon(!!document.fullscreenElement);
});

// Scroll / IntersectionObserver to track visible page
const pageObserver = new IntersectionObserver((entries) => {
  entries.forEach((entry) => {
    if (entry.isIntersecting) {
      const pageNum = parseInt(entry.target.dataset.pageNumber, 10);
      currentPage = pageNum;
      updatePageIndicator();
      saveLastReadPage(pageNum);
    }
  });
}, {
  root: container,
  threshold: 0.4 // Page is active when 40% visible in view
});

function updatePageIndicator() {
  if (pdfDoc) {
    docPagesEl.textContent = `Page: ${currentPage} / ${pdfDoc.numPages}`;
  }
}

function saveLastReadPage(pageNumber) {
  if (fileUrl) {
    localStorage.setItem(`${LAST_READ_PREFIX}${fileUrl}`, pageNumber);
  }
}

async function loadPDF() {
  if (!fileUrl) {
    loadingEl.textContent = "Error: No file specified.";
    return;
  }
  try {
    const loadingTask = pdfjsLib.getDocument(fileUrl);
    pdfDoc = await loadingTask.promise;
    loadingEl.remove();
    updatePageIndicator();
    
    await renderAllPages();
    
    // Check for saved progress after pages are created
    checkSavedProgress();
  } catch (err) {
    console.error("Error loading PDF:", err);
    loadingEl.textContent = "Error: Failed to load PDF.";
  }
}

async function renderAllPages() {
  // Disconnect observer first
  pageObserver.disconnect();
  
  container.innerHTML = "";
  pageContainers = [];
  
  for (let i = 1; i <= pdfDoc.numPages; i++) {
    const pageDiv = document.createElement("div");
    pageDiv.className = "page-container";
    pageDiv.dataset.pageNumber = i;
    container.appendChild(pageDiv);
    pageContainers.push(pageDiv);
    
    // Observe this page container
    pageObserver.observe(pageDiv);
    
    // Start page rendering
    await renderPage(i, pageDiv);
  }
}

async function renderPage(pageNum, pageDiv) {
  try {
    const page = await pdfDoc.getPage(pageNum);
    
    pageDiv.innerHTML = "";
    const viewport = page.getViewport({ scale: currentScale });
    
    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    pageDiv.appendChild(canvas);
    
    const context = canvas.getContext("2d");
    const renderContext = {
      canvasContext: context,
      viewport: viewport,
    };
    
    await page.render(renderContext).promise;
    
    const textLayerDiv = document.createElement("div");
    textLayerDiv.className = "textLayer";
    textLayerDiv.style.width = `${viewport.width}px`;
    textLayerDiv.style.height = `${viewport.height}px`;
    pageDiv.appendChild(textLayerDiv);
    
    const textContent = await page.getTextContent();
    await pdfjsLib.renderTextLayer({
      textContentSource: textContent,
      container: textLayerDiv,
      viewport: viewport,
      textDivs: [],
    }).promise;
    
  } catch (err) {
    console.error(`Error rendering page ${pageNum}:`, err);
  }
}

// Progress Saving check
function checkSavedProgress() {
  const savedVal = localStorage.getItem(`${LAST_READ_PREFIX}${fileUrl}`);
  if (savedVal) {
    const pageNum = parseInt(savedVal, 10);
    if (pageNum > 1 && pageNum <= pdfDoc.numPages) {
      resumeMsg.textContent = `Resume reading on page ${pageNum}?`;
      resumeToast.classList.remove("hidden");
      
      // Hook buttons
      resumeYesBtn.onclick = () => {
        resumeToast.classList.add("hidden");
        scrollToPage(pageNum);
      };
      
      resumeNoBtn.onclick = () => {
        resumeToast.classList.add("hidden");
      };
      
      // Auto-hide toast after 8 seconds
      setTimeout(() => {
        resumeToast.classList.add("hidden");
      }, 8000);
    }
  }
}

function scrollToPage(pageNum) {
  const targetEl = pageContainers[pageNum - 1];
  if (targetEl) {
    targetEl.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

// Zoom Handlers
zoomInBtn.addEventListener("click", () => {
  if (currentScale >= 3.0) return;
  currentScale += 0.25;
  zoomValEl.textContent = `${Math.round(currentScale * 100)}%`;
  renderAllPages().then(() => {
    scrollToPage(currentPage);
  });
});

zoomOutBtn.addEventListener("click", () => {
  if (currentScale <= 0.5) return;
  currentScale -= 0.25;
  zoomValEl.textContent = `${Math.round(currentScale * 100)}%`;
  renderAllPages().then(() => {
    scrollToPage(currentPage);
  });
});

zoomFitBtn.addEventListener("click", () => {
  if (!pdfDoc) return;
  
  pdfDoc.getPage(1).then((page) => {
    const originalViewport = page.getViewport({ scale: 1.0 });
    const containerWidth = container.clientWidth - 80;
    currentScale = containerWidth / originalViewport.width;
    currentScale = Math.min(Math.max(currentScale, 0.5), 3.0);
    zoomValEl.textContent = `${Math.round(currentScale * 100)}%`;
    renderAllPages().then(() => {
      scrollToPage(currentPage);
    });
  });
});

// Load the PDF
loadPDF();
