// Smoke tests for the non-LCOV parsers: json-summary, clover, cobertura.
// Focus: the parser returns a CoverageMap shaped exactly as merge.ts expects.

import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import { describe, it, expect } from "vitest"
import { parseJsonSummary } from "../src/coverage/json-summary.js"
import { parseClover } from "../src/coverage/clover.js"
import { parseCobertura } from "../src/coverage/cobertura.js"
import {
  formatFromPath,
  loadCoverage,
  sniffCoverage,
} from "../src/coverage/index.js"

const FIXTURES = resolve(__dirname, "fixtures/coverage")

describe("parseJsonSummary", () => {
  it("turns istanbul coverage-summary.json into a line-rate signal", async () => {
    const text = await readFile(`${FIXTURES}/coverage-summary.json`, "utf8")
    const map = parseJsonSummary(text, { sourcePath: "coverage-summary.json" })
    const file = map.files.get("test/fixtures/tiny/sample.ts")
    expect(file).toBeDefined()
    // covered/total are stored: line 1 → covered, line 0 → total sentinel.
    expect(file?.lineHits.get(1)).toBe(18)
    expect(file?.lineHits.get(0)).toBe(31)
  })

  it("ignores 'total' aggregate key", async () => {
    const text = await readFile(`${FIXTURES}/coverage-summary.json`, "utf8")
    const map = parseJsonSummary(text, { sourcePath: "coverage-summary.json" })
    expect(map.files.has("total")).toBe(false)
  })

  it("handles malformed JSON by returning an empty map", () => {
    const map = parseJsonSummary("not json", { sourcePath: "bad.json" })
    expect(map.files.size).toBe(0)
  })
})

describe("parseClover", () => {
  it("parses <line type='cond' truecount falsecount> into branch hits", async () => {
    const text = await readFile(`${FIXTURES}/clover.xml`, "utf8")
    const map = parseClover(text, { sourcePath: "clover.xml" })
    const file = map.files.get("test/fixtures/tiny/sample.ts")
    expect(file).toBeDefined()
    expect(file?.lineHits.get(4)).toBe(5)
    expect(file?.branchHitsByLine.get(8)).toEqual([
      { block: 0, branch: 0, taken: 1 },
      { block: 0, branch: 1, taken: 0 },
    ])
    expect(map.source.hasBranch).toBe(true)
  })
})

describe("parseCobertura", () => {
  it("parses condition-coverage='X% (taken/total)' into branch hits", async () => {
    const text = await readFile(`${FIXTURES}/cobertura-coverage.xml`, "utf8")
    const map = parseCobertura(text, { sourcePath: "cobertura.xml" })
    const file = map.files.get("test/fixtures/tiny/sample.ts")
    expect(file).toBeDefined()
    expect(file?.lineHits.get(4)).toBe(5)
    expect(file?.branchHitsByLine.get(8)).toEqual([
      { block: 0, branch: 0, taken: 1 },
      { block: 0, branch: 1, taken: 0 },
    ])
    expect(file?.branchHitsByLine.get(9)).toEqual([
      { block: 0, branch: 0, taken: 1 },
      { block: 0, branch: 1, taken: 1 },
    ])
  })
})

describe("formatFromPath", () => {
  it("recognizes lcov/info, xml, json by extension", () => {
    expect(formatFromPath("coverage/lcov.info")).toBe("lcov")
    expect(formatFromPath("/x/y.lcov")).toBe("lcov")
    expect(formatFromPath("/x/cobertura-coverage.xml")).toBe("cobertura")
    expect(formatFromPath("/x/clover.xml")).toBe("clover")
    expect(formatFromPath("/x/coverage-summary.json")).toBe("json-summary")
  })
})

describe("sniffCoverage", () => {
  it("returns null when no coverage layout is present", () => {
    expect(sniffCoverage(FIXTURES)).toBeNull()
  })
})

describe("loadCoverage dispatcher", () => {
  it("loads a clover.xml when format is inferred from path", async () => {
    const map = await loadCoverage(`${FIXTURES}/clover.xml`)
    expect(map.source.format).toBe("clover")
    expect(map.files.size).toBeGreaterThan(0)
  })

  it("loads an lcov file with explicit format override", async () => {
    const map = await loadCoverage(`${FIXTURES}/vitest.lcov`, "lcov")
    expect(map.source.format).toBe("lcov")
    expect(map.source.hasBranch).toBe(true)
  })
})
