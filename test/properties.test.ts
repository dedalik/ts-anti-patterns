// Property-based tests. We treat fast-check as a generator of inputs and
// assert mathematical invariants the implementation must respect - not
// hand-written specific cases, which the other test files already cover.

import { describe, it } from "vitest"
import fc from "fast-check"
import { analyzeFile } from "../src/complexity.js"
import { computeCrap, severityOf, scoreOf } from "../src/score.js"
import { sortEntries } from "../src/report/human.js"
import type { CrapEntry } from "../src/options.js"

describe("property: CRAP formula", () => {
  it("monotonic in CC at fixed coverage", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 50 }),
        fc.integer({ min: 1, max: 50 }),
        fc.float({ min: Math.fround(0), max: Math.fround(100), noNaN: true }),
        (cc1, delta, cov) => {
          const cc2 = cc1 + delta
          return computeCrap(cc1, cov) <= computeCrap(cc2, cov)
        }
      ),
      { numRuns: 200 }
    )
  })

  it("monotonic decreasing in coverage at fixed CC", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 50 }),
        fc.float({ min: Math.fround(0), max: Math.fround(99), noNaN: true }),
        fc.float({ min: Math.fround(0.1), max: Math.fround(1), noNaN: true }),
        (cc, cov, delta) => {
          const higher = Math.min(100, cov + delta)
          return computeCrap(cc, higher) <= computeCrap(cc, cov) + 1e-9
        }
      ),
      { numRuns: 200 }
    )
  })

  it("CRAP at 100% always equals CC", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 100 }), (cc) => {
        return Math.abs(computeCrap(cc, 100) - cc) < 1e-9
      })
    )
  })
})

describe("property: scoreOf consistency", () => {
  it("scoreOf with null coverage matches CC and mode is cc", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 100 }), (cc) => {
        const r = scoreOf({ complexity: cc }, null)
        return r.mode === "cc" && r.score === cc
      })
    )
  })
})

describe("property: severity bands", () => {
  it("severity is monotonic in score for fixed threshold", () => {
    const order = { ok: 0, info: 1, warning: 2, error: 3 } as const
    fc.assert(
      fc.property(
        fc.float({ min: Math.fround(0), max: Math.fround(200), noNaN: true }),
        fc.float({ min: Math.fround(0), max: Math.fround(200), noNaN: true }),
        fc.integer({ min: 1, max: 100 }),
        (a, b, t) => {
          const lo = Math.min(a, b)
          const hi = Math.max(a, b)
          return order[severityOf(lo, t)] <= order[severityOf(hi, t)]
        }
      ),
      { numRuns: 200 }
    )
  })
})

describe("property: stable sort", () => {
  it("sort is a permutation that preserves length", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            score: fc.float({ min: Math.fround(0), max: Math.fround(200), noNaN: true }),
            file: fc.string({ minLength: 1, maxLength: 12 }),
            line: fc.integer({ min: 1, max: 10_000 }),
          }),
          { minLength: 0, maxLength: 50 }
        ),
        (rows) => {
          const entries = rows.map(asEntry)
          const sorted = sortEntries(entries)
          return sorted.length === entries.length
        }
      )
    )
  })

  it("sort is idempotent", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            score: fc.float({ min: Math.fround(0), max: Math.fround(200), noNaN: true }),
            file: fc.string({ minLength: 1, maxLength: 12 }),
            line: fc.integer({ min: 1, max: 10_000 }),
          }),
          { minLength: 0, maxLength: 30 }
        ),
        (rows) => {
          const entries = rows.map(asEntry)
          const once = sortEntries(entries)
          const twice = sortEntries(once)
          for (let i = 0; i < once.length; i++) {
            if (once[i]!.score !== twice[i]!.score) return false
            if (once[i]!.file !== twice[i]!.file) return false
            if (once[i]!.line !== twice[i]!.line) return false
          }
          return true
        }
      )
    )
  })
})

describe("property: complexity has known shape", () => {
  it("never returns NaN/Infinity for valid TS source", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 8 }),
        fc.integer({ min: 0, max: 8 }),
        (ifs, loops) => {
          const src = synthesizeFunction(ifs, loops)
          const out = analyzeFile(src, "synth.ts", {
            cognitive: true,
            countNullishCoalescing: false,
          })
          if (out.length !== 1) return false
          const m = out[0]!
          return Number.isFinite(m.complexity) && Number.isFinite(m.cognitive)
        }
      ),
      { numRuns: 50 }
    )
  })

  it("CC of N flat ifs (no else) equals 1 + N", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 12 }), (n) => {
        const src = synthesizeFunction(n, 0)
        const m = analyzeFile(src, "synth.ts", {
          cognitive: true,
          countNullishCoalescing: false,
        })[0]!
        return m.complexity === 1 + n
      })
    )
  })
})

function synthesizeFunction(ifs: number, loops: number): string {
  const parts: string[] = []
  parts.push("export function f(x: number): number {")
  parts.push("  let r = 0")
  for (let i = 0; i < ifs; i++) {
    parts.push(`  if (x === ${i}) r++`)
  }
  for (let i = 0; i < loops; i++) {
    parts.push(`  for (let i = 0; i < x; i++) r++`)
  }
  parts.push("  return r")
  parts.push("}")
  return parts.join("\n")
}

function asEntry(
  r: { score: number; file: string; line: number }
): CrapEntry {
  return {
    file: r.file,
    function: "fn",
    line: r.line,
    endLine: r.line,
    complexity: Math.floor(r.score),
    cognitive: 0,
    sloc: 0,
    coverage: null,
    coverageKind: null,
    confidence: "none",
    score: r.score,
    mode: "cc",
    severity: "ok",
  }
}
