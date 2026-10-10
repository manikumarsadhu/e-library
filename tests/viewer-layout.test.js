import test from "node:test";
import assert from "node:assert/strict";

// Helper functions mirroring viewer layout logic
function computeSpreads(numPages, separateCover) {
  const spreads = [];
  let p = 1;

  if (separateCover && numPages >= 1) {
    spreads.push([1]);
    p = 2;
  }

  while (p <= numPages) {
    const pair = [p];
    p += 1;
    if (p <= numPages) {
      pair.push(p);
      p += 1;
    }
    spreads.push(pair);
  }

  return spreads;
}

function clampPageNumber(val, numPages) {
  const parsed = parseInt(val, 10);
  if (isNaN(parsed)) return 1;
  return Math.min(Math.max(parsed, 1), numPages);
}

function getNavigationStep(currentPage, viewMode, separateCover) {
  if (viewMode === "two" && (currentPage > 1 || !separateCover)) {
    return 2;
  }
  return 1;
}

test("computeSpreads groups pages with separate cover", () => {
  const spreads = computeSpreads(5, true);
  assert.deepEqual(spreads, [
    [1],
    [2, 3],
    [4, 5],
  ]);
});

test("computeSpreads groups pages without separate cover", () => {
  const spreads = computeSpreads(5, false);
  assert.deepEqual(spreads, [
    [1, 2],
    [3, 4],
    [5],
  ]);
});

test("clampPageNumber properly clamps within 1..numPages", () => {
  assert.equal(clampPageNumber("0", 10), 1);
  assert.equal(clampPageNumber("-5", 10), 1);
  assert.equal(clampPageNumber("5", 10), 5);
  assert.equal(clampPageNumber("15", 10), 10);
  assert.equal(clampPageNumber("invalid", 10), 1);
});

test("getNavigationStep handles single and two-page mode properly", () => {
  // Single page mode always steps by 1
  assert.equal(getNavigationStep(1, "single", true), 1);
  assert.equal(getNavigationStep(5, "single", true), 1);

  // Two page mode with separate cover: page 1 steps by 1 to reach spread [2,3]
  assert.equal(getNavigationStep(1, "two", true), 1);
  // Two page mode with separate cover: page 2 steps by 2 to reach spread [4,5]
  assert.equal(getNavigationStep(2, "two", true), 2);
  assert.equal(getNavigationStep(4, "two", true), 2);

  // Two page mode without separate cover: steps by 2 from the start
  assert.equal(getNavigationStep(1, "two", false), 2);
});
