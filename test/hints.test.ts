import { describe, it, expect } from "vitest"
import { hintFor } from "../src/hints.js"

describe("hintFor - CC-only mode", () => {
  const base = { cognitive: 5, coverage: null, mode: "cc" as const, threshold: 30 }

  it("returns no hint for ok-range CC", () => {
    expect(hintFor({ ...base, complexity: 3 })).toBeUndefined()
  })

  it("warns at borderline CC (> threshold/2)", () => {
    expect(hintFor({ ...base, complexity: 20 })).toMatch(/[Bb]orderline/)
  })

  it("escalates when CC > threshold", () => {
    expect(hintFor({ ...base, complexity: 35 })).toMatch(/split|extract|simplify/i)
  })

  it("flags 'highly nested' when cognitive >> CC", () => {
    expect(hintFor({ ...base, complexity: 35, cognitive: 80 })).toMatch(/nested|flatten/i)
  })
})

describe("hintFor - CRAP mode quadrants", () => {
  const t = 30
  const base = { cognitive: 5, mode: "crap" as const, threshold: t }

  it("Quadrant 1: low CC + low coverage → 'cheap to test'", () => {
    const hint = hintFor({ ...base, complexity: 4, coverage: 10 })
    expect(hint).toMatch(/[Cc]heap to test/)
  })

  it("Quadrant 2: mid CC + low coverage → 'untested complexity'", () => {
    const hint = hintFor({ ...base, complexity: 10, coverage: 20 })
    expect(hint).toMatch(/[Uu]ntested complexity/)
  })

  it("Quadrant 3: high CC + high coverage → 'tests can't save this'", () => {
    const hint = hintFor({ ...base, complexity: 40, coverage: 95 })
    expect(hint).toMatch(/[Tt]ests can't save|simplify/)
  })

  it("Quadrant 4: very high CC + very low coverage → 'hot risk'", () => {
    const hint = hintFor({ ...base, complexity: 50, coverage: 5 })
    expect(hint).toMatch(/[Hh]ot risk|untested/i)
  })

  it("returns no hint for low CC + high coverage (healthy quadrant)", () => {
    expect(hintFor({ ...base, complexity: 3, coverage: 95 })).toBeUndefined()
  })

  it("falls back to CC-only rules when coverage is null even in crap mode", () => {
    const hint = hintFor({ ...base, complexity: 50, coverage: null })
    expect(hint).toMatch(/split|extract|simplify|flatten/i)
  })
})
