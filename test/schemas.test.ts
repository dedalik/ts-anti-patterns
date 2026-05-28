// JSON Schema validation. The schemas in schemas/report-v1.json and
// schemas/delta-v1.json are part of the public contract - once a 1.x
// release ships, additive-only changes from here on out. These tests
// pin the contract from both directions:
//   - real renderJson output validates against the schema
//   - a hand-built delta object validates against the delta schema
//   - obvious bad inputs are rejected

import { describe, it, expect, beforeAll } from "vitest"
import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import Ajv2020, { type ValidateFunction } from "ajv/dist/2020.js"
import addFormats from "ajv-formats"
import { renderJson } from "../src/report/json.js"
import { diff } from "../src/delta.js"
import type { CrapEntry, ReportMeta } from "../src/options.js"

const SCHEMAS_DIR = resolve(import.meta.dirname, "..", "schemas")

let validateReport: ValidateFunction
let validateDelta: ValidateFunction

beforeAll(async () => {
  const reportSchema = JSON.parse(await readFile(resolve(SCHEMAS_DIR, "report-v1.json"), "utf8"))
  const deltaSchema = JSON.parse(await readFile(resolve(SCHEMAS_DIR, "delta-v1.json"), "utf8"))
  const ajv = new Ajv2020({ strict: false, allErrors: true })
  addFormats(ajv)
  ajv.addSchema(reportSchema)
  validateReport = ajv.compile(reportSchema)
  validateDelta = ajv.compile(deltaSchema)
})

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
    hint: "Mid-complexity.",
    ...over,
  }
}

const META: ReportMeta = {
  version: "1.0.0",
  generatedAt: "2026-05-26T12:00:00.000Z",
  node: "v22.0.0",
  cwd: "/proj",
  command: "ts-crap src",
  mode: "crap",
  coverageSource: {
    path: "coverage/lcov.info",
    kind: "branch",
    hint: "lcov (branch+fn+line)",
  },
}

describe("report-v1.json schema", () => {
  it("validates real renderJson output", () => {
    const entries = [
      mkEntry({ function: "alpha", score: 90, severity: "error" }),
      mkEntry({ function: "trivial", line: 50, score: 1, severity: "ok", complexity: 1, coverage: null, coverageKind: null, confidence: "none" }),
    ]
    const text = renderJson(entries, META, { threshold: 30 })
    const obj = JSON.parse(text)
    const ok = validateReport(obj)
    if (!ok) console.error(validateReport.errors)
    expect(ok).toBe(true)
  })

  it("rejects an envelope missing required summary keys", () => {
    const obj = {
      $schema: "https://example.com/x.json",
      schemaVersion: "1.0.0",
      meta: META,
      summary: { mode: "crap" }, // missing required keys
      entries: [],
    }
    expect(validateReport(obj)).toBe(false)
  })

  it("rejects an entry with severity outside the enum", () => {
    const entries = [mkEntry({})]
    const obj = JSON.parse(renderJson(entries, META, { threshold: 30 }))
    obj.entries[0].severity = "catastrophic"
    expect(validateReport(obj)).toBe(false)
  })

  it("rejects a future schemaVersion (2.x belongs to a different schema id)", () => {
    const obj = JSON.parse(renderJson([mkEntry({})], META, { threshold: 30 }))
    obj.schemaVersion = "2.0.0"
    expect(validateReport(obj)).toBe(false)
  })

  it("accepts coverage=null when the function has no record", () => {
    const e = mkEntry({ coverage: null, coverageKind: null, confidence: "none" })
    const obj = JSON.parse(renderJson([e], META, { threshold: 30 }))
    expect(validateReport(obj)).toBe(true)
  })
})

describe("delta-v1.json schema", () => {
  it("validates a real diff() result wrapped in an envelope", () => {
    const baseline = [mkEntry({ function: "alpha", score: 20 })]
    const current = [
      mkEntry({ function: "alpha", score: 60 }),
      mkEntry({ function: "newcomer", line: 99, score: 30 }),
    ]
    const d = diff(current, baseline, { epsilon: 0.01 })
    const envelope = {
      $schema: "https://raw.githubusercontent.com/dedalik/ts-crap/main/schemas/delta-v1.json",
      schemaVersion: "1.0.0",
      epsilon: 0.01,
      summary: d.summary,
      rows: d.rows.map((r) => ({
        kind: r.kind,
        delta: r.delta,
        ...(r.current ? { current: serialize(r.current) } : {}),
        ...(r.baseline ? { baseline: serialize(r.baseline) } : {}),
      })),
    }
    const ok = validateDelta(envelope)
    if (!ok) console.error(validateDelta.errors)
    expect(ok).toBe(true)
  })

  it("rejects unknown `kind` values", () => {
    const envelope = {
      $schema: "https://example.com/x.json",
      schemaVersion: "1.0.0",
      summary: { unchanged: 0, improved: 0, regression: 0, new: 0, removed: 0, moved: 0 },
      rows: [{ kind: "exploded", delta: 1 }],
    }
    expect(validateDelta(envelope)).toBe(false)
  })
})

// Mirrors the renderJson() serializer so envelopes built in tests look the
// same shape JSON consumers will receive.
function serialize(e: CrapEntry) {
  return {
    cognitive: e.cognitive,
    complexity: e.complexity,
    confidence: e.confidence,
    coverage: e.coverage,
    coverageKind: e.coverageKind,
    endLine: e.endLine,
    file: e.file,
    function: e.function,
    hint: e.hint ?? null,
    line: e.line,
    localThreshold: e.localThreshold ?? null,
    mode: e.mode,
    score: e.score,
    severity: e.severity,
    sloc: e.sloc,
    suppressed: e.suppressed ?? null,
  }
}
