const { pdfjsLib } = window;
pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.worker.min.js";

const urlParams = new URLSearchParams(window.location.search);
const fileUrl = urlParams.get("file");
const docTitle = urlParams.get("title") || "Document Viewer";
const bookId = urlParams.get("id") || null;

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
const pinchHintEl = document.getElementById("pinch-hint");

let pdfDoc = null;
let currentScale = 1.25;
let pageContainers = [];
let currentPage = 1;
const renderedPages = new Set();
let isAutoAdvancingSpeech = false;
let speechEndPage = 1;
let docChaptersList = [];
let selectedVoiceName = localStorage.getItem("elibrary_selected_voice") || "";
let currentTextLang = "en";
let speechCurrentPage = 1;
const isMobileViewport = () => window.matchMedia("(max-width: 640px)").matches;
let isPinching = false;
let pinchStartDistance = 0;
let pinchStartScale = currentScale;
let lastPinchRerenderAt = 0;
let firstPageViewport = null;
let isZooming = false;

// Storage keys
const THEME_STORAGE_KEY = "elibrary_viewer_theme";
const LAST_READ_PREFIX = "elibrary_last_read_";
const PINCH_HINT_DISMISSED_KEY = "elibrary_pinch_hint_dismissed";

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

const pageObserver = new IntersectionObserver((entries) => {
  if (isZooming) return;
  entries.forEach((entry) => {
    if (entry.isIntersecting) {
      const pageNum = parseInt(entry.target.dataset.pageNumber, 10);
      currentPage = pageNum;
      updatePageIndicator();
      saveLastReadPage(pageNum);
      ensurePageRangeRendered(pageNum);
      updateBookmarkButtonState();
    }
  });
}, {
  root: container,
  threshold: 0.4,
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

    // Load first page's viewport to establish standard page dimensions
    try {
      const firstPage = await pdfDoc.getPage(1);
      firstPageViewport = firstPage.getViewport({ scale: 1.0 });
    } catch (e) {
      console.error("Error loading first page viewport:", e);
    }

    // Auto-fit width on mobile viewport on initial load
    if (isMobileViewport() && firstPageViewport) {
      const styles = window.getComputedStyle(container);
      const horizontalPadding =
        parseFloat(styles.paddingLeft || "0") + parseFloat(styles.paddingRight || "0");
      const mobileGutter = 16;
      const containerWidth = container.clientWidth - horizontalPadding - mobileGutter;
      currentScale = containerWidth / firstPageViewport.width;
      currentScale = Math.min(Math.max(currentScale, 0.5), 3.0);
      zoomValEl.textContent = `${Math.round(currentScale * 100)}%`;
    }

    buildPagePlaceholders();
    updatePageIndicator();
    ensurePageRangeRendered(1);
    checkSavedProgress();
    loadBookmarks();
    renderBookmarksList();
    generateChaptersOutline().catch((err) => console.error("Error generating outline:", err));
    populateVoiceSelect();
  } catch (err) {
    console.error("Error loading PDF:", err);
    loadingEl.textContent = "Error: Failed to load PDF.";
  }
}

function buildPagePlaceholders() {
  pageObserver.disconnect();
  container.innerHTML = "";
  pageContainers = [];
  renderedPages.clear();

  const width = firstPageViewport ? `${firstPageViewport.width * currentScale}px` : "";
  const height = firstPageViewport ? `${firstPageViewport.height * currentScale}px` : "";

  for (let i = 1; i <= pdfDoc.numPages; i++) {
    const pageDiv = document.createElement("div");
    pageDiv.className = "page-container";
    pageDiv.dataset.pageNumber = i;
    if (width) pageDiv.style.width = width;
    if (height) pageDiv.style.height = height;
    pageDiv.innerHTML = `<div class="spinner"></div>`;
    container.appendChild(pageDiv);
    pageContainers.push(pageDiv);
    pageObserver.observe(pageDiv);
  }
}

function ensurePageRangeRendered(centerPage) {
  for (let pageNum = centerPage - 1; pageNum <= centerPage + 1; pageNum += 1) {
    if (pageNum < 1 || pageNum > pageContainers.length) continue;
    if (!renderedPages.has(pageNum)) {
      renderedPages.add(pageNum);
      void renderPage(pageNum, pageContainers[pageNum - 1]);
    }
  }
}

