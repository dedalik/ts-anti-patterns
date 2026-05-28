// GitHub-Flavoured Markdown table. Renders well in PR bodies and READMEs.
// Severity emoji is in the leftmost column; unicode is fine in GFM.

import { sortEntries } from "./human.js"
import type { CrapEntry, ReportMeta } from "../options.js"

export interface MarkdownOptions {
  threshold: number
  top?: number
  min?: number
}

const SEV_EMOJI = {
  ok: "🟢",
  info: "🟡",
  warning: "🟠",
  error: "🔴",
} as const

export function renderMarkdown(
  entries: CrapEntry[],
  meta: ReportMeta,
  opts: MarkdownOptions
): string {
  const visible = filter(entries, opts)
  const isCrap = visible.some((e) => e.mode === "crap")

  const headers = isCrap
    ? ["Sev", "Score", "CC", "Cog", "SLOC", "Cov", "Conf", "Function", "Location", "Hint"]
    : ["Sev", "Score", "CC", "Cog", "SLOC", "Function", "Location", "Hint"]
  const aligns = isCrap
    ? [":-:", "--:", "--:", "--:", "--:", "--:", ":-:", "---", "---", "---"]
    : [":-:", "--:", "--:", "--:", "--:", "---", "---", "---"]

  const lines: string[] = []
  lines.push(`## ts-crap report - ${isCrap ? "CRAP" : "complexity-only"} mode`)
  lines.push("")
  if (meta.coverageSource) {
    lines.push(
      `> Coverage: \`${escape(meta.coverageSource.path)}\`` +
        (meta.coverageSource.hint ? ` (${escape(meta.coverageSource.hint)})` : "")
    )
    lines.push("")
  }
  lines.push(summaryLine(visible, opts.threshold))
  lines.push("")

  lines.push(`| ${headers.join(" | ")} |`)
  lines.push(`| ${aligns.join(" | ")} |`)
  for (const e of visible) {
    const cells = isCrap
      ? [
          SEV_EMOJI[e.severity],
          e.score.toFixed(1),
          String(e.complexity),
          String(e.cognitive),
          String(e.sloc),
          e.coverage == null ? "-" : `${e.coverage.toFixed(1)}%`,
          confSymbol(e.confidence),
          codeName(e),
          `\`${escape(e.file)}:${e.line}\``,
          e.hint ? escape(e.hint) : "",
        ]
      : [
          SEV_EMOJI[e.severity],
          e.score.toFixed(1),
          String(e.complexity),
          String(e.cognitive),
          String(e.sloc),
          codeName(e),
          `\`${escape(e.file)}:${e.line}\``,
          e.hint ? escape(e.hint) : "",
        ]
    lines.push(`| ${cells.join(" | ")} |`)
  }

  lines.push("")
  lines.push("---")
  lines.push(`<sub>ts-crap@${meta.version} · node@${meta.node} · ${meta.generatedAt}</sub>`)
  return lines.join("\n") + "\n"
}

function filter(entries: CrapEntry[], opts: MarkdownOptions): CrapEntry[] {
  let view = sortEntries(entries)
  if (typeof opts.min === "number") view = view.filter((e) => e.score >= opts.min!)
  if (typeof opts.top === "number") view = view.slice(0, opts.top)
  return view
}

function summaryLine(view: CrapEntry[], threshold: number): string {
  const counts = { error: 0, warning: 0, info: 0, ok: 0 }
  for (const e of view) counts[e.severity]++
  const bits = [
    `**${view.length}** fn`,
    `**${counts.error}** error`,
    `**${counts.warning}** warning`,
    `**${counts.info}** info`,
    `threshold **${threshold}**`,
  ]
  return bits.join(" · ")
}

function codeName(e: CrapEntry): string {
  const s = e.function ?? ""
  // Escape pipes inside function names so they don't break the table.
  return "`" + s.replace(/\|/g, "\\|") + "`"
}

function confSymbol(c: CrapEntry["confidence"]): string {
  if (c === "exact") return "●"
  if (c === "range") return "◐"
  return "○"
}

function escape(s: string): string {
  return s.replace(/\|/g, "\\|").replace(/\n/g, " ")
}
