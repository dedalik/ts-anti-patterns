import { describe, it, expect } from "vitest"
import { merge } from "../src/merge.js"
import { DEFAULT_OPTIONS, type FunctionMetric, type ResolvedOptions } from "../src/options.js"
import {
  emptyFileCoverage,
  type CoverageMap,
  type FileCoverage,
} from "../src/coverage/types.js"

function makeMetric(over: Partial<FunctionMetric>): FunctionMetric {
  return {
    file: "/proj/src/foo.ts",
    function: "foo",
    line: 10,
    endLine: 20,
    complexity: 5,
    cognitive: 5,
    sloc: 8,
    ...over,
  }
}

function makeOpts(over: Partial<ResolvedOptions> = {}): ResolvedOptions {
  return { ...DEFAULT_OPTIONS, ...over }
}

function makeCoverage(files: Array<[string, FileCoverage]>, format: "lcov" = "lcov"): CoverageMap {
  return {
    files: new Map(files),
    source: { format, path: "test.lcov", hasBranch: true, hasFn: true, hasLine: true },
  }
}

describe("merge - coverage selection priority", () => {
  it("prefers branch coverage when available", () => {
    const fc = emptyFileCoverage()
    fc.fnHitsByLine.set(10, { name: "foo", hits: 5 })
    fc.branchHitsByLine.set(12, [
      { block: 0, branch: 0, taken: 2 },
      { block: 0, branch: 1, taken: 0 },
    ])
    fc.lineHits.set(15, 5)
    const cov = makeCoverage([["/proj/src/foo.ts", fc]])

    const entries = merge({
      metrics: [makeMetric({})],
      coverage: cov,
      options: makeOpts(),
      displayPath: (p) => p,
    })

    expect(entries[0]?.coverageKind).toBe("branch")
    expect(entries[0]?.coverage).toBe(50) // 1 of 2 taken
    expect(entries[0]?.confidence).toBe("exact")
  })

  it("falls back to FN/FNDA when no branch data is in range", () => {
    const fc = emptyFileCoverage()
    fc.fnHitsByLine.set(10, { name: "foo", hits: 3 })
    const cov = makeCoverage([["/proj/src/foo.ts", fc]])

    const entries = merge({
      metrics: [makeMetric({})],
      coverage: cov,
      options: makeOpts(),
      displayPath: (p) => p,
    })

    expect(entries[0]?.coverageKind).toBe("fn")
    expect(entries[0]?.coverage).toBe(100)
    expect(entries[0]?.confidence).toBe("exact")
  })

  it("falls back to line coverage with range confidence", () => {
    const fc = emptyFileCoverage()
    fc.lineHits.set(12, 1)
    fc.lineHits.set(15, 0)
    const cov = makeCoverage([["/proj/src/foo.ts", fc]])

    const entries = merge({
      metrics: [makeMetric({})],
      coverage: cov,
      options: makeOpts(),
      displayPath: (p) => p,
    })

    expect(entries[0]?.coverageKind).toBe("line")
    expect(entries[0]?.coverage).toBe(50)
    expect(entries[0]?.confidence).toBe("range")
  })

  it("ignores branch hits with taken=-1 (uninstrumented)", () => {
    const fc = emptyFileCoverage()
    fc.branchHitsByLine.set(12, [
      { block: 0, branch: 0, taken: -1 },
      { block: 0, branch: 1, taken: -1 },
    ])
    fc.fnHitsByLine.set(10, { name: "foo", hits: 2 })
    const cov = makeCoverage([["/proj/src/foo.ts", fc]])

    const entries = merge({
      metrics: [makeMetric({})],
      coverage: cov,
      options: makeOpts(),
      displayPath: (p) => p,
    })

    // All branches uninstrumented → fall through to FN.
    expect(entries[0]?.coverageKind).toBe("fn")
  })
})

