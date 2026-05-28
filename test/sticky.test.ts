// Sticky baseline: save a JSON report, load it back, summarise the delta.

import { describe, it, expect, afterEach } from "vitest"
import { mkdtempSync, rmSync, existsSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { loadSticky, saveSticky, stickyDelta, STICKY_PATH } from "../src/sticky.js"
import type { CrapEntry } from "../src/options.js"

function mk(over: Partial<CrapEntry>): CrapEntry {
  return {
    file: "src/a.ts",
    function: "f",
    line: 10,
    endLine: 20,
    complexity: 5,
    cognitive: 5,
    sloc: 8,
    coverage: null,
    coverageKind: null,
    confidence: "none",
    score: 5,
    mode: "cc",
    severity: "ok",
    ...over,
  }
}

const dirs: string[] = []
function mkDir(): string {
  const d = mkdtempSync(join(tmpdir(), "ts-crap-sticky-"))
  dirs.push(d)
  return d
}

afterEach(() => {
  while (dirs.length) {
    const d = dirs.pop()
    if (d) rmSync(d, { recursive: true, force: true })
  }
})

describe("sticky baseline", () => {
  it("save+load round-trips the JSON envelope", async () => {
    const dir = mkDir()
    const entries = [mk({ function: "f", score: 7 })]
    const envelope = JSON.stringify({ entries })
    await saveSticky(dir, envelope)
    expect(existsSync(join(dir, STICKY_PATH))).toBe(true)
    const loaded = await loadSticky(dir)
    expect(loaded).not.toBeNull()
    expect(loaded![0]).toMatchObject({ function: "f", score: 7 })
  })

  it("loadSticky returns null when the cache file is missing", async () => {
    const dir = mkDir()
    expect(await loadSticky(dir)).toBeNull()
  })

  it("stickyDelta returns null when nothing meaningful changed", () => {
    const baseline = [mk({ function: "f", score: 5 })]
    const current = [mk({ function: "f", score: 5.001 })]
    expect(stickyDelta(current, baseline, 0.01)).toBeNull()
  })

  it("stickyDelta surfaces a real regression", () => {
    const baseline = [mk({ function: "f", score: 5 })]
    const current = [mk({ function: "f", score: 50 })]
    const s = stickyDelta(current, baseline, 0.01)
    expect(s).not.toBeNull()
    expect(s!.regression).toBe(1)
  })

  it("stickyDelta returns null for an empty baseline (no point comparing)", () => {
    expect(stickyDelta([mk({})], [], 0.01)).toBeNull()
  })
})
