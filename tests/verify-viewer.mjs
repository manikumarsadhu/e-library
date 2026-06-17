/**
 * Browser verification for viewer enhancements.
 * Run: node tests/verify-viewer.mjs
 */
import { chromium } from "playwright";

const BOOK_ID = "763819a4-a8eb-4d6f-9c0a-b5d42f3ba936";
const FILE_KEY =
  "cloudinary:image:e-library/files/763819a4-a8eb-4d6f-9c0a-b5d42f3ba936_16e3f03d-c3df-4965-bc2d-9aa3e7de0798:https://res.cloudinary.com/dse3p5amy/image/upload/v1781619694/e-library/files/763819a4-a8eb-4d6f-9c0a-b5d42f3ba936_16e3f03d-c3df-4965-bc2d-9aa3e7de0798.pdf";
const TITLE = "100 Bible Lessons";
const BASE = "http://localhost:3000";
const file = `${BASE}/api/files/${encodeURIComponent(FILE_KEY)}`;
const viewerUrl = `${BASE}/viewer.html?file=${encodeURIComponent(file)}&title=${encodeURIComponent(TITLE)}&id=${encodeURIComponent(BOOK_ID)}`;

const results = [];

function log(name, pass, detail = "") {
  results.push({ name, pass, detail });
  const mark = pass ? "PASS" : "FAIL";
  console.log(`[${mark}] ${name}${detail ? ` — ${detail}` : ""}`);
}

async function waitForPdfReady(page, timeout = 120_000) {
  await page.waitForFunction(
    () => {
      const loading = document.getElementById("loading");
      const pages = document.getElementById("doc-pages");
      return !loading && pages && !pages.textContent.includes("- / -");
    },
    { timeout }
  );
}

async function openSidebar(page) {
  await page.click("#ai-toggle");
  await page.waitForSelector("#ai-sidebar:not(.collapsed)", { timeout: 5000 });
}

async function waitChaptersReady(page, timeout = 120_000) {
  await page.waitForFunction(
    () => {
      const empty = document.querySelector("#chapters-list .chapters-empty");
      if (!empty) return document.querySelectorAll("#chapters-list .chapter-link").length > 0;
      const t = empty.textContent || "";
      return !t.includes("Analyzing");
    },
    { timeout }
  );
}