async function renderPage(pageNum, pageDiv) {
  try {
    const page = await pdfDoc.getPage(pageNum);
    pageDiv.innerHTML = "";
    const viewport = page.getViewport({ scale: currentScale });
    
    // Round to integer sizes to prevent sub-pixel canvas scaling blur
    const width = Math.floor(viewport.width);
    const height = Math.floor(viewport.height);
    
    pageDiv.style.width = `${width}px`;
    pageDiv.style.height = `${height}px`;
    
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    const dpr = window.devicePixelRatio || 1;
    
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    
    pageDiv.appendChild(canvas);
    
    context.scale(dpr, dpr);
    
    const renderContext = {
      canvasContext: context,
      viewport: viewport,
    };
    await page.render(renderContext).promise;

    const textLayerDiv = document.createElement("div");
    textLayerDiv.className = "textLayer";
    textLayerDiv.style.width = `${width}px`;
    textLayerDiv.style.height = `${height}px`;
    textLayerDiv.style.setProperty("--scale-factor", viewport.scale);
    pageDiv.appendChild(textLayerDiv);

    const textContent = await page.getTextContent();
    await pdfjsLib.renderTextLayer({
      textContentSource: textContent,
      container: textLayerDiv,
      viewport: viewport,
      textDivs: [],
    }).promise;

    if (isPlayingSpeech && speechCurrentPage === pageNum) {
      reSyncSpeechSpans(pageDiv);
    }
  } catch (err) {
    renderedPages.delete(pageNum);
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
        ensurePageRangeRendered(pageNum);
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

function scrollToPage(pageNum, behavior = "smooth") {
  const targetEl = pageContainers[pageNum - 1];
  if (targetEl) {
    targetEl.scrollIntoView({ behavior, block: "start" });
  }
}

function resetPageContainersForZoom() {
  renderedPages.clear();
  const width = firstPageViewport ? `${firstPageViewport.width * currentScale}px` : "";
  const height = firstPageViewport ? `${firstPageViewport.height * currentScale}px` : "";

  pageContainers.forEach((pageDiv) => {
    if (width) pageDiv.style.width = width;
    if (height) pageDiv.style.height = height;
    pageDiv.innerHTML = `<div class="spinner"></div>`;
  });
}

function rerenderAroundCurrentPage() {
  isZooming = true;
  resetPageContainersForZoom();
  scrollToPage(currentPage, "auto");
  ensurePageRangeRendered(currentPage);
  setTimeout(() => {
    isZooming = false;
  }, 100);
}

function shouldShowPinchHint() {
  if (!isMobileViewport()) return false;
  return localStorage.getItem(PINCH_HINT_DISMISSED_KEY) !== "1";
}

function hidePinchHint() {
  if (!pinchHintEl) return;
  pinchHintEl.classList.add("hidden");
  localStorage.setItem(PINCH_HINT_DISMISSED_KEY, "1");
}

function showPinchHint() {
  if (!pinchHintEl || !shouldShowPinchHint()) return;
  pinchHintEl.classList.remove("hidden");
  setTimeout(() => {
    if (pinchHintEl.classList.contains("hidden")) return;
    hidePinchHint();
  }, 6000);
}

function distanceBetweenTouches(touchA, touchB) {
  const dx = touchA.clientX - touchB.clientX;
  const dy = touchA.clientY - touchB.clientY;
  return Math.hypot(dx, dy);
}

function getZoomStep() {
  return isMobileViewport() ? 0.1 : 0.25;
}

// Zoom Handlers
zoomInBtn.addEventListener("click", () => {
  if (currentScale >= 3.0) return;
  currentScale += getZoomStep();
  zoomValEl.textContent = `${Math.round(currentScale * 100)}%`;
  rerenderAroundCurrentPage();
});

zoomOutBtn.addEventListener("click", () => {
  if (currentScale <= 0.5) return;
  currentScale -= getZoomStep();
  zoomValEl.textContent = `${Math.round(currentScale * 100)}%`;
  rerenderAroundCurrentPage();
});

zoomFitBtn.addEventListener("click", () => {
  if (!pdfDoc) return;
  
  pdfDoc.getPage(1).then((page) => {
    const originalViewport = page.getViewport({ scale: 1.0 });
    const styles = window.getComputedStyle(container);
    const horizontalPadding =
      parseFloat(styles.paddingLeft || "0") + parseFloat(styles.paddingRight || "0");
    const mobileGutter = isMobileViewport() ? 16 : 32;
    const containerWidth = container.clientWidth - horizontalPadding - mobileGutter;
    currentScale = containerWidth / originalViewport.width;
    currentScale = Math.min(Math.max(currentScale, 0.5), 3.0);
    zoomValEl.textContent = `${Math.round(currentScale * 100)}%`;
    rerenderAroundCurrentPage();
  });
});

container.addEventListener("touchstart", (event) => {
  if (event.touches.length !== 2) return;
  hidePinchHint();
  isPinching = true;
  pinchStartDistance = distanceBetweenTouches(event.touches[0], event.touches[1]);
  pinchStartScale = currentScale;
}, { passive: true });

container.addEventListener("touchmove", (event) => {
  if (!isPinching || event.touches.length !== 2) return;
  event.preventDefault();
  const currentDistance = distanceBetweenTouches(event.touches[0], event.touches[1]);
  if (!pinchStartDistance) return;

  const scaleRatio = currentDistance / pinchStartDistance;
  const nextScale = Math.min(Math.max(pinchStartScale * scaleRatio, 0.5), 3.0);
  if (Math.abs(nextScale - currentScale) < 0.01) return;

  currentScale = nextScale;
  zoomValEl.textContent = `${Math.round(currentScale * 100)}%`;

  const now = Date.now();
  if (now - lastPinchRerenderAt > 120) {
    rerenderAroundCurrentPage();
    lastPinchRerenderAt = now;
  }
}, { passive: false });

container.addEventListener("touchend", (event) => {
  if (!isPinching) return;
  if (event.touches.length >= 2) return;
  isPinching = false;
  pinchStartDistance = 0;
  pinchStartScale = currentScale;
  rerenderAroundCurrentPage();
}, { passive: true });

container.addEventListener("touchcancel", () => {
  if (!isPinching) return;
  isPinching = false;
  pinchStartDistance = 0;
  pinchStartScale = currentScale;
  rerenderAroundCurrentPage();
}, { passive: true });

pinchHintEl?.addEventListener("click", hidePinchHint);
container.addEventListener("touchstart", () => {
  if (pinchHintEl && !pinchHintEl.classList.contains("hidden")) {
    hidePinchHint();
  }
}, { passive: true });

// Load the PDF
loadPDF();
showPinchHint();

// --- AI Reading Assistant logic ---
const aiToggleBtn = document.getElementById("ai-toggle");
const aiSidebar = document.getElementById("ai-sidebar");
const aiCloseBtn = document.getElementById("ai-close");
const aiChatInput = document.getElementById("ai-chat-input");
const aiSendBtn = document.getElementById("ai-send-btn");
const aiChatHistory = document.getElementById("ai-chat-history");
const promptChips = document.querySelectorAll(".prompt-chip");

const chatHistoryMemory = [];
let isAiResponding = false;

const sidebarBackdrop = document.getElementById("sidebar-backdrop");
const MOBILE_SIDEBAR_MAX = 576;
const isMobileSidebar = () => window.matchMedia(`(max-width: ${MOBILE_SIDEBAR_MAX}px)`).matches;
let mobileSheetHeightVh = 60;

function setSidebarOpen(open) {
  if (!aiSidebar) return;
  if (open) {
    aiSidebar.classList.remove("collapsed");
    if (isMobileSidebar()) {
      aiSidebar.style.height = `${mobileSheetHeightVh}vh`;
      sidebarBackdrop?.classList.add("visible");
    }
  } else {
    aiSidebar.classList.add("collapsed");
    sidebarBackdrop?.classList.remove("visible");
  }
}

function toggleSidebar() {
  if (!aiSidebar) return;
  setSidebarOpen(aiSidebar.classList.contains("collapsed"));
}

if (aiToggleBtn && aiSidebar && aiCloseBtn) {
  aiToggleBtn.addEventListener("click", () => {
    toggleSidebar();
    if (!aiSidebar.classList.contains("collapsed")) {
      const isAiActive = sidebarAiTab && !sidebarAiTab.classList.contains("hidden");
      if (isAiActive && aiChatInput) {
        aiChatInput.focus();
      }
    }
  });

  aiCloseBtn.addEventListener("click", () => {
    setSidebarOpen(false);
  });

  sidebarBackdrop?.addEventListener("click", () => {
    setSidebarOpen(false);
  });

  // Auto-resize input textarea
  aiChatInput.addEventListener("input", () => {
    aiChatInput.style.height = "auto";
    aiChatInput.style.height = `${Math.min(aiChatInput.scrollHeight, 120)}px`;
  });

  // Send on Enter (but new line on Shift+Enter)
  aiChatInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendUserMessage();
    }
  });

  aiSendBtn.addEventListener("click", () => sendUserMessage());

  promptChips.forEach((chip) => {
    chip.addEventListener("click", () => {
      if (isAiResponding) return;
      const prompt = chip.dataset.prompt;
      sendUserMessage(prompt);
    });
  });
}

