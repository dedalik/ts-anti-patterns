// HTML report tests. We don't spin up Playwright - instead we render the
// report and exercise app.js inside JSDOM. That gives us full DOM/script
// execution semantics without a browser dependency, which is the right
// trade-off for our CI budget.

import { describe, it, expect, beforeAll } from "vitest"
import { JSDOM, VirtualConsole } from "jsdom"
import { renderHtml } from "../src/report/html.js"
import type { CrapEntry, ReportMeta } from "../src/options.js"

const META: ReportMeta = {
  version: "0.1.0",
  generatedAt: "2026-05-26T12:00:00.000Z",
  node: "v22.0.0",
  cwd: "/proj",
  command: "ts-anti-patterns src --format html",
  mode: "crap",
  coverageSource: {
    path: "coverage/lcov.info",
    kind: "branch",
    hint: "lcov (branch+fn+line)",
  },
}

function mkEntry(over: Partial<CrapEntry>): CrapEntry {
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
    hint: "Mid-complexity - raise coverage above 80% to flatten the score.",
    ...over,
  }
}

const ENTRIES: CrapEntry[] = [
  mkEntry({ function: "alpha", line: 5, score: 80, severity: "error", complexity: 30, coverage: 10 }),
  mkEntry({ function: "beta", line: 25, score: 35, severity: "warning", complexity: 8 }),
  mkEntry({ function: "gamma", line: 40, score: 5, severity: "ok", complexity: 2, coverage: 95 }),
  mkEntry({
    function: "<arrow@72>",
    line: 72,
    score: 28,
    severity: "info",
    complexity: 5,
    suppressed: { reason: "intentional ladder" },
  }),
]

let html = ""
let dom: JSDOM

beforeAll(async () => {
  html = await renderHtml(ENTRIES, META, { threshold: 30 })
})

