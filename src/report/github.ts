// GitHub Actions annotation format.
//
// One line per entry, of the form:
//   ::warning file=src/foo.ts,line=12,title=ts-anti-patterns score 35.0 (warning)::
//     foo (CC 8, cov 30%) - hint text
//
// Severity → log level mapping:
//   ok      → no output (annotations are noise for green rows)
//   info    → ::notice
//   warning → ::warning
//   error   → ::error
//
// GitHub strips %, CR, LF from message bodies; we encode them manually.

import { sortEntries } from "./human.js"
import type { CrapEntry, ReportMeta } from "../options.js"
import type { Severity } from "../options.js"

export interface GithubOptions {
  threshold: number
  top?: number
  min?: number
}

const LEVEL: Record<Severity, "notice" | "warning" | "error" | null> = {
  ok: null,
  info: "notice",
  warning: "warning",
  error: "error",
}

export function renderGithub(
  entries: CrapEntry[],
  meta: ReportMeta,
  opts: GithubOptions
): string {
  void meta
  let view = sortEntries(entries)
  if (typeof opts.min === "number") view = view.filter((e) => e.score >= opts.min!)
  if (typeof opts.top === "number") view = view.slice(0, opts.top)

  const lines: string[] = []
  for (const e of view) {
    const level = LEVEL[e.severity]
    if (!level) continue
    const props = [
      `file=${e.file}`,
      `line=${e.line}`,
      `endLine=${e.endLine}`,
      `title=ts-anti-patterns score ${e.score.toFixed(1)} (${e.severity})`,
    ].join(",")
    const summary = buildMessage(e)
    lines.push(`::${level} ${props}::${encodeMessage(summary)}`)
  }
  return lines.length ? lines.join("\n") + "\n" : ""
}

function buildMessage(e: CrapEntry): string {
  const parts: string[] = []
  parts.push(`${e.function} (CC ${e.complexity}, Cog ${e.cognitive}, SLOC ${e.sloc}`)
  if (e.coverage != null) parts.push(`, cov ${e.coverage.toFixed(1)}%, conf ${e.confidence}`)
  parts.push(")")
  let line = parts.join("")
  if (e.hint) line += ` - ${e.hint}`
  return line
}

function encodeMessage(s: string): string {
  return s
    .replace(/%/g, "%25")
    .replace(/\r/g, "%0D")
    .replace(/\n/g, "%0A")
}
