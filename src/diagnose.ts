// `ts-anti-patterns --diagnose <file>` - focused debug output for one file.
//
// Prints:
//   - All functions the AST parser found (name, line, endLine, CC, cog, sloc).
//   - For each: what coverage matched (kind + confidence) or why none did.
//   - Filters/pragmas that affect the entry (skipAnonymous, suppressed, etc.).
//   - Applied config path + short SHA.

import { readFile } from "node:fs/promises"
import { analyzeFile } from "./complexity.js"
import { parsePragmas } from "./pragmas.js"
import { merge } from "./merge.js"
import type { CrapEntry, ResolvedOptions } from "./options.js"
import type { CoverageMap } from "./coverage/index.js"
import { canonicalize } from "./util/paths.js"

export interface DiagnoseContext {
  filePath: string // absolute path to the file
  source: string
  options: ResolvedOptions
  coverage: CoverageMap | null
  displayPath: (abs: string) => string
  configPath?: string
  configSha?: string
}

export async function diagnose(filePath: string, ctx: Omit<DiagnoseContext, "filePath" | "source">): Promise<string> {
  const abs = canonicalize(filePath)
  const source = await readFile(abs, "utf8")
  return diagnoseSync({ ...ctx, filePath: abs, source })
}

export function diagnoseSync(ctx: DiagnoseContext): string {
  const { filePath, source, options, coverage, displayPath } = ctx
  const lines: string[] = []
  lines.push("ts-anti-patterns diagnose")
  lines.push("================")
  lines.push(`file:     ${displayPath(filePath)}`)
  lines.push(`absolute: ${filePath}`)
  lines.push(`config:   ${ctx.configPath ?? "(none - defaults only)"}` + (ctx.configSha ? ` [${ctx.configSha}]` : ""))
  lines.push(`mode:     ${coverage ? "CRAP candidates" : "complexity-only"}`)
  if (coverage) {
    lines.push(`coverage: ${coverage.source.path} (${coverage.source.format})`)
  }
  lines.push("")

  // Run analysis directly so we capture every AST function - merge() does
  // the same work but also applies skip-anonymous etc.
  const metrics = analyzeFile(source, filePath, {
    cognitive: options.cognitive,
    countNullishCoalescing: options.countNullishCoalescing,
  })
  const pragmas = parsePragmas(source)
  const decoratedMetrics = metrics.map((m) => {
    const p = pragmas.get(m.line)
    return { ...m, suppressed: p?.suppressed, localThreshold: p?.localThreshold }
  })

  // Run merge to see which entries survive the filters.
  const entries = merge({
    metrics: decoratedMetrics,
    coverage,
    options,
    displayPath,
  })
  const entryByLine = new Map<number, CrapEntry>(entries.map((e) => [e.line, e]))

  lines.push(`functions discovered: ${decoratedMetrics.length}`)
  lines.push(`entries kept:         ${entries.length}`)
  lines.push("")
  lines.push("Detail:")
  for (const m of decoratedMetrics) {
    const e = entryByLine.get(m.line)
    lines.push(formatRow(m, e, options))
  }
  return lines.join("\n") + "\n"
}

interface MetricForRow {
  function: string
  line: number
  endLine: number
  complexity: number
  cognitive: number
  sloc: number
  suppressed?: { reason: string }
  localThreshold?: number
}

function formatRow(m: MetricForRow, e: CrapEntry | undefined, opts: ResolvedOptions): string {
  const head = `  ${m.function} @${m.line}-${m.endLine}  CC=${m.complexity} Cog=${m.cognitive} SLOC=${m.sloc}`
  const reasons: string[] = []
  if (!e) {
    if (opts.skipAnonymous && /^<(arrow|fn)@\d+>$/.test(m.function)) reasons.push("filtered (skipAnonymous)")
    else if (opts.missing === "skip") reasons.push("filtered (missing=skip, no coverage)")
    else reasons.push("filtered (unknown)")
  } else {
    reasons.push(`kept: score=${e.score.toFixed(1)} severity=${e.severity}`)
    if (e.coverage != null) {
      reasons.push(`coverage=${e.coverage.toFixed(1)}% via ${e.coverageKind} (${e.confidence})`)
    } else {
      reasons.push("coverage=none (CC-only)")
    }
    if (e.hint) reasons.push(`hint: "${e.hint}"`)
  }
  if (m.suppressed) reasons.push(`pragma: suppressed${m.suppressed.reason ? ` ("${m.suppressed.reason}")` : ""}`)
  if (typeof m.localThreshold === "number") reasons.push(`pragma: localThreshold=${m.localThreshold}`)
  return [head, ...reasons.map((r) => `    - ${r}`)].join("\n")
}
