// Human-readable terminal report.
// Columns are chosen to give a confident "what next?" read in one screen:
//   Sev | Score | CC | Cog | SLOC | Cov | Conf | Hint | Function | Location
// In CC-only mode (no coverage), the Cov and Conf columns are hidden.

import Table from "cli-table3"
import pc from "picocolors"
import type { CrapEntry, ReportMeta, Severity, Confidence } from "../options.js"
import { displayScore } from "../score.js"

export interface HumanReportOptions {
  threshold: number
  top?: number
  min?: number
  showHints: boolean
  colors: boolean
  summary?: boolean
}

export function renderHuman(
  entries: CrapEntry[],
  meta: ReportMeta,
  opts: HumanReportOptions
): string {
  const lines: string[] = []
  const color = opts.colors ? pc : nullColorizer()

  const isCrap = meta.mode === "crap"
  const visible = filterEntries(entries, opts)

  lines.push("")
  lines.push(headerLine(meta, color))
  if (meta.coverageSource) {
    lines.push(coverageSourceLine(meta, color))
  } else if (meta.mode === "cc") {
    lines.push(noCoverageLine(color))
  }
  if (meta.stickyDelta) {
    lines.push(stickyLine(meta.stickyDelta, color))
  }
  lines.push("")
  lines.push(summaryLine(entries, opts, color))
  lines.push("")

  if (opts.summary) {
    lines.push(footerLine(meta, color))
    return lines.join("\n") + "\n"
  }

  const head = isCrap
    ? ["Sev", "Score", "CC", "Cog", "SLOC", "Cov", "Conf", "Hint", "Function", "Location"]
    : ["Sev", "Score", "CC", "Cog", "SLOC", "Hint", "Function", "Location"]

  const table = new Table({
    head: head.map((h) => color.cyan(h)),
    style: { head: [], border: ["gray"] },
    colAligns: isCrap
      ? ["center", "right", "right", "right", "right", "right", "center", "left", "left", "left"]
      : ["center", "right", "right", "right", "right", "left", "left", "left"],
    wordWrap: true,
  })

  for (const entry of visible) {
    const row = isCrap
      ? [
          sevIcon(entry.severity, color),
          colorizeScore(entry, color),
          String(entry.complexity),
          String(entry.cognitive),
          String(entry.sloc),
          coverageBar(entry.coverage, color),
          confIcon(entry.confidence, color),
          entry.hint ?? "",
          entry.function,
          `${entry.file}:${entry.line}`,
        ]
      : [
          sevIcon(entry.severity, color),
          colorizeScore(entry, color),
          String(entry.complexity),
          String(entry.cognitive),
          String(entry.sloc),
          entry.hint ?? "",
          entry.function,
          `${entry.file}:${entry.line}`,
        ]
    table.push(row)
  }

  lines.push(table.toString())
  lines.push("")
  lines.push(failureLine(entries, opts, color))
  lines.push("")
  lines.push(footerLine(meta, color))
  lines.push("")

  return lines.join("\n")
}

/**
 * Sort entries with deterministic tie-breaking, so baseline-diffs don't
 * shuffle when two functions share a score.
 *   1. score desc
 *   2. file asc
 *   3. line asc
 */
export function sortEntries(entries: readonly CrapEntry[]): CrapEntry[] {
  const out = [...entries]
  out.sort((a, b) => {
    if (a.score !== b.score) return b.score - a.score
    if (a.file !== b.file) return a.file < b.file ? -1 : 1
    return a.line - b.line
  })
  return out
}

function filterEntries(entries: CrapEntry[], opts: HumanReportOptions): CrapEntry[] {
  let out = sortEntries(entries)
  if (opts.min !== undefined) out = out.filter((e) => e.score >= opts.min!)
  if (opts.top !== undefined) out = out.slice(0, opts.top)
  return out
}

function headerLine(meta: ReportMeta, color: Colorizer): string {
  const mode = meta.mode === "crap" ? "CRAP" : "complexity-only"
  return color.bold(`ts-crap · mode: ${mode}`)
}

function coverageSourceLine(meta: ReportMeta, color: Colorizer): string {
  const src = meta.coverageSource
  if (!src) return ""
  const desc = src.hint ?? src.kind ?? "unknown"
  return color.gray(`Using coverage: ${src.path} (${desc})`)
}

