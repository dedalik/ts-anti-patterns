import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { analyzeFile } from "../src/complexity.js"

const FIXTURE = resolve("test/fixtures/tiny/sample.ts")
const SOURCE = readFileSync(FIXTURE, "utf8")

function analyze() {
  return analyzeFile(SOURCE, FIXTURE, {
    cognitive: true,
    countNullishCoalescing: false,
  })
}

function byName(name: string) {
  const m = analyze().find((m) => m.function === name)
  if (!m) throw new Error(`function ${name} not found in fixture`)
  return m
}

describe("cyclomatic complexity", () => {
  it("trivial function has CC=1", () => {
    expect(byName("trivial").complexity).toBe(1)
  })

  it("if-else chain counts each predicate", () => {
    // if + else if → 2 branches → CC = 1 + 2 = 3
    expect(byName("ifElse").complexity).toBe(3)
  })

  it("switch default does NOT add +1", () => {
    // 3 cases + default → 3 branches → CC = 1 + 3 = 4
    expect(byName("flatSwitch").complexity).toBe(4)
  })

  it("&&/|| add +1 each", () => {
    // a && b && c → 2 LogicalExpression → CC = 1 + 2 = 3
    expect(byName("logicalChain").complexity).toBe(3)
    // a && b || c → 2 LogicalExpression → CC = 1 + 2 = 3
    expect(byName("logicalMixed").complexity).toBe(3)
  })

  it("?? is NOT counted by default", () => {
    expect(byName("withNullish").complexity).toBe(1)
  })

  it("?? is counted with --count-nullish-coalescing", () => {
    const m = analyzeFile(SOURCE, FIXTURE, {
      cognitive: true,
      countNullishCoalescing: true,
    }).find((m) => m.function === "withNullish")
    expect(m?.complexity).toBe(3)
  })

  it("optional chaining adds +1 per ?.", () => {
    // o?.a?.b → 2 optional MemberExpressions; ?? not counted by default.
    // CC = 1 + 2 = 3
    expect(byName("optionalChain").complexity).toBe(3)
  })

  it("nested loops/ifs in same function ladder up", () => {
    // for + if + for + if = 4 branches → CC = 5
    expect(byName("nested").complexity).toBe(5)
  })

  it("outer fn does NOT inherit inner fn's complexity", () => {
    const outer = byName("outer")
    const inner = byName("inner")
    // outer's body is straight-line (just defines inner and calls it)
    expect(outer.complexity).toBe(1)
    // inner: 2 ifs → CC = 3
    expect(inner.complexity).toBe(3)
  })
})

describe("class-qualified names", () => {
  it("regular method", () => {
    expect(byName("UserCard.render")).toBeDefined()
  })

  it("getter and setter", () => {
    expect(byName("UserCard.<get>.size")).toBeDefined()
    expect(byName("UserCard.<set>.size")).toBeDefined()
  })

  it("constructor", () => {
    expect(byName("UserCard.<constructor>")).toBeDefined()
  })

  it("static method", () => {
    expect(byName("UserCard.<static>.factory")).toBeDefined()
  })

  it("private method uses # prefix", () => {
    expect(byName("UserCard#private")).toBeDefined()
  })

  it("variable-bound arrow uses the binding name", () => {
    expect(byName("arrowConst")).toBeDefined()
  })

  it("export default has a stable name", () => {
    const all = analyze().map((m) => m.function)
    expect(all).toContain("sample.<default>")
  })
})

describe("metrics", () => {
  it("every function has a non-empty name", () => {
    for (const m of analyze()) {
      expect(m.function).toBeTruthy()
      expect(m.function.length).toBeGreaterThan(0)
    }
  })

  it("line and endLine are populated and ordered", () => {
    for (const m of analyze()) {
      expect(m.line).toBeGreaterThan(0)
      expect(m.endLine).toBeGreaterThanOrEqual(m.line)
    }
  })

  it("sloc is positive for non-trivial functions", () => {
    expect(byName("nested").sloc).toBeGreaterThan(3)
  })

  it("invalid source returns []", () => {
    expect(analyzeFile("!!! not valid !!!", "broken.ts", {
      cognitive: true,
      countNullishCoalescing: false,
    })).toEqual([])
  })
})