async function dismissResumeToast(page) {
  const toast = page.locator("#resume-toast:not(.hidden)");
  if (await toast.isVisible().catch(() => false)) {
    await page.click("#resume-no");
  }
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
const page = await context.newPage();
page.on("dialog", (d) => d.accept());

try {
  // --- Feature 1: Outline DB caching ---
  const outlineCalls = [];
  page.on("request", (req) => {
    if (req.url().includes("/outline")) {
      outlineCalls.push({ method: req.method(), url: req.url() });
    }
  });

  await page.goto(viewerUrl, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await waitForPdfReady(page);
  await dismissResumeToast(page);
  await openSidebar(page);
  await waitChaptersReady(page);

  const chapterCount1 = await page.locator("#chapters-list .chapter-link").count();
  const hadPatch = outlineCalls.some((c) => c.method === "PATCH");
  log(
    "Feature 1a: First load generates chapters",
    chapterCount1 > 0,
    `${chapterCount1} chapters, PATCH saved: ${hadPatch}`
  );

  // Second visit — should load from cache instantly
  outlineCalls.length = 0;
  const page2 = await context.newPage();
  page2.on("dialog", (d) => d.accept());
  page2.on("request", (req) => {
    if (req.url().includes("/outline")) {
      outlineCalls.push({ method: req.method(), url: req.url() });
    }
  });

  const t0 = Date.now();
  await page2.goto(viewerUrl, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await waitForPdfReady(page2);
  await dismissResumeToast(page2);
  await page2.click("#ai-toggle");
  await page2.waitForSelector("#ai-sidebar:not(.collapsed)");

  const analyzingVisible = await page2
    .locator("#chapters-list .chapters-empty")
    .filter({ hasText: "Analyzing" })
    .isVisible()
    .catch(() => false);

  await page2.waitForFunction(
    () => document.querySelectorAll("#chapters-list .chapter-link").length > 0,
    { timeout: 10_000 }
  );
  const elapsed = Date.now() - t0;
  const hadGet = outlineCalls.some((c) => c.method === "GET");
  const chapterCount2 = await page2.locator("#chapters-list .chapter-link").count();

  log(
    "Feature 1b: Second load uses cached outline",
    hadGet && chapterCount2 > 0 && !analyzingVisible,
    `GET outline: ${hadGet}, chapters: ${chapterCount2}, no Analyzing: ${!analyzingVisible}, ${elapsed}ms`
  );

  // --- Feature 2: Refresh chapters ---
  const refreshOutlineCalls = [];
  page2.on("request", (req) => {
    if (req.url().includes("/outline")) {
      refreshOutlineCalls.push({ method: req.method(), url: req.url() });
    }
  });
  await page2.click("#tab-chapters");
  await page2.click("#refresh-chapters-btn");
  await page2.waitForFunction(
    () => {
      const btn = document.getElementById("refresh-chapters-btn");
      return btn && !btn.classList.contains("spinning");
    },
    { timeout: 120_000 }
  );
  const afterRefresh = await page2.locator("#chapters-list .chapter-link").count();
  const hadClearPatch = refreshOutlineCalls.some((c) => c.method === "PATCH");
  log(
    "Feature 2: Refresh re-scans chapters",
    afterRefresh > 0 && hadClearPatch,
    `${afterRefresh} chapters after refresh`
  );

  // --- Feature 3: Bookmarks ---
  await page2.click("#bookmark-toggle");
  await page2.waitForTimeout(500);
  const bookmarked = await page2.evaluate(
    (id) => localStorage.getItem(`elibrary_bookmarks_${id}`),
    BOOK_ID
  );
  const hasBookmark = bookmarked && JSON.parse(bookmarked).length > 0;
  const btnHighlighted = await page2.locator("#bookmark-toggle.bookmarked").isVisible();
  await page2.click("#tab-bookmarks");
  const bookmarkItems = await page2.locator("#bookmarks-list .bookmark-item").count();
  log(
    "Feature 3: Bookmarks persist in sidebar",
    hasBookmark && btnHighlighted && bookmarkItems > 0,
    `${bookmarkItems} bookmark(s) in list`
  );

  // --- Feature 4: In-book search ---
  await page2.click("#tab-search");
  await page2.fill("#book-search-input", "God");
  await page2.click("#book-search-btn");
  await page2.waitForFunction(
    () => {
      const items = document.querySelectorAll("#search-results-list .search-result-item");
      const empty = document.querySelector("#search-results-list .chapters-empty");
      return items.length > 0 || (empty && empty.textContent.includes("No results"));
    },
    { timeout: 180_000 }
  );
  const searchHits = await page2.locator("#search-results-list .search-result-item").count();
  log(
    "Feature 4: In-book search returns results",
    searchHits > 0,
    `${searchHits} result(s) for "God"`
  );

  // --- Feature 5: AI outline API (smoke test) ---
  const aiResp = await page2.evaluate(async () => {
    const r = await fetch("/api/ai/extract-outline", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        bookTitle: "Test",
        pageSamples: [{ pageNum: 1, text: "Chapter 1: Introduction\nWelcome to the book." }],
      }),
    });
    return { ok: r.ok, status: r.status, data: await r.json() };
  });
  log(
    "Feature 5: AI extract-outline endpoint responds",
    aiResp.ok && Array.isArray(aiResp.data?.outline),
    `status ${aiResp.status}`
  );

  // --- Feature 6: Mobile sidebar ---
  await page2.setViewportSize({ width: 375, height: 812 });
  await page2.click("#tab-chapters");
  await page2.click("#ai-close");
  await page2.waitForSelector("#ai-sidebar.collapsed");
  await page2.click("#ai-toggle");
  await page2.waitForSelector("#sidebar-backdrop.visible", { timeout: 5000 });
  const backdropVisible = await page2.locator("#sidebar-backdrop.visible").isVisible();
  // Tap the dimmed area above the bottom sheet (center click hits the sheet)
  await page2.mouse.click(187, 80);
  await page2.waitForSelector("#ai-sidebar.collapsed", { timeout: 5000 });
  const sidebarClosed = await page2.locator("#ai-sidebar.collapsed").isVisible();
  log(
    "Feature 6: Mobile backdrop opens and closes sidebar",
    backdropVisible && sidebarClosed,
    `backdrop: ${backdropVisible}, closed: ${sidebarClosed}`
  );

  await page2.close();
} catch (err) {
  console.error("Verification error:", err);
  log("Unexpected error", false, err.message);
} finally {
  await browser.close();
}

const passed = results.filter((r) => r.pass).length;
const failed = results.filter((r) => !r.pass).length;
console.log(`\n--- ${passed} passed, ${failed} failed ---`);
process.exit(failed > 0 ? 1 : 0);