// Extract text from the active page in the viewer
async function getActivePageText(pageNum = currentPage) {
  if (!pdfDoc) return "";
  try {
    const page = await pdfDoc.getPage(pageNum);
    const textContent = await page.getTextContent();
    return textContent.items
      .map((item) => item.str)
      .filter((str) => {
        const trimmed = str.trim();
        return !(/EBS Topics/i.test(trimmed) || /^Page\s*\d*$/i.test(trimmed));
      })
      .join(" ");
  } catch (err) {
    console.error("Failed to extract page text: ", err);
    return "";
  }
}

// Simple Markdown Formatter for the AI replies
function formatMarkdown(text) {
  let html = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  // Code blocks: ```code```
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
    return `<pre><code class="language-${lang || 'txt'}">${code.trim()}</code></pre>`;
  });

  // Inline code: `code`
  html = html.replace(/`([^`\n]+)`/g, '<code>$1</code>');

  // Bold: **text**
  html = html.replace(/\*\*([\s\S]*?)\*\*/g, '<strong>$1</strong>');

  // Bullet points
  let lines = html.split("\n");
  let inList = false;
  let resultLines = [];

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i].trim();
    if (line.startsWith("- ") || line.startsWith("* ")) {
      if (!inList) {
        resultLines.push("<ul>");
        inList = true;
      }
      resultLines.push(`<li>${line.substring(2)}</li>`);
    } else {
      if (inList) {
        resultLines.push("</ul>");
        inList = false;
      }
      resultLines.push(lines[i]);
    }
  }
  if (inList) {
    resultLines.push("</ul>");
  }

  html = resultLines.join("\n");

  // Paragraphs
  let paragraphs = html.split(/\n{2,}/);
  html = paragraphs.map((p) => {
    let trimmed = p.trim();
    if (!trimmed) return "";
    if (trimmed.startsWith("<ul>") || trimmed.startsWith("<pre>") || trimmed.startsWith("<li>")) {
      return trimmed;
    }
    return `<p>${trimmed.replace(/\n/g, "<br>")}</p>`;
  }).join("");

  return html;
}

function appendMessage(role, text, isHtml = false) {
  const msgDiv = document.createElement("div");
  msgDiv.className = `chat-message ${role}`;
  if (isHtml) {
    msgDiv.innerHTML = text;
  } else {
    msgDiv.textContent = text;
  }
  aiChatHistory.appendChild(msgDiv);
  aiChatHistory.scrollTop = aiChatHistory.scrollHeight;
  return msgDiv;
}

async function sendUserMessage(customPrompt = null) {
  if (isAiResponding) return;

  const promptText = (customPrompt || aiChatInput.value || "").trim();
  if (!promptText) return;

  // Clear input
  if (!customPrompt) {
    aiChatInput.value = "";
    aiChatInput.style.height = "38px";
  }

  // Display user message
  appendMessage("user", promptText);

  // Disable controls during API call
  isAiResponding = true;
  aiSendBtn.disabled = true;
  aiChatInput.disabled = true;

  // Display loading indicator
  const loadingMsg = appendMessage("ai loading-dots", "Thinking...");

  try {
    const pageText = await getActivePageText();
    
    // Call serverless /api/ai/chat route
    const response = await fetch("/api/ai/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: promptText,
        pageContext: pageText,
        pageNumber: currentPage,
        bookTitle: docTitle,
        history: chatHistoryMemory
      })
    });

    if (!response.ok) {
      throw new Error(`Server returned status ${response.status}`);
    }

    // Remove loading indicator
    loadingMsg.remove();

    // Create a new message container for the streaming output
    const responseMsg = appendMessage("ai", "", true);

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let accumulatedText = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      accumulatedText += decoder.decode(value, { stream: true });
      responseMsg.innerHTML = formatMarkdown(accumulatedText);
      aiChatHistory.scrollTop = aiChatHistory.scrollHeight;
    }

    // Add to conversation memory
    chatHistoryMemory.push({ role: "user", text: promptText });
    chatHistoryMemory.push({ role: "assistant", text: accumulatedText });

  } catch (err) {
    console.error("AI chat request failed:", err);
    loadingMsg.remove();
    appendMessage("ai error", "Sorry, I encountered an error while processing your request. Please check that your Gemini API key is configured correctly.");
  } finally {
    isAiResponding = false;
    aiSendBtn.disabled = false;
    aiChatInput.disabled = false;
    aiChatInput.focus();
  }
}

// Handle window resize and orientation changes to prevent text blurriness from stretching
let resizeTimeout = null;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimeout);
  resizeTimeout = setTimeout(() => {
    if (isMobileViewport() && pdfDoc && firstPageViewport) {
      const styles = window.getComputedStyle(container);
      const horizontalPadding =
        parseFloat(styles.paddingLeft || "0") + parseFloat(styles.paddingRight || "0");
      const mobileGutter = 16;
      const containerWidth = container.clientWidth - horizontalPadding - mobileGutter;
      const nextScale = containerWidth / firstPageViewport.width;
      currentScale = Math.min(Math.max(nextScale, 0.5), 3.0);
      zoomValEl.textContent = `${Math.round(currentScale * 100)}%`;
      rerenderAroundCurrentPage();
    } else {
      rerenderAroundCurrentPage();
    }
  }, 250);
});

// --- TTS Voice Reader logic ---
const voiceToggleBtn = document.getElementById("voice-toggle");
const voiceStopBtn = document.getElementById("voice-stop");
const voiceRateSel = document.getElementById("voice-rate");
const voiceToggleIcon = document.getElementById("voice-toggle-icon");

let isPlayingSpeech = false;
let isPausedSpeech = false;
let speechUtterance = null;
let speechSpansInfo = [];
let lastHighlightedSpan = null;

const voiceRangeMode = document.getElementById("voice-range-mode");
const voiceCustomRange = document.getElementById("voice-custom-range");
const voicePageFrom = document.getElementById("voice-page-from");
const voicePageTo = document.getElementById("voice-page-to");
const voiceSelect = document.getElementById("voice-select");

if (voiceToggleBtn && voiceStopBtn && voiceRateSel && voiceToggleIcon) {
  voiceToggleBtn.addEventListener("click", () => toggleSpeaking());
  voiceStopBtn.addEventListener("click", () => stopSpeaking());
  voiceRateSel.addEventListener("change", () => {
    if (isPlayingSpeech) {
      startSpeaking(true);
    }
  });
}

if (voiceRangeMode && voiceCustomRange) {
  voiceRangeMode.addEventListener("change", () => {
    if (voiceRangeMode.value === "custom") {
      voiceCustomRange.style.display = "flex";
      if (voicePageFrom && voicePageTo) {
        voicePageFrom.value = currentPage;
        voicePageTo.value = Math.min(currentPage + 2, pdfDoc ? pdfDoc.numPages : currentPage);
      }
    } else {
      voiceCustomRange.style.display = "none";
    }
  });
}

if (voiceSelect) {
  voiceSelect.addEventListener("change", () => {
    selectedVoiceName = voiceSelect.value;
    localStorage.setItem("elibrary_selected_voice", selectedVoiceName);
    if (isPlayingSpeech) {
      startSpeaking(true);
    }
  });
}

function clearSpeechHighlights() {
  if (lastHighlightedSpan) {
    lastHighlightedSpan.classList.remove("speech-highlight");
    lastHighlightedSpan = null;
  }
  const pageContainer = pageContainers[speechCurrentPage - 1];
  if (pageContainer) {
    pageContainer.querySelectorAll(".textLayer span.speech-highlight").forEach((span) => {
      span.classList.remove("speech-highlight");
    });
  }
}

async function startSpeaking(isContinuation = false) {
  window.speechSynthesis.cancel();
  clearSpeechHighlights();
  speechSpansInfo = [];

  // Calculate Speech Page Range bounds
  if (!isContinuation) {
    speechCurrentPage = currentPage;
    const mode = voiceRangeMode ? voiceRangeMode.value : "page";
    if (mode === "page") {
      speechEndPage = speechCurrentPage;
    } else if (mode === "chapter") {
      if (docChaptersList && docChaptersList.length > 0) {
        let chapterIdx = -1;
        for (let i = 0; i < docChaptersList.length; i++) {
          if (docChaptersList[i].pageNum <= speechCurrentPage) {
            chapterIdx = i;
          }
        }
        if (chapterIdx !== -1) {
          const endPage = (chapterIdx + 1 < docChaptersList.length)
            ? docChaptersList[chapterIdx + 1].pageNum - 1
            : (pdfDoc ? pdfDoc.numPages : speechCurrentPage);
          speechEndPage = Math.max(speechCurrentPage, endPage);
        } else {
          speechEndPage = docChaptersList[0].pageNum - 1;
        }
        if (speechEndPage < speechCurrentPage) {
          speechEndPage = speechCurrentPage;
        }
      } else {
        speechEndPage = speechCurrentPage;
      }
    } else if (mode === "custom") {
      const fromPage = voicePageFrom ? parseInt(voicePageFrom.value, 10) : 1;
      const toPage = voicePageTo ? parseInt(voicePageTo.value, 10) : (pdfDoc ? pdfDoc.numPages : 1);

      // Auto scroll to target page if different from current page
      if (fromPage >= 1 && fromPage <= (pdfDoc ? pdfDoc.numPages : 1) && speechCurrentPage !== fromPage) {
        speechCurrentPage = fromPage;
        scrollToPage(fromPage);
        isAutoAdvancingSpeech = true;
        setTimeout(() => {
          isAutoAdvancingSpeech = false;
          startSpeaking(true);
        }, 800);
        return;
      }
      speechEndPage = toPage;
    }
  }

  const pageContainer = pageContainers[speechCurrentPage - 1];
  const spans = pageContainer ? pageContainer.querySelectorAll(".textLayer span") : [];
  
  let fullText = "";
  let accumulatedLength = 0;
  
  spans.forEach((span) => {
    const textVal = span.textContent || "";
    const trimmed = textVal.trim();
    if (/EBS Topics/i.test(trimmed) || /^Page\s*\d*$/i.test(trimmed)) {
      return;
    }
    const start = accumulatedLength;
    const end = start + textVal.length;
    speechSpansInfo.push({
      element: span,
      start: start,
      end: end
    });
    fullText += (fullText ? " " : "") + textVal;
    accumulatedLength = fullText.length;
  });

  const text = fullText || await getActivePageText(speechCurrentPage);
  if (!text || !text.trim()) {
    if (isAutoAdvancingSpeech && speechCurrentPage < speechEndPage && pdfDoc && speechCurrentPage < pdfDoc.numPages) {
      isAutoAdvancingSpeech = true;
      speechCurrentPage = speechCurrentPage + 1;
      scrollToPage(speechCurrentPage);
      setTimeout(() => {
        isAutoAdvancingSpeech = false;
        startSpeaking(true);
      }, 800);
    } else {
      alert("No text found on this page to read.");
      stopSpeaking();
    }
    return;
  }

  speechUtterance = new SpeechSynthesisUtterance(text);
  speechUtterance.rate = parseFloat(voiceRateSel.value) || 1.0;

  // Detect language: use Telugu voice if Telugu script is detected, else English/default
  const isTelugu = /[\u0C00-\u0C7F]/.test(text);
  const targetLang = isTelugu ? "te" : "en";

  if (targetLang !== currentTextLang) {
    currentTextLang = targetLang;
    populateVoiceSelect();
  }

  const voices = window.speechSynthesis.getVoices();
  let chosenVoice = null;
  if (selectedVoiceName) {
    chosenVoice = voices.find(v => v.name === selectedVoiceName);
  }

  // If no user-chosen voice or it's not compatible, select matching voice dynamically
  if (!chosenVoice) {
    const matchedVoices = voices.filter((v) => v.lang.startsWith(targetLang));

    const femaleNames = [
      "female", "zira", "hazel", "samantha", "karen", "moira", "tessa", 
      "veena", "fiona", "victoria", "haruka", "helen", "elsa", "susie", 
      "susan", "sangeeta", "kalpana", "priya", "shruti", "swara", 
      "geeta", "vani", "ananya", "pallavi"
    ];
    const maleNames = [
      "male", "david", "george", "mark", "daniel", "alex", "fred", 
      "ravi", "hemant", "karthik"
    ];

    const isFemaleVoice = (voice) => {
      const name = voice.name.toLowerCase();
      if (name.includes("female")) return true;
      if (name.includes("male")) return false;
      const hasFemale = femaleNames.some((f) => name.includes(f));
      if (hasFemale) return true;
      const hasMale = maleNames.some((m) => name.includes(m));
      if (hasMale) return false;
      return false;
    };

    // Sort matching voices: female voices first
    matchedVoices.sort((a, b) => {
      const aFemale = isFemaleVoice(a);
      const bFemale = isFemaleVoice(b);
      if (aFemale && !bFemale) return -1;
      if (!aFemale && bFemale) return 1;
      return 0;
    });
    chosenVoice = matchedVoices[0];
  }

  if (chosenVoice) {
    speechUtterance.voice = chosenVoice;
    speechUtterance.lang = chosenVoice.lang;
  } else if (isTelugu) {
    alert("Telugu voice engine not detected on your device. Reading will fall back to default voice. For the best experience, please enable/install Telugu Text-to-Speech in your system/browser settings.");
  }

  speechUtterance.onboundary = (event) => {
    if (event.name === "word") {
      const charIndex = event.charIndex;
      const activeSpan = speechSpansInfo.find(
        (info) => charIndex >= info.start && charIndex <= info.end
      );

      if (activeSpan && activeSpan.element !== lastHighlightedSpan) {
        if (lastHighlightedSpan) {
          lastHighlightedSpan.classList.remove("speech-highlight");
        }
        activeSpan.element.classList.add("speech-highlight");
        lastHighlightedSpan = activeSpan.element;

        if (currentPage === speechCurrentPage) {
          activeSpan.element.scrollIntoView({
            behavior: "smooth",
            block: "nearest"
          });
        }
      }
    }
  };

  speechUtterance.onend = () => {
    if (speechCurrentPage < speechEndPage && pdfDoc && speechCurrentPage < pdfDoc.numPages) {
      isAutoAdvancingSpeech = true;
      speechCurrentPage = speechCurrentPage + 1;
      scrollToPage(speechCurrentPage);
      setTimeout(() => {
        isAutoAdvancingSpeech = false;
        startSpeaking(true);
      }, 800);
    } else {
      stopSpeaking();
    }
  };

  speechUtterance.onerror = (e) => {
    if (e.error === "interrupted" || e.error === "interrupted-error" || e.error === "canceled") {
      return;
    }
    console.error("SpeechSynthesis error:", e);
    stopSpeaking();
  };

  isPlayingSpeech = true;
  isPausedSpeech = false;
  updateVoiceUI();

  window.speechSynthesis.speak(speechUtterance);
}

function stopSpeaking() {
  window.speechSynthesis.cancel();
  isPlayingSpeech = false;
  isPausedSpeech = false;
  isAutoAdvancingSpeech = false;
  speechUtterance = null;
  clearSpeechHighlights();
  updateVoiceUI();
}

function toggleSpeaking() {
  if (!isPlayingSpeech) {
    startSpeaking();
  } else if (isPausedSpeech) {
    window.speechSynthesis.resume();
    isPausedSpeech = false;
    updateVoiceUI();
  } else {
    window.speechSynthesis.pause();
    isPausedSpeech = true;
    updateVoiceUI();
  }
}

function reSyncSpeechSpans(pageDiv) {
  const spans = pageDiv.querySelectorAll(".textLayer span");
  speechSpansInfo = [];
  let fullText = "";
  let accumulatedLength = 0;

  spans.forEach((span) => {
    const textVal = span.textContent || "";
    const trimmed = textVal.trim();
    if (/EBS Topics/i.test(trimmed) || /^Page\s*\d*$/i.test(trimmed)) {
      return;
    }
    const start = accumulatedLength;
    const end = start + textVal.length;
    speechSpansInfo.push({
      element: span,
      start: start,
      end: end
    });
    fullText += (fullText ? " " : "") + textVal;
    accumulatedLength = fullText.length;
  });

  lastHighlightedSpan = null;
}

function updateVoiceUI() {
  if (isPlayingSpeech && !isPausedSpeech) {
    // Show Pause Icon
    voiceToggleIcon.innerHTML = `
      <rect x="6" y="4" width="4" height="16"></rect>
      <rect x="14" y="4" width="4" height="16"></rect>
    `;
    voiceToggleBtn.title = "Pause Reading";
  } else {
    // Show Speaker Icon
    voiceToggleIcon.innerHTML = `
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
      <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path>
    `;
    voiceToggleBtn.title = isPausedSpeech ? "Resume Reading" : "Read Aloud";
  }
  voiceStopBtn.disabled = !isPlayingSpeech;
}

function populateVoiceSelect() {
  if (!voiceSelect) return;

  const voices = window.speechSynthesis.getVoices();
  const filteredVoices = voices.filter(v => v.lang.startsWith(currentTextLang));
  const listToUse = filteredVoices.length > 0 ? filteredVoices : voices;

  const currentVal = voiceSelect.value || selectedVoiceName;

  voiceSelect.innerHTML = `<option value="">Default (${currentTextLang === "te" ? "Telugu" : "English"})</option>`;

  const femaleNames = [
    "female", "zira", "hazel", "samantha", "karen", "moira", "tessa", 
    "veena", "fiona", "victoria", "haruka", "helen", "elsa", "susie", 
    "susan", "sangeeta", "kalpana", "priya", "shruti", "swara", 
    "geeta", "vani", "ananya", "pallavi"
  ];
  const maleNames = [
    "male", "david", "george", "mark", "daniel", "alex", "fred", 
    "ravi", "hemant", "karthik"
  ];

  const getVoiceGender = (voice) => {
    const name = voice.name.toLowerCase();
    if (name.includes("female")) return "Female";
    if (name.includes("male")) return "Male";
    const hasFemale = femaleNames.some((f) => name.includes(f));
    if (hasFemale) return "Female";
    const hasMale = maleNames.some((m) => name.includes(m));
    if (hasMale) return "Male";
    return "Default";
  };

  listToUse.sort((a, b) => {
    const aGender = getVoiceGender(a);
    const bGender = getVoiceGender(b);
    if (aGender === "Female" && bGender !== "Female") return -1;
    if (aGender !== "Female" && bGender === "Female") return 1;
    if (aGender === "Male" && bGender === "Default") return -1;
    if (aGender === "Default" && bGender === "Male") return 1;
    return a.name.localeCompare(b.name);
  });

  listToUse.forEach(voice => {
    const opt = document.createElement("option");
    opt.value = voice.name;
    const gender = getVoiceGender(voice);
    opt.textContent = `${voice.name} (${gender}, ${voice.lang})`;
    voiceSelect.appendChild(opt);
  });

  if (currentVal && Array.from(voiceSelect.options).some(o => o.value === currentVal)) {
    voiceSelect.value = currentVal;
  }
}

if (typeof window !== "undefined" && window.speechSynthesis) {
  window.speechSynthesis.onvoiceschanged = () => {
    populateVoiceSelect();
  };
}

// --- Sidebar Tabs Controller ---
const tabChapters = document.getElementById("tab-chapters");
const tabBookmarks = document.getElementById("tab-bookmarks");
const tabSearch = document.getElementById("tab-search");
const tabAi = document.getElementById("tab-ai");
const sidebarChaptersTab = document.getElementById("sidebar-chapters-tab");
const sidebarBookmarksTab = document.getElementById("sidebar-bookmarks-tab");
const sidebarSearchTab = document.getElementById("sidebar-search-tab");
const sidebarAiTab = document.getElementById("sidebar-ai-tab");

const sidebarTabs = [
  { btn: tabChapters, panel: sidebarChaptersTab },
  { btn: tabBookmarks, panel: sidebarBookmarksTab },
  { btn: tabSearch, panel: sidebarSearchTab },
  { btn: tabAi, panel: sidebarAiTab },
];

function switchSidebarTab(activeBtn) {
  sidebarTabs.forEach(({ btn, panel }) => {
    if (!btn || !panel) return;
    const isActive = btn === activeBtn;
    btn.classList.toggle("active", isActive);
    panel.classList.toggle("hidden", !isActive);
  });
  if (activeBtn === tabAi && !aiSidebar.classList.contains("collapsed")) {
    aiChatInput?.focus();
  }
}

sidebarTabs.forEach(({ btn }) => {
  btn?.addEventListener("click", () => switchSidebarTab(btn));
});

// --- Book Chapter Analysis and Outline Builder ---
const refreshChaptersBtn = document.getElementById("refresh-chapters-btn");

refreshChaptersBtn?.addEventListener("click", async () => {
  if (!pdfDoc) return;
  const confirmed = window.confirm("Re-scan chapters? This clears the cached outline and scans the PDF again.");
  if (!confirmed) return;
  refreshChaptersBtn.classList.add("spinning");
  try {
    if (bookId) {
      await saveCachedOutline(bookId, []);
    }
    await generateChaptersOutline(true);
  } finally {
    refreshChaptersBtn.classList.remove("spinning");
  }
});

async function generateChaptersOutline(force = false) {
  const chaptersListEl = document.getElementById("chapters-list");
  if (!chaptersListEl) return;

  chaptersListEl.innerHTML = `<div class="chapters-empty">Analyzing document chapters...</div>`;

  try {
    // Step 1: Try to load from DB cache if we have a book ID (skip when force-refreshing)
    if (bookId && !force) {
      const cached = await fetchCachedOutline(bookId);
      if (cached && Array.isArray(cached) && cached.length > 0) {
        docChaptersList = cached;
        renderOutlineNodes(cached, chaptersListEl);
        return;
      }
    }

    // Step 2: Generate from PDF bookmarks or heuristic scanner
    const outline = await pdfDoc.getOutline();
    let nodes = [];
    if (outline && outline.length > 0) {
      nodes = await parseOutlineItems(outline, 0);
    }

    if (nodes.length === 0) {
      nodes = await scanForChaptersFallback();
    }

    // Step 2b: AI fallback when heuristic finds very little
    if (flattenOutline(nodes).length < 2) {
      const aiNodes = await extractOutlineWithAI();
      if (aiNodes.length > 0) {
        nodes = aiNodes;
      }
    }

    docChaptersList = flattenOutline(nodes);
    renderOutlineNodes(nodes, chaptersListEl);

    // Step 3: Save to DB cache if we have a book ID and found chapters
    if (bookId && docChaptersList.length > 0) {
      saveCachedOutline(bookId, docChaptersList).catch((err) =>
        console.warn("Could not save outline to DB cache:", err)
      );
    }

  } catch (err) {
    console.error("Error generating chapters outline:", err);
    chaptersListEl.innerHTML = `<div class="chapters-empty">Failed to analyze chapters.</div>`;
  }
}

async function extractOutlineWithAI() {
  if (!pdfDoc) return [];
  const samplePageNums = [1, 5, 10, 15, 20, 25].filter((p) => p <= pdfDoc.numPages);
  const pageSamples = [];
  for (const pageNum of samplePageNums) {
    const text = await getActivePageText(pageNum);
    if (text.trim()) {
      pageSamples.push({ pageNum, text: text.slice(0, 600) });
    }
  }
  if (pageSamples.length === 0) return [];

  try {
    const resp = await fetch("/api/ai/extract-outline", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bookTitle: docTitle, pageSamples }),
    });
    if (!resp.ok) return [];
    const data = await resp.json();
    const outline = data.outline || [];
    return outline.map((item) => ({
      title: item.title,
      pageNum: item.pageNum,
      depth: 0,
      items: [],
    }));
  } catch (err) {
    console.warn("AI outline extraction failed:", err);
    return [];
  }
}

async function fetchCachedOutline(id) {
  try {
    const resp = await fetch(`/api/books/${encodeURIComponent(id)}/outline`);
    if (!resp.ok) return null;
    const data = await resp.json();
    return data.outline || null;
  } catch (err) {
    console.warn("Could not fetch cached outline:", err);
    return null;
  }
}

async function saveCachedOutline(id, outline) {
  await fetch(`/api/books/${encodeURIComponent(id)}/outline`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ outline }),
  });
}

async function parseOutlineItems(items, depth = 0) {
  const list = [];
  for (const item of items) {
    let pageNum = null;
    try {
      let dest = item.dest;
      if (typeof dest === "string") {
        dest = await pdfDoc.getDestination(dest);
      }
      if (Array.isArray(dest)) {
        const pageRef = dest[0];
        if (pageRef && typeof pageRef === "object") {
          const pageIndex = await pdfDoc.getPageIndex(pageRef);
          pageNum = pageIndex + 1;
        }
      } else if (typeof dest === "number") {
        pageNum = dest + 1;
      }
    } catch (e) {
      console.warn("Error parsing destination for outline item:", item.title, e);
    }

    const node = {
      title: item.title,
      pageNum: pageNum,
      depth: depth,
      items: []
    };

    if (item.items && item.items.length > 0) {
      node.items = await parseOutlineItems(item.items, depth + 1);
    }
    list.push(node);
  }
  return list;
}

async function scanForChaptersFallback() {
  const headings = [];
  const maxPages = Math.min(pdfDoc.numPages, 50);

  for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
    try {
      const page = await pdfDoc.getPage(pageNum);
      const textContent = await page.getTextContent();
      const items = textContent.items;
      if (!items || items.length === 0) continue;

      // Group items by vertical offset
      const yMap = new Map();
      items.forEach((item) => {
        if (!item.str || !item.str.trim()) return;
        const y = Math.round(item.transform[5]);
        if (!yMap.has(y)) {
          yMap.set(y, []);
        }
        yMap.get(y).push(item);
      });

      const sortedY = Array.from(yMap.keys()).sort((a, b) => b - a);
      const lines = [];
      for (let i = 0; i < Math.min(sortedY.length, 10); i++) {
        const y = sortedY[i];
        const lineItems = yMap.get(y).sort((a, b) => a.transform[4] - b.transform[4]);
        const lineText = lineItems.map((item) => item.str).join(" ").trim();
        if (lineText) {
          lines.push(lineText);
        }
      }

      const headingRegex = /^(?:chapter|lesson|unit|section|part|introduction|preface|foreword|contents)\b/i;

      for (const line of lines) {
        const cleaned = line.trim();
        if (cleaned.length < 3 || cleaned.length > 80) continue;
        if (/EBS Topics/i.test(cleaned) || /^Page\s*\d*$/i.test(cleaned)) continue;

        if (headingRegex.test(cleaned)) {
          if (!headings.some((h) => h.pageNum === pageNum)) {
            headings.push({
              title: cleaned,
              pageNum: pageNum,
              depth: 0,
              items: []
            });
          }
          break;
        }
      }
    } catch (err) {
      console.warn(`Error scanning page ${pageNum} for chapters fallback:`, err);
    }
  }
  return headings;
}

function flattenOutline(nodes) {
  const flat = [];
  function traverse(items) {
    items.forEach((item) => {
      if (item.pageNum) {
        flat.push({
          title: item.title,
          pageNum: item.pageNum
        });
      }
      if (item.items && item.items.length > 0) {
        traverse(item.items);
      }
    });
  }
  traverse(nodes);
  flat.sort((a, b) => a.pageNum - b.pageNum);

  const uniqueFlat = [];
  const seenPages = new Set();
  flat.forEach((item) => {
    if (!seenPages.has(item.pageNum)) {
      seenPages.add(item.pageNum);
      uniqueFlat.push(item);
    }
  });
  return uniqueFlat;
}

function renderOutlineNodes(nodes, containerEl) {
  containerEl.innerHTML = "";
  if (!nodes || nodes.length === 0) {
    containerEl.innerHTML = `<div class="chapters-empty">No chapters found.</div>`;
    return;
  }

  const fragment = document.createDocumentFragment();

  function renderTree(items, depth = 0) {
    items.forEach((item) => {
      const div = document.createElement("div");
      div.className = "chapter-item";

      const a = document.createElement("a");
      a.className = "chapter-link";
      if (depth > 0) {
        a.classList.add("sub-item");
        a.style.paddingLeft = `${0.75 + depth * 0.75}rem`;
      }
      if (item.pageNum) {
        a.dataset.pageNum = item.pageNum;
      }

      const titleSpan = document.createElement("span");
      titleSpan.textContent = item.title;
      a.appendChild(titleSpan);

      if (item.pageNum) {
        const pageSpan = document.createElement("span");
        pageSpan.className = "chapter-page";
        pageSpan.textContent = `p. ${item.pageNum}`;
        a.appendChild(pageSpan);

        a.addEventListener("click", (e) => {
          e.preventDefault();
          scrollToPage(item.pageNum);
        });
      }

      div.appendChild(a);
      fragment.appendChild(div);

      if (item.items && item.items.length > 0) {
        renderTree(item.items, depth + 1);
      }
    });
  }

  renderTree(nodes);
  containerEl.appendChild(fragment);
}

// --- Page Bookmarks (localStorage) ---
const BOOKMARKS_PREFIX = "elibrary_bookmarks_";
const bookmarkToggleBtn = document.getElementById("bookmark-toggle");
let bookmarks = [];

function bookmarksStorageKey() {
  if (bookId) return `${BOOKMARKS_PREFIX}${bookId}`;
  if (fileUrl) return `${BOOKMARKS_PREFIX}${encodeURIComponent(fileUrl)}`;
  return null;
}

function loadBookmarks() {
  const key = bookmarksStorageKey();
  if (!key) {
    bookmarks = [];
    return;
  }
  try {
    const raw = localStorage.getItem(key);
    bookmarks = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(bookmarks)) bookmarks = [];
  } catch {
    bookmarks = [];
  }
}

function saveBookmarks(list) {
  const key = bookmarksStorageKey();
  if (!key) return;
  bookmarks = list;
  localStorage.setItem(key, JSON.stringify(list));
}

function isPageBookmarked(pageNum) {
  return bookmarks.some((b) => b.pageNum === pageNum);
}

async function getBookmarkLabel(pageNum) {
  const text = await getActivePageText(pageNum);
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (!cleaned) return `Page ${pageNum}`;
  return cleaned.slice(0, 60) + (cleaned.length > 60 ? "…" : "");
}

async function toggleBookmark(pageNum = currentPage) {
  if (!pdfDoc) return;
  const existing = bookmarks.findIndex((b) => b.pageNum === pageNum);
  if (existing >= 0) {
    bookmarks.splice(existing, 1);
  } else {
    const label = await getBookmarkLabel(pageNum);
    bookmarks.push({ pageNum, label, addedAt: Date.now() });
    bookmarks.sort((a, b) => a.pageNum - b.pageNum);
  }
  saveBookmarks(bookmarks);
  renderBookmarksList();
  updateBookmarkButtonState();
}

function updateBookmarkButtonState() {
  if (!bookmarkToggleBtn) return;
  bookmarkToggleBtn.classList.toggle("bookmarked", isPageBookmarked(currentPage));
  bookmarkToggleBtn.title = isPageBookmarked(currentPage)
    ? "Remove bookmark"
    : "Bookmark this page";
}

function renderBookmarksList() {
  const listEl = document.getElementById("bookmarks-list");
  if (!listEl) return;

  if (bookmarks.length === 0) {
    listEl.innerHTML = `<div class="chapters-empty">No bookmarks yet. Click 🔖 to bookmark a page.</div>`;
    return;
  }

  listEl.innerHTML = "";
  const fragment = document.createDocumentFragment();

  bookmarks.forEach((bm) => {
    const item = document.createElement("div");
    item.className = "bookmark-item";

    const mainBtn = document.createElement("button");
    mainBtn.type = "button";
    mainBtn.className = "bookmark-main";
    mainBtn.addEventListener("click", () => {
      scrollToPage(bm.pageNum);
      setSidebarOpen(false);
    });

    const labelSpan = document.createElement("span");
    labelSpan.className = "bookmark-label";
    labelSpan.textContent = bm.label || `Page ${bm.pageNum}`;

    const pageSpan = document.createElement("span");
    pageSpan.className = "bookmark-page";
    pageSpan.textContent = `p. ${bm.pageNum}`;

    mainBtn.appendChild(labelSpan);
    mainBtn.appendChild(pageSpan);

    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "bookmark-del-btn";
    delBtn.title = "Remove bookmark";
    delBtn.textContent = "×";
    delBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      bookmarks = bookmarks.filter((b) => b.pageNum !== bm.pageNum);
      saveBookmarks(bookmarks);
      renderBookmarksList();
      updateBookmarkButtonState();
    });

    item.appendChild(mainBtn);
    item.appendChild(delBtn);
    fragment.appendChild(item);
  });

  listEl.appendChild(fragment);
}

bookmarkToggleBtn?.addEventListener("click", () => {
  toggleBookmark(currentPage);
});

// --- In-Book Text Search ---
const bookSearchInput = document.getElementById("book-search-input");
const bookSearchBtn = document.getElementById("book-search-btn");
const searchResultsList = document.getElementById("search-results-list");
let searchAbortController = null;
let searchResultCount = 0;

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildSnippet(text, matchIndex, queryLen) {
  const start = Math.max(0, matchIndex - 40);
  const end = Math.min(text.length, matchIndex + queryLen + 40);
  let snippet = text.slice(start, end);
  if (start > 0) snippet = "…" + snippet;
  if (end < text.length) snippet = snippet + "…";
  return snippet;
}

function highlightSnippet(snippet, query) {
  const regex = new RegExp(`(${escapeRegex(query)})`, "gi");
  return snippet.replace(regex, '<span class="search-match">$1</span>');
}

function renderSearchResult(hit, query) {
  if (!searchResultsList) return;
  if (searchResultCount === 0) {
    searchResultsList.innerHTML = "";
  }
  searchResultCount += 1;

  const item = document.createElement("div");
  item.className = "search-result-item";
  item.innerHTML = `
    <span class="search-result-page">Page ${hit.pageNum}</span>
    <span class="search-snippet">${highlightSnippet(hit.snippet, query)}</span>
  `;
  item.addEventListener("click", () => {
    highlightSearchMatch(hit.pageNum, query);
    setSidebarOpen(false);
  });
  searchResultsList.appendChild(item);
}

async function* searchBook(query) {
  if (!pdfDoc || !query.trim()) return;
  const regex = new RegExp(escapeRegex(query.trim()), "gi");
  const batchSize = 10;

  for (let start = 1; start <= pdfDoc.numPages; start += batchSize) {
    if (searchAbortController?.signal.aborted) return;
    const end = Math.min(start + batchSize - 1, pdfDoc.numPages);

    for (let pageNum = start; pageNum <= end; pageNum++) {
      if (searchAbortController?.signal.aborted) return;
      try {
        const page = await pdfDoc.getPage(pageNum);
        const textContent = await page.getTextContent();
        const text = textContent.items.map((item) => item.str).join(" ");
        const match = regex.exec(text);
        regex.lastIndex = 0;
        if (match) {
          yield {
            pageNum,
            snippet: buildSnippet(text, match.index, query.trim().length),
            matchIndex: match.index,
          };
        }
      } catch (err) {
        console.warn(`Search error on page ${pageNum}:`, err);
      }
    }
  }
}

async function highlightSearchMatch(pageNum, query) {
  scrollToPage(pageNum);
  const pageDiv = pageContainers[pageNum - 1];
  if (!pageDiv) return;

  if (!renderedPages.has(pageNum)) {
    renderedPages.add(pageNum);
    await renderPage(pageNum, pageDiv);
  } else {
    ensurePageRangeRendered(pageNum);
  }

  const spans = pageDiv.querySelectorAll(".textLayer span");
  const regex = new RegExp(escapeRegex(query.trim()), "i");
  let highlighted = false;

  spans.forEach((span) => {
    span.classList.remove("search-match-highlight");
    if (!highlighted && regex.test(span.textContent || "")) {
      span.classList.add("search-match-highlight");
      span.scrollIntoView({ behavior: "smooth", block: "center" });
      highlighted = true;
      setTimeout(() => span.classList.remove("search-match-highlight"), 4000);
    }
  });
}

async function runBookSearch() {
  const query = (bookSearchInput?.value || "").trim();
  if (!query || !pdfDoc) return;

  if (searchAbortController) {
    searchAbortController.abort();
  }
  searchAbortController = new AbortController();
  searchResultCount = 0;

  if (searchResultsList) {
    searchResultsList.innerHTML = `<div class="chapters-empty"><div class="spinner" style="width:24px;height:24px;border-width:3px;margin:0 auto 0.5rem;"></div>Searching…</div>`;
  }
  if (bookSearchBtn) {
    bookSearchBtn.textContent = "Cancel";
    bookSearchBtn.disabled = false;
  }

  let count = 0;
  try {
    for await (const hit of searchBook(query)) {
      if (searchAbortController.signal.aborted) break;
      if (count === 0 && searchResultsList) {
        searchResultsList.innerHTML = `<div class="search-count-badge">Searching…</div>`;
      }
      renderSearchResult(hit, query);
      count += 1;
    }
  } catch (err) {
    if (err.name !== "AbortError") console.error("Search failed:", err);
  }

  const badge = searchResultsList?.querySelector(".search-count-badge");
  if (badge) {
    badge.textContent = count === 0
      ? "No results found."
      : `${count} result${count === 1 ? "" : "s"} found`;
  } else if (count === 0 && searchResultsList) {
    searchResultsList.innerHTML = `<div class="chapters-empty">No results found.</div>`;
  }

  if (bookSearchBtn) bookSearchBtn.textContent = "Search";
  searchAbortController = null;
}

bookSearchBtn?.addEventListener("click", () => {
  if (searchAbortController) {
    searchAbortController.abort();
    if (bookSearchBtn) bookSearchBtn.textContent = "Search";
    searchAbortController = null;
    return;
  }
  runBookSearch();
});

bookSearchInput?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    if (!searchAbortController) runBookSearch();
  }
});

// --- Mobile sidebar: swipe-to-close & drag-to-resize ---
if (aiSidebar) {
  let touchStartX = 0;
  let touchStartY = 0;
  let touchStartTime = 0;
  let isDraggingSheet = false;
  let dragStartY = 0;
  let dragStartHeightVh = 60;

  const dragHandle = aiSidebar.querySelector(".drag-handle");

  aiSidebar.addEventListener("touchstart", (e) => {
    if (aiSidebar.classList.contains("collapsed")) return;
    const touch = e.touches[0];
    touchStartX = touch.clientX;
    touchStartY = touch.clientY;
    touchStartTime = Date.now();
  }, { passive: true });

  aiSidebar.addEventListener("touchmove", (e) => {
    if (aiSidebar.classList.contains("collapsed") || !isMobileSidebar()) return;

    if (isDraggingSheet && dragHandle) {
      const touch = e.touches[0];
      const deltaY = dragStartY - touch.clientY;
      const deltaVh = (deltaY / window.innerHeight) * 100;
      mobileSheetHeightVh = Math.min(90, Math.max(40, dragStartHeightVh + deltaVh));
      aiSidebar.style.height = `${mobileSheetHeightVh}vh`;
      e.preventDefault();
    }
  }, { passive: false });

  aiSidebar.addEventListener("touchend", (e) => {
    if (aiSidebar.classList.contains("collapsed")) return;

    if (isDraggingSheet) {
      isDraggingSheet = false;
      return;
    }

    const touch = e.changedTouches[0];
    const deltaX = touch.clientX - touchStartX;
    const deltaY = touch.clientY - touchStartY;
    const elapsed = Date.now() - touchStartTime;

    if (elapsed > 500) return;

    if (isMobileSidebar()) {
      if (deltaY > 60 && Math.abs(deltaY) > Math.abs(deltaX)) {
        setSidebarOpen(false);
      }
    } else if (window.matchMedia("(max-width: 768px)").matches) {
      if (deltaX > 60 && Math.abs(deltaX) > Math.abs(deltaY)) {
        setSidebarOpen(false);
      }
    }
  }, { passive: true });

  dragHandle?.addEventListener("touchstart", (e) => {
    if (!isMobileSidebar() || aiSidebar.classList.contains("collapsed")) return;
    isDraggingSheet = true;
    dragStartY = e.touches[0].clientY;
    dragStartHeightVh = mobileSheetHeightVh;
    e.stopPropagation();
  }, { passive: true });

  dragHandle?.addEventListener("touchend", () => {
    isDraggingSheet = false;
  }, { passive: true });
}

