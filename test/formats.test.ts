// Smoke tests for all Phase 4 output formats. They check the contract of
// each format (structure, marker strings, severity emoji/level mapping)
// without locking us into exact wording.

import { describe, it, expect } from "vitest"
import { renderMarkdown } from "../src/report/markdown.js"
import { renderGithub } from "../src/report/github.js"
import { renderSarif } from "../src/report/sarif.js"
import { renderPrComment } from "../src/report/pr-comment.js"
import { diff } from "../src/delta.js"
import type { CrapEntry, ReportMeta } from "../src/options.js"

const META: ReportMeta = {
  version: "0.1.0",
  generatedAt: "2026-05-26T12:00:00.000Z",
  node: "v22.0.0",
  cwd: "/proj",
  command: "ts-anti-patterns src",
  mode: "crap",
  coverageSource: {
    path: "coverage/lcov.info",
    kind: "branch",
    hint: "lcov (branch+fn+line)",
  },
}

function mk(over: Partial<CrapEntry>): CrapEntry {
  return {
    file: "src/foo.ts",
    function: "foo",
    line: 10,
    endLine: 20,
    complexity: 5,
    cognitive: 5,
    sloc: 8,
    coverage: 50,
    coverageKind: "branch",
    confidence: "exact",
    score: 12,
    mode: "crap",
    severity: "warning",
    hint: "Mid-complexity.",
    ...over,
  }
}

const ENTRIES = [
  mk({ function: "blowup", score: 90, severity: "error", complexity: 30 }),
  mk({ function: "borderline", line: 40, score: 35, severity: "warning" }),
  mk({ function: "trivial", line: 70, score: 2, severity: "ok", complexity: 1 }),
]

describe("renderMarkdown", () => {
  const md = renderMarkdown(ENTRIES, META, { threshold: 30 })

  it("starts with a heading and notes the mode", () => {
    expect(md).toMatch(/^## ts-anti-patterns report - CRAP mode/m)
  })

  it("emits a GFM table with severity emoji", () => {
    expect(md).toContain("| Sev | Score |")
    expect(md).toContain("| :-: | --: |")
    expect(md).toMatch(/🔴/) // error
    expect(md).toMatch(/🟠/) // warning
    expect(md).toMatch(/🟢/) // ok
  })

  it("escapes pipes inside function names so the table doesn't break", () => {
    const md2 = renderMarkdown([mk({ function: "a|b", score: 50, severity: "error" })], META, {
      threshold: 30,
    })
    expect(md2).toContain("`a\\|b`")
  })
})

describe("renderGithub", () => {
  it("emits ::error / ::warning / no-op for ok and skips ok rows", () => {
    const out = renderGithub(ENTRIES, META, { threshold: 30 })
    expect(out).toMatch(/^::error file=src\/foo\.ts,line=10,/m)
    expect(out).toMatch(/^::warning file=src\/foo\.ts,line=40,/m)
    expect(out).not.toMatch(/trivial/) // ok severity is dropped
  })

  it("encodes %, CR, LF in messages so they survive GitHub's parser", () => {
    const out = renderGithub(
      [mk({ function: "weird", score: 60, severity: "error", hint: "use 100%\nnow" })],
      META,
      { threshold: 30 }
    )
    expect(out).toContain("use 100%25%0Anow")
  })
})

describe("renderSarif", () => {
  const out = renderSarif(ENTRIES, META, { threshold: 30 })
  const sarif = JSON.parse(out) as {
    version: string
    $schema: string
    runs: {
      tool: { driver: { name: string; rules: { id: string }[] } }
      results: { ruleId: string; level: string; locations: { physicalLocation: unknown }[] }[]
    }[]
  }

  it("matches the SARIF 2.1.0 envelope", () => {
    expect(sarif.version).toBe("2.1.0")
    expect(sarif.$schema).toMatch(/sarif-2\.1\.0/)
    expect(sarif.runs[0]!.tool.driver.name).toBe("ts-anti-patterns")
    expect(sarif.runs[0]!.tool.driver.rules[0]!.id).toBe("ts-anti-patterns/score")
  })

  it("maps severity → level (error → error, warning → warning, info → note)", () => {
    const levels = sarif.runs[0]!.results.map((r) => r.level)
    expect(levels).toContain("error")
    expect(levels).toContain("warning")
    expect(levels).not.toContain("none") // ok rows are dropped
  })

  it("attaches a physicalLocation for every result", () => {
    for (const r of sarif.runs[0]!.results) {
      expect(r.locations[0]!.physicalLocation).toBeDefined()
    }
  })
})

describe("renderPrComment", () => {
  it("opens with the marker and a headline counts row", () => {
    const out = renderPrComment(ENTRIES, META, { threshold: 30 })
    expect(out.startsWith("<!-- ts-anti-patterns-report -->")).toBe(true)
    expect(out).toContain("🔴 1 error")
    expect(out).toContain("🟠 1 warning")
    expect(out).toContain("Top")
  })

  it("renders regressions first when a delta is given", () => {
    const baseline = [mk({ function: "blowup", score: 20, severity: "info" })]
    const current = [mk({ function: "blowup", score: 90, severity: "error" })]
    const d = diff(current, baseline, { epsilon: 0.01 })
    const out = renderPrComment(current, META, { threshold: 30, delta: d })
    const regressionIdx = out.indexOf("Regressions")
    const newIdx = out.indexOf("New")
    expect(regressionIdx).toBeGreaterThan(-1)
    if (newIdx > -1) expect(regressionIdx).toBeLessThan(newIdx)
  })

  it("lists suppressed entries in a collapsible block", () => {
    const out = renderPrComment(
      [mk({ function: "intentional", severity: "ok", score: 1, suppressed: { reason: "DSL" } })],
      META,
      { threshold: 30 }
    )
    expect(out).toContain("Suppressed (1)")
    expect(out).toContain("DSL")
  })
})