function stickyLine(d: NonNullable<ReportMeta["stickyDelta"]>, color: Colorizer): string {
  const parts: string[] = []
  if (d.regression) parts.push(color.red(`${d.regression} regression`))
  if (d.new) parts.push(color.yellow(`${d.new} new`))
  if (d.improved) parts.push(color.green(`${d.improved} improved`))
  if (d.removed) parts.push(color.gray(`${d.removed} removed`))
  if (d.moved) parts.push(color.gray(`${d.moved} moved`))
  return color.gray("Δ since last run: ") + parts.join(color.gray(" · "))
}

function noCoverageLine(color: Colorizer): string {
  return color.gray(
    "No coverage data found. Pass --lcov coverage/lcov.info or generate it to enable CRAP scoring."
  )
}

function summaryLine(
  entries: CrapEntry[],
  opts: HumanReportOptions,
  color: Colorizer
): string {
  const total = entries.length
  const worst = entries.reduce(
    (max, e) => (e.score > (max?.score ?? -Infinity) ? e : max),
    undefined as CrapEntry | undefined
  )
  const avg = total ? entries.reduce((s, e) => s + e.complexity, 0) / total : 0
  const errors = entries.filter((e) => e.severity === "error").length
  const warnings = entries.filter((e) => e.severity === "warning").length
  const infos = entries.filter((e) => e.severity === "info").length

  const parts = [
    `${total} fn`,
    `avg CC ${avg.toFixed(1)}`,
    worst ? `worst ${worst.function} (${displayScore(worst.score)})` : "",
    color.red(`${errors} error`),
    color.yellow(`${warnings} warning`),
    color.gray(`${infos} info`),
    `threshold ${opts.threshold}`,
  ].filter(Boolean)
  return parts.join("  ·  ")
}

function failureLine(
  entries: CrapEntry[],
  opts: HumanReportOptions,
  color: Colorizer
): string {
  const flagged = entries.filter(
    (e) => e.severity !== "ok" && e.severity !== "info" && !e.suppressed
  )
  if (flagged.length === 0) {
    return color.green(`✓ All ${entries.length} function(s) are within threshold ${opts.threshold}.`)
  }
  return color.red(
    `✗ ${flagged.length}/${entries.length} function(s) exceed threshold ${opts.threshold}.`
  )
}

function footerLine(meta: ReportMeta, color: Colorizer): string {
  const bits: string[] = []
  bits.push(`ts-crap@${meta.version}`)
  bits.push(`node@${meta.node}`)
  bits.push(meta.generatedAt)
  if (meta.coverageSource) {
    bits.push(`coverage: ${meta.coverageSource.path}`)
  } else {
    bits.push("coverage: none")
  }
  if (meta.configPath) {
    bits.push(`config: ${meta.configPath} (${meta.configSha ?? "?"})`)
  }
  bits.push(`cmd: ${meta.command}`)
  return color.gray(bits.join(" · "))
}

function sevIcon(s: Severity, color: Colorizer): string {
  if (s === "error") return color.red("✗")
  if (s === "warning") return color.yellow("▲")
  if (s === "info") return color.cyan("i")
  return color.green("✓")
}

function confIcon(c: Confidence, color: Colorizer): string {
  if (c === "exact") return color.green("●")
  if (c === "range") return color.yellow("◐")
  return color.gray("○")
}

function colorizeScore(entry: CrapEntry, color: Colorizer): string {
  const s = displayScore(entry.score)
  if (entry.severity === "error") return color.red(s)
  if (entry.severity === "warning") return color.yellow(s)
  return s
}

function coverageBar(pct: number | null, color: Colorizer): string {
  if (pct === null) return color.gray("no data")
  const filled = Math.round((pct / 10))
  const empty = 10 - filled
  const bar = color.green("█".repeat(filled)) + color.gray("░".repeat(empty))
  return `${bar} ${pct.toFixed(1).padStart(5)}%`
}

interface Colorizer {
  bold: (s: string) => string
  red: (s: string) => string
  green: (s: string) => string
  yellow: (s: string) => string
  cyan: (s: string) => string
  gray: (s: string) => string
}

function nullColorizer(): Colorizer {
  const id = (s: string) => s
  return { bold: id, red: id, green: id, yellow: id, cyan: id, gray: id }
}
