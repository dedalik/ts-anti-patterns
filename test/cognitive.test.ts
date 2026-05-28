import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { analyzeFile } from "../src/complexity.js"

const FIXTURE = resolve("test/fixtures/tiny/sample.ts")
const SOURCE = readFileSync(FIXTURE, "utf8")

function byName(name: string) {
  const m = analyzeFile(SOURCE, FIXTURE, {
    cognitive: true,
    countNullishCoalescing: false,
  }).find((m) => m.function === name)
  if (!m) throw new Error(`function ${name} not found in fixture`)
  return m
}

describe("cognitive complexity", () => {
  it("trivial fn has cognitive 0", () => {
    expect(byName("trivial").cognitive).toBe(0)
  })

  it("flat switch with N cases counts as 1 (no nesting)", () => {
    // Sonar: a SwitchStatement at nesting 0 is +1 + 0 = 1.
    // Cases themselves don't add (B1: aggregator rule).
    expect(byName("flatSwitch").cognitive).toBe(1)
  })

  it("triple nesting yields much more than CC", () => {
    // for(nesting 0) +1
    //   if(nesting 1) +2
    //     for(nesting 2) +3
    //       if(nesting 3) +4
    // total = 10; CC = 5
    const m = byName("nested")
    expect(m.cognitive).toBe(10)
    expect(m.cognitive).toBeGreaterThan(m.complexity)
  })

  it("logical chain with same operator counts once", () => {
    // a && b && c → one '&&' chain → cognitive = 1
    expect(byName("logicalChain").cognitive).toBe(1)
  })

  it("logical chain with operator switch counts each switch", () => {
    // a && b || c → '&&' then '||' switch → cognitive = 2
    expect(byName("logicalMixed").cognitive).toBe(2)
  })

  it("inner functions don't inflate outer cognitive", () => {
    expect(byName("outer").cognitive).toBe(0)
    // inner has 2 ifs at nesting 0 → cognitive 2
    expect(byName("inner").cognitive).toBe(2)
  })

  it("?? not counted by default", () => {
    expect(byName("withNullish").cognitive).toBe(0)
  })
})