describe("merge - path index", () => {
  it("matches workspace-relative coverage paths to absolute metric paths by suffix", () => {
    const fc = emptyFileCoverage()
    fc.fnHitsByLine.set(10, { name: "foo", hits: 1 })
    const cov = makeCoverage([["src/foo.ts", fc]])

    const entries = merge({
      metrics: [makeMetric({ file: "/proj/src/foo.ts" })],
      coverage: cov,
      options: makeOpts(),
      displayPath: (p) => p,
    })

    expect(entries[0]?.coverageKind).toBe("fn")
    expect(entries[0]?.coverage).toBe(100)
  })

  it("REGRESSION: does NOT resolve relative coverage paths against CWD", () => {
    // Coverage says "foo.ts" (just the basename), metrics say "/somewhere/foo.ts".
    // The wrong implementation would resolve("foo.ts") → process.cwd()/foo.ts,
    // which then doesn't match /somewhere/foo.ts. The right implementation
    // does suffix-match on basename and accepts the join.
    const fc = emptyFileCoverage()
    fc.fnHitsByLine.set(10, { name: "foo", hits: 1 })
    const cov = makeCoverage([["foo.ts", fc]])

    const entries = merge({
      metrics: [makeMetric({ file: "/totally/different/place/foo.ts" })],
      coverage: cov,
      options: makeOpts(),
      displayPath: (p) => p,
    })

    expect(entries[0]?.coverageKind).toBe("fn")
  })

  it("prefers the LONGEST suffix-matching coverage entry on conflicts", () => {
    const fcA = emptyFileCoverage()
    fcA.fnHitsByLine.set(10, { name: "foo", hits: 0 }) // wrong file, just "foo.ts"
    const fcB = emptyFileCoverage()
    fcB.fnHitsByLine.set(10, { name: "foo", hits: 7 }) // right file, longer suffix
    const cov = makeCoverage([
      ["foo.ts", fcA],
      ["src/foo.ts", fcB],
    ])

    const entries = merge({
      metrics: [makeMetric({ file: "/proj/src/foo.ts" })],
      coverage: cov,
      options: makeOpts(),
      displayPath: (p) => p,
    })

    // fcB wins because src/foo.ts is a longer suffix of /proj/src/foo.ts.
    expect(entries[0]?.coverage).toBe(100)
  })

  it("absolute coverage paths use direct canonical lookup", () => {
    const fc = emptyFileCoverage()
    fc.fnHitsByLine.set(10, { name: "foo", hits: 2 })
    const cov = makeCoverage([["/proj/src/foo.ts", fc]])

    const entries = merge({
      metrics: [makeMetric({ file: "/proj/src/foo.ts" })],
      coverage: cov,
      options: makeOpts(),
      displayPath: (p) => p,
    })

    expect(entries[0]?.coverage).toBe(100)
    expect(entries[0]?.coverageKind).toBe("fn")
  })
})

describe("merge - missing-coverage policy", () => {
  it("with no coverage source at all, stays in CC-only mode (no policy applied)", () => {
    const entries = merge({
      metrics: [makeMetric({ complexity: 12 })],
      coverage: null,
      options: makeOpts({ missing: "pessimistic" }),
      displayPath: (p) => p,
    })
    expect(entries[0]?.mode).toBe("cc")
    expect(entries[0]?.coverage).toBeNull()
    expect(entries[0]?.score).toBe(12) // CC score
  })

  it("with coverage source but no entry for this function, applies pessimistic policy", () => {
    const cov = makeCoverage([])
    const entries = merge({
      metrics: [makeMetric({ complexity: 12 })],
      coverage: cov,
      options: makeOpts({ missing: "pessimistic" }),
      displayPath: (p) => p,
    })
    expect(entries[0]?.mode).toBe("crap")
    expect(entries[0]?.coverage).toBe(0)
    expect(entries[0]?.score).toBe(156) // 12² × 1 + 12
  })

  it("with missing=skip and a missing function, the entry is dropped", () => {
    const cov = makeCoverage([])
    const entries = merge({
      metrics: [makeMetric({ complexity: 12 })],
      coverage: cov,
      options: makeOpts({ missing: "skip" }),
      displayPath: (p) => p,
    })
    expect(entries).toHaveLength(0)
  })

  it("with missing=optimistic, fills 100%, score = CC", () => {
    const cov = makeCoverage([])
    const entries = merge({
      metrics: [makeMetric({ complexity: 12 })],
      coverage: cov,
      options: makeOpts({ missing: "optimistic" }),
      displayPath: (p) => p,
    })
    expect(entries[0]?.coverage).toBe(100)
    expect(entries[0]?.score).toBe(12)
  })
})

describe("merge - anonymous + hints + display path", () => {
  it("respects skipAnonymous", () => {
    const entries = merge({
      metrics: [
        makeMetric({ function: "<arrow@42>" }),
        makeMetric({ function: "named" }),
      ],
      coverage: null,
      options: makeOpts({ skipAnonymous: true }),
      displayPath: (p) => p,
    })
    expect(entries.map((e) => e.function)).toEqual(["named"])
  })

  it("applies hints when opts.hints is true (CC-only mode)", () => {
    const entries = merge({
      metrics: [makeMetric({ complexity: 40 })], // above default threshold 30
      coverage: null,
      options: makeOpts(),
      displayPath: (p) => p,
    })
    expect(entries[0]?.hint).toBeDefined()
  })

  it("calls displayPath to translate metric.file for the report row", () => {
    const entries = merge({
      metrics: [makeMetric({ file: "/proj/src/foo.ts" })],
      coverage: null,
      options: makeOpts(),
      displayPath: (p) => p.replace("/proj/", ""),
    })
    expect(entries[0]?.file).toBe("src/foo.ts")
  })
})
