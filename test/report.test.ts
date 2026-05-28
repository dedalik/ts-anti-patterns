import { describe, it, expect } from "vitest"
import { sortEntries } from "../src/report/human.js"
import type { CrapEntry } from "../src/options.js"

function entry(partial: Partial<CrapEntry> & { score: number; file: string; line: number }): CrapEntry {
  return {
    file: partial.file,
    function: partial.function ?? "fn",
    line: partial.line,
    endLine: partial.endLine ?? partial.line,
    complexity: partial.complexity ?? partial.score,
    cognitive: partial.cognitive ?? 0,
    sloc: partial.sloc ?? 0,
    coverage: partial.coverage ?? null,
    coverageKind: partial.coverageKind ?? null,
    confidence: partial.confidence ?? "none",
    score: partial.score,
    mode: partial.mode ?? "cc",
    severity: partial.severity ?? "ok",
  }
}

describe("stable sort", () => {
  it("sorts by score descending", () => {
    const input = [
      entry({ score: 5, file: "a.ts", line: 1 }),
      entry({ score: 50, file: "b.ts", line: 1 }),
      entry({ score: 10, file: "c.ts", line: 1 }),
    ]
    const sorted = sortEntries(input)
    expect(sorted.map((e) => e.score)).toEqual([50, 10, 5])
  })

  it("breaks ties by file ascending, then line ascending", () => {
    const input = [
      entry({ score: 10, file: "z.ts", line: 5 }),
      entry({ score: 10, file: "a.ts", line: 200 }),
      entry({ score: 10, file: "a.ts", line: 5 }),
      entry({ score: 10, file: "m.ts", line: 1 }),
    ]
    const sorted = sortEntries(input)
    expect(sorted.map((e) => `${e.file}:${e.line}`)).toEqual([
      "a.ts:5",
      "a.ts:200",
      "m.ts:1",
      "z.ts:5",
    ])
  })

  it("is idempotent - sorting twice yields the same order", () => {
    const input = [
      entry({ score: 5, file: "a.ts", line: 1 }),
      entry({ score: 50, file: "b.ts", line: 1 }),
      entry({ score: 10, file: "c.ts", line: 1 }),
    ]
    const once = sortEntries(input)
    const twice = sortEntries(once)
    expect(twice).toEqual(once)
  })

  it("does not mutate the input array", () => {
    const input = [
      entry({ score: 1, file: "a.ts", line: 1 }),
      entry({ score: 2, file: "b.ts", line: 1 }),
    ]
    const original = [...input]
    sortEntries(input)
    expect(input).toEqual(original)
  })
})
