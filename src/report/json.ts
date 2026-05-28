// JSON report. Versioned envelope with a stable, alphabetical key order
// per object so diffs stay clean across runs.

import type { CrapEntry, ReportMeta } from "../options.js"
import { sortEntries } from "./human.js"

export const REPORT_SCHEMA_VERSION = "1.0.0"
export const REPORT_SCHEMA_URL =
  "https://raw.githubusercontent.com/dedalik/ts-crap/main/schemas/report-v1.json"

export interface JsonReportEnvelope {
  $schema: string
  schemaVersion: string
  meta: ReportMeta
  summary: {
    coverageKnown: boolean
    errors: number
    functions: number
    infos: number
    mode: "crap" | "cc"
    oks: number
    threshold: number
    warnings: number
    worstScore: number | null
  }
  entries: SerializedEntry[]
}

interface SerializedEntry {
  cognitive: number
  complexity: number
  confidence: "exact" | "range" | "none"
  coverage: number | null
  coverageKind: "branch" | "fn" | "line" | null
  endLine: number
  file: string
  function: string
  hint: string | null
  line: number
  localThreshold: number | null
  mode: "crap" | "cc"
  score: number
  severity: "ok" | "info" | "warning" | "error"
  sloc: number
  suppressed: { reason: string } | null
}

export interface JsonReportOptions {
  threshold: number
}

export function renderJson(
  entries: CrapEntry[],
  meta: ReportMeta,
  opts: JsonReportOptions
): string {
  const sorted = sortEntries(entries)
  const envelope: JsonReportEnvelope = {
    $schema: REPORT_SCHEMA_URL,
    schemaVersion: REPORT_SCHEMA_VERSION,
    meta,
    summary: summarize(sorted, opts.threshold),
    entries: sorted.map(serialize),
  }
  return JSON.stringify(envelope, null, 2) + "\n"
}

function summarize(entries: CrapEntry[], threshold: number) {
  return {
    coverageKnown: entries.some((e) => e.coverage !== null),
    errors: entries.filter((e) => e.severity === "error").length,
    functions: entries.length,
    infos: entries.filter((e) => e.severity === "info").length,
    mode: (entries[0]?.mode ?? "cc") as "crap" | "cc",
    oks: entries.filter((e) => e.severity === "ok").length,
    threshold,
    warnings: entries.filter((e) => e.severity === "warning").length,
    worstScore: entries.reduce<number | null>(
      (max, e) => (max === null || e.score > max ? e.score : max),
      null
    ),
  }
}

// Canonical alphabetical key order. Numbers preserved at full precision -
// rounding belongs to the display layer, not to the data.
function serialize(e: CrapEntry): SerializedEntry {
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
    score: roundForJson(e.score),
    severity: e.severity,
    sloc: e.sloc,
    suppressed: e.suppressed ?? null,
  }
}

// Keep enough precision to reproduce the displayed value while squashing
// JS float noise like 12.300000000000001.
export function roundForJson(n: number, decimals = 6): number {
  const f = Math.pow(10, decimals)
  return Math.round(n * f) / f
}
