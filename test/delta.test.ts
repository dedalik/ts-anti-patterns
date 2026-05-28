// Baseline diff: every category (unchanged / improved / regression / new /
// removed / moved) must be correctly classified, and epsilon must absorb
// floating-point noise without hiding real changes.

import { describe, it, expect } from "vitest"
import { diff, loadBaseline } from "../src/delta.js"
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

describe("diff()", () => {
  it("classifies unchanged within epsilon", () => {
    const b = [mk({ function: "a", score: 10 })]
    const c = [mk({ function: "a", score: 10.005 })]
    const { rows, summary } = diff(c, b, { epsilon: 0.01 })
    expect(summary).toMatchObject({ unchanged: 1, regression: 0, improved: 0 })
    expect(rows[0]!.kind).toBe("unchanged")
  })

  it("classifies a real bump above epsilon as a regression", () => {
    const b = [mk({ function: "a", score: 10 })]
    const c = [mk({ function: "a", score: 30 })]
    const { summary } = diff(c, b, { epsilon: 0.01 })
    expect(summary.regression).toBe(1)
  })

  it("classifies a drop above epsilon as an improvement", () => {
    const b = [mk({ function: "a", score: 30 })]
    const c = [mk({ function: "a", score: 10 })]
    const { summary } = diff(c, b, { epsilon: 0.01 })
    expect(summary.improved).toBe(1)
  })

  it("flags brand-new functions", () => {
    const b = [mk({ function: "a", score: 10 })]
    const c = [mk({ function: "a", score: 10 }), mk({ function: "b", line: 50, score: 20 })]
    const { summary, rows } = diff(c, b, { epsilon: 0.01 })
    expect(summary.new).toBe(1)
    expect(rows.find((r) => r.kind === "new")?.current?.function).toBe("b")
  })

  it("flags removed functions", () => {
    const b = [mk({ function: "a" }), mk({ function: "old", line: 80 })]
    const c = [mk({ function: "a" })]
    const { summary, rows } = diff(c, b, { epsilon: 0.01 })
    expect(summary.removed).toBe(1)
    expect(rows.find((r) => r.kind === "removed")?.baseline?.function).toBe("old")
  })

  it("recognises a function moved across files", () => {
    const b = [mk({ function: "moved", file: "src/old.ts", line: 12 })]
    const c = [mk({ function: "moved", file: "src/new.ts", line: 12 })]
    const { summary, rows } = diff(c, b, { epsilon: 0.01 })
    expect(summary.moved).toBe(1)
    expect(rows[0]!.kind).toBe("moved")
  })

  it("absorbs +/- 4 line drift in the same file", () => {
    const b = [mk({ function: "f", file: "src/a.ts", line: 10 })]
    const c = [mk({ function: "f", file: "src/a.ts", line: 13 })]
    const { rows } = diff(c, b, { epsilon: 0.01 })
    // Same name+file, line drifted by 3 → counts as the same function
    // but the location differs, so it's "moved".
    expect(rows[0]!.kind).toBe("moved")
    expect(rows[0]!.baseline?.line).toBe(10)
  })

  it("regression rows sort first; |delta| sorts within a bucket", () => {
    const b = [
      mk({ function: "a", line: 1, score: 5 }),
      mk({ function: "b", line: 2, score: 5 }),
    ]
    const c = [
      mk({ function: "a", line: 1, score: 8 }),
      mk({ function: "b", line: 2, score: 20 }),
    ]
    const { rows } = diff(c, b, { epsilon: 0.01 })
    expect(rows[0]!.kind).toBe("regression")
    expect(rows[0]!.current?.function).toBe("b")
    expect(rows[1]!.current?.function).toBe("a")
  })
})

describe("loadBaseline()", () => {
  it("parses a JSON envelope", () => {
    const text = JSON.stringify({
      entries: [{ file: "src/a.ts", function: "f", line: 10, score: 12 }],
    })
    const out = loadBaseline(text)
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ file: "src/a.ts", function: "f", line: 10, score: 12 })
  })

  it("returns [] on garbage", () => {
    expect(loadBaseline("this is not json")).toEqual([])
    expect(loadBaseline("{}")).toEqual([])
    expect(loadBaseline(JSON.stringify({ entries: [{ wrong: true }] }))).toEqual([])
  })
})
