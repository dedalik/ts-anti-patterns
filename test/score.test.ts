import { describe, it, expect } from "vitest"
import {
  computeCrap,
  resolveCoverage,
  scoreOf,
  severityOf,
  displayScore,
} from "../src/score.js"

describe("CRAP formula", () => {
  it("CRAP at 100% coverage equals CC", () => {
    expect(computeCrap(10, 100)).toBeCloseTo(10, 6)
  })

  it("CRAP at 0% coverage equals CC^2 + CC", () => {
    expect(computeCrap(10, 0)).toBeCloseTo(110, 6)
  })

  it("CRAP follows the formula at 50%", () => {
    // 10^2 * (0.5)^3 + 10 = 12.5 + 10 = 22.5
    expect(computeCrap(10, 50)).toBeCloseTo(22.5, 6)
  })

  it("CRAP is monotonic in CC at fixed coverage", () => {
    expect(computeCrap(5, 80)).toBeLessThan(computeCrap(10, 80))
  })

  // Coverage + CRAP scoring (see docs/architecture.md).
  it("acceptance: CC=12, cov=0 → CRAP = 156.0", () => {
    expect(computeCrap(12, 0)).toBeCloseTo(156, 6)
  })

  it("acceptance: CC=1, cov=100 → CRAP = 1.0", () => {
    expect(computeCrap(1, 100)).toBeCloseTo(1, 6)
  })

  it("CC=1, cov=0 → CRAP = 2.0", () => {
    expect(computeCrap(1, 0)).toBeCloseTo(2, 6)
  })
})

describe("missing coverage policy", () => {
  it("pessimistic maps null → 0%", () => {
    expect(resolveCoverage(null, "pessimistic")).toBe(0)
  })

  it("optimistic maps null → 100%", () => {
    expect(resolveCoverage(null, "optimistic")).toBe(100)
  })

  it("skip preserves null", () => {
    expect(resolveCoverage(null, "skip")).toBeNull()
  })

  it("known coverage is returned untouched", () => {
    expect(resolveCoverage(73.2, "pessimistic")).toBe(73.2)
  })
})

describe("scoreOf", () => {
  it("returns CC when coverage is unknown (CC-only mode)", () => {
    const r = scoreOf({ complexity: 7 }, null)
    expect(r).toEqual({ score: 7, mode: "cc" })
  })

  it("returns CRAP when coverage is provided", () => {
    const r = scoreOf({ complexity: 10 }, 100)
    expect(r.mode).toBe("crap")
    expect(r.score).toBeCloseTo(10, 6)
  })
})

describe("severityOf - band boundaries", () => {
  const t = 30

  it("at or below half threshold => ok", () => {
    expect(severityOf(0, t)).toBe("ok")
    expect(severityOf(15, t)).toBe("ok")
  })

  it("above half threshold up to threshold => info", () => {
    expect(severityOf(15.1, t)).toBe("info")
    expect(severityOf(30, t)).toBe("info")
  })

  it("above threshold up to 2x => warning", () => {
    expect(severityOf(30.1, t)).toBe("warning")
    expect(severityOf(60, t)).toBe("warning")
  })

  it("above 2x => error", () => {
    expect(severityOf(60.1, t)).toBe("error")
    expect(severityOf(999, t)).toBe("error")
  })

  it("a local threshold overrides the global", () => {
    expect(severityOf(50, 30, 100)).toBe("ok")
    expect(severityOf(50, 30, 10)).toBe("error")
  })
})

describe("displayScore", () => {
  it("rounds to 1 decimal", () => {
    expect(displayScore(12.345)).toBe("12.3")
    expect(displayScore(7)).toBe("7.0")
  })
})
