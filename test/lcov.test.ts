import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import { describe, it, expect } from "vitest"
import { parseLcov } from "../src/coverage/lcov.js"

const FIXTURES = resolve(__dirname, "fixtures/coverage")

describe("parseLcov", () => {
  it("indexes FN/FNDA by line, joining names through FNDA", async () => {
    const text = await readFile(`${FIXTURES}/vitest.lcov`, "utf8")
    const map = parseLcov(text, { sourcePath: "vitest.lcov" })

    const sample = map.files.get("test/fixtures/tiny/sample.ts")
    expect(sample).toBeDefined()
    if (!sample) return

    expect(sample.fnHitsByLine.get(3)).toEqual({ name: "trivial", hits: 5 })
    expect(sample.fnHitsByLine.get(7)).toEqual({ name: "ifElse", hits: 3 })
    expect(sample.fnHitsByLine.get(34)).toEqual({ name: "withNullish", hits: 0 })
    expect(sample.fnHitsByLine.get(74)).toEqual({ name: "#private", hits: 0 })
  })

  it("parses BRDA into branchHitsByLine grouped by source line", async () => {
    const text = await readFile(`${FIXTURES}/vitest.lcov`, "utf8")
    const map = parseLcov(text, { sourcePath: "vitest.lcov" })
    const sample = map.files.get("test/fixtures/tiny/sample.ts")
    expect(sample?.branchHitsByLine.get(8)).toEqual([
      { block: 0, branch: 0, taken: 3 },
      { block: 0, branch: 1, taken: -1 },
    ])
    expect(sample?.branchHitsByLine.get(9)).toEqual([
      { block: 1, branch: 0, taken: 1 },
      { block: 1, branch: 1, taken: 1 },
    ])
    // Line 92 has '-' for both branches → not instrumented sentinel.
    expect(sample?.branchHitsByLine.get(92)).toEqual([
      { block: 9, branch: 0, taken: -1 },
      { block: 9, branch: 1, taken: -1 },
    ])
  })

  it("records hasBranch/hasFn/hasLine flags", async () => {
    const text = await readFile(`${FIXTURES}/vitest.lcov`, "utf8")
    const map = parseLcov(text, { sourcePath: "vitest.lcov" })
    expect(map.source).toEqual({
      format: "lcov",
      path: "vitest.lcov",
      hasBranch: true,
      hasFn: true,
      hasLine: true,
    })
  })

  it("emits DA hits keyed by line", async () => {
    const text = await readFile(`${FIXTURES}/vitest.lcov`, "utf8")
    const map = parseLcov(text, { sourcePath: "vitest.lcov" })
    const sample = map.files.get("test/fixtures/tiny/sample.ts")
    expect(sample?.lineHits.get(4)).toBe(5)
    expect(sample?.lineHits.get(21)).toBe(0)
    expect(sample?.lineHits.get(47)).toBe(3)
  })

  it("preserves the verbatim SF path - no CWD resolution", async () => {
    const text = await readFile(`${FIXTURES}/c8.lcov`, "utf8")
    const map = parseLcov(text, { sourcePath: "c8.lcov" })
    expect([...map.files.keys()]).toEqual(["/absolute/proj/test/fixtures/tiny/sample.ts"])
  })

  it("preserves names with commas embedded", () => {
    const lcov = ["SF:a.ts", "FN:5,Foo,Bar", "FNDA:3,Foo,Bar", "end_of_record"].join("\n")
    const map = parseLcov(lcov, { sourcePath: "inline" })
    expect(map.files.get("a.ts")?.fnHitsByLine.get(5)).toEqual({ name: "Foo,Bar", hits: 3 })
  })

  it("supports multiple files in a single LCOV", async () => {
    const text = await readFile(`${FIXTURES}/vitest.lcov`, "utf8")
    const map = parseLcov(text, { sourcePath: "vitest.lcov" })
    expect([...map.files.keys()]).toEqual([
      "test/fixtures/tiny/sample.ts",
      "src/lonely-no-fn-records.ts",
    ])
  })

  it("handles DA '-' as uninstrumented (zero)", () => {
    const lcov = ["SF:x.ts", "DA:1,-", "DA:2,5", "end_of_record"].join("\n")
    const map = parseLcov(lcov, { sourcePath: "inline" })
    const x = map.files.get("x.ts")
    expect(x?.lineHits.get(1)).toBe(0)
    expect(x?.lineHits.get(2)).toBe(5)
  })
})