describe("renderHtml - output shape", () => {
  it("emits a complete HTML document", () => {
    expect(html.startsWith("<!doctype html>")).toBe(true)
    expect(html).toContain("</html>")
  })

  it("inlines styles, script, and JSON without external requests", () => {
    expect(html).toMatch(/<style>[\s\S]+ts-anti-patterns/i)
    expect(html).toContain("<script id=\"data\" type=\"application/json\">")
    expect(html).toMatch(/<script>[\s\S]+function escapeHtml/)
    // No external <link rel="stylesheet"> or <script src=>
    expect(html).not.toMatch(/<link\s+[^>]*rel="stylesheet"[^>]*href="https?:/)
    expect(html).not.toMatch(/<script\s+[^>]*src="https?:/)
  })

  it("replaces every template marker", () => {
    expect(html).not.toContain("<!-- @@STYLES@@ -->")
    expect(html).not.toContain("<!-- @@SCRIPT@@ -->")
    expect(html).not.toContain("<!-- @@DATA@@ -->")
  })

  it("includes every entry in the embedded JSON, sorted by score desc", () => {
    const m = html.match(/<script id="data"[^>]*>([\s\S]*?)<\/script>/)
    expect(m).not.toBeNull()
    const data = JSON.parse(m![1]!) as {
      entries: { function: string; score: number }[]
      meta: ReportMeta
    }
    expect(data.entries.map((e) => e.function)).toEqual([
      "alpha",
      "beta",
      "<arrow@72>",
      "gamma",
    ])
    expect(data.meta.mode).toBe("crap")
  })

  it("does not break out of the JSON script tag for hostile payloads", async () => {
    const evil = await renderHtml(
      [mkEntry({ function: "evil </script><script>alert(1)</script>" })],
      META,
      { threshold: 30 }
    )
    expect(evil).not.toContain("alert(1)</script>")
    expect(evil).toContain("<\\/script>")
  })
})

describe("renderHtml - interactive behaviour (JSDOM)", () => {
  beforeAll(() => {
    const errors: string[] = []
    const vc = new VirtualConsole()
    vc.on("jsdomError", (e) => errors.push(String(e)))
    vc.on("error", (e) => errors.push(String(e)))
    dom = new JSDOM(html, {
      runScripts: "dangerously",
      pretendToBeVisual: true,
      virtualConsole: vc,
    })
    // Surface any script errors as test failures by stashing on the dom.
    ;(dom as unknown as { _scriptErrors: string[] })._scriptErrors = errors
  })

  it("runs the embedded app without console errors", () => {
    const errors = (dom as unknown as { _scriptErrors: string[] })._scriptErrors
    expect(errors).toEqual([])
  })

  it("renders one <tr> per entry by default", () => {
    const rows = dom.window.document.querySelectorAll("#crap-rows tr")
    expect(rows.length).toBe(ENTRIES.length)
  })

  it("marks the mode badge as CRAP and shows the coverage source", () => {
    const badge = dom.window.document.getElementById("mode-badge")
    expect(badge?.textContent).toMatch(/CRAP/i)
    expect(badge?.classList.contains("crap")).toBe(true)
    expect(dom.window.document.getElementById("cov-source")?.textContent).toContain(
      "coverage/lcov.info"
    )
  })

  it("threshold readout matches the slider value", () => {
    const readout = dom.window.document.getElementById("threshold-readout")
    expect(readout?.textContent).toMatch(/At threshold 30:/)
  })

  it("filter search hides non-matching rows", () => {
    const search = dom.window.document.getElementById("search") as HTMLInputElement
    search.value = "alpha"
    search.dispatchEvent(new dom.window.Event("input", { bubbles: true }))
    const fns = [...dom.window.document.querySelectorAll(".col-function")].map(
      (n) => n.textContent
    )
    expect(fns).toEqual(["alpha"])
    search.value = ""
    search.dispatchEvent(new dom.window.Event("input", { bubbles: true }))
  })

  it("'only above threshold' hides ok and info rows", () => {
    const cb = dom.window.document.getElementById("t-above") as HTMLInputElement
    cb.checked = true
    cb.dispatchEvent(new dom.window.Event("change", { bubbles: true }))
    const fns = [...dom.window.document.querySelectorAll(".col-function")].map(
      (n) => n.textContent
    )
    expect(fns).toContain("alpha")
    expect(fns).not.toContain("gamma")
    cb.checked = false
    cb.dispatchEvent(new dom.window.Event("change", { bubbles: true }))
  })

  it("'only suppressed' isolates the suppressed row", () => {
    const cb = dom.window.document.getElementById("t-suppressed") as HTMLInputElement
    cb.checked = true
    cb.dispatchEvent(new dom.window.Event("change", { bubbles: true }))
    const fns = [...dom.window.document.querySelectorAll(".col-function")].map(
      (n) => n.textContent
    )
    expect(fns).toEqual(["<arrow@72>"])
    cb.checked = false
    cb.dispatchEvent(new dom.window.Event("change", { bubbles: true }))
  })

  it("clicking a sortable header flips aria-sort", () => {
    const ths = [...dom.window.document.querySelectorAll("th")] as HTMLElement[]
    const scoreTh = ths.find((t) => t.dataset.key === "score")
    expect(scoreTh).toBeDefined()
    expect(scoreTh?.getAttribute("aria-sort")).toBe("descending")
    scoreTh!.click()
    expect(scoreTh?.getAttribute("aria-sort")).toBe("ascending")
    scoreTh!.click()
    expect(scoreTh?.getAttribute("aria-sort")).toBe("descending")
  })

  it("renders severity classes (ok/info/warning/error) on the markers", () => {
    const sevMarks = [...dom.window.document.querySelectorAll(".sev-mark")] as HTMLElement[]
    const classes = sevMarks.map((s) => [...s.classList].filter((c) => c !== "sev-mark").join("|"))
    expect(classes).toContain("error")
    expect(classes).toContain("warning")
    expect(classes).toContain("ok")
    expect(classes).toContain("info")
  })

  it("hides Cov/Conf columns when mode is CC-only", async () => {
    const ccHtml = await renderHtml(
      [mkEntry({ mode: "cc", coverage: null, coverageKind: null, confidence: "none" })],
      { ...META, mode: "cc", coverageSource: undefined },
      { threshold: 30 }
    )
    const ccDom = new JSDOM(ccHtml, { runScripts: "dangerously", pretendToBeVisual: true })
    const headers = [...ccDom.window.document.querySelectorAll("th")].map((t) => t.textContent?.trim())
    expect(headers.some((h) => h?.startsWith("Cov"))).toBe(false)
    expect(headers.some((h) => h?.startsWith("Conf"))).toBe(false)
  })
})
