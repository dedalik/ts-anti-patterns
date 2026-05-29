import { mkdtemp, writeFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { SourceMapGenerator } from "source-map"
import { translateCoverage } from "../src/source-map.js"
import { emptyFileCoverage, type CoverageMap } from "../src/coverage/types.js"

let tmp = ""

beforeAll(async () => {
  tmp = await mkdtemp(join(tmpdir(), "ts-anti-patterns-sm-"))

  // Generated file: dist/foo.js, points back to src/foo.ts.
  const generated = "function foo(){return 1}\nfunction bar(){return 2}\n//# sourceMappingURL=foo.js.map\n"
  await writeFile(join(tmp, "foo.js"), generated)

  const gen = new SourceMapGenerator({ file: "foo.js" })
  // src line 5 (the user wrote foo() at TS line 5) -> generated line 1
  gen.addMapping({
    source: "../src/foo.ts",
    original: { line: 5, column: 0 },
    generated: { line: 1, column: 0 },
  })
  // src line 20 -> generated line 2
  gen.addMapping({
    source: "../src/foo.ts",
    original: { line: 20, column: 0 },
    generated: { line: 2, column: 0 },
  })
  await writeFile(join(tmp, "foo.js.map"), gen.toString())
})

afterAll(async () => {
  if (tmp) await rm(tmp, { recursive: true, force: true })
})

describe("translateCoverage", () => {
  it("re-keys fnHitsByLine through the source map", async () => {
    const fc = emptyFileCoverage()
    fc.fnHitsByLine.set(1, { name: "foo", hits: 3 })
    fc.fnHitsByLine.set(2, { name: "bar", hits: 0 })

    const cov: CoverageMap = {
      files: new Map([[join(tmp, "foo.js"), fc]]),
      source: {
        format: "lcov",
        path: "any.lcov",
        hasBranch: false,
        hasFn: true,
        hasLine: false,
      },
    }

    const translated = await translateCoverage(cov)

    // After translation, keys should be source files, not the .js file.
    const allKeys = [...translated.files.keys()]
    expect(allKeys.length).toBeGreaterThanOrEqual(1)
    // We accept either the bare source path or the absolute-resolved variant -
    // both are valid outputs; the important property is that source line 5
    // (not generated line 1) carries the foo() hit.
    let found = false
    for (const fileCov of translated.files.values()) {
      const fn = fileCov.fnHitsByLine.get(5)
      if (fn?.name === "foo" && fn.hits === 3) {
        found = true
        break
      }
    }
    expect(found).toBe(true)
  })

  it("passes through coverage when no source map exists", async () => {
    const fc = emptyFileCoverage()
    fc.lineHits.set(7, 1)
    const cov: CoverageMap = {
      files: new Map([["/no/such/file.js", fc]]),
      source: {
        format: "lcov",
        path: "any.lcov",
        hasBranch: false,
        hasFn: false,
        hasLine: true,
      },
    }
    const translated = await translateCoverage(cov)
    expect(translated.files.get("/no/such/file.js")?.lineHits.get(7)).toBe(1)
  })
})
