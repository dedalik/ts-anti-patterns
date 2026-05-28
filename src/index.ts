// Programmatic API.
//
// Use this when you want ts-crap as a library:
//
//   import { analyze, renderHtml } from "ts-crap"
//   const { entries, meta } = await analyze({ paths: ["src"], threshold: 30 })
//   const html = await renderHtml(entries, meta, { threshold: 30 })
//
// The CLI uses the same building blocks. Keep this surface stable across
// minor versions.

import { collect, relPath } from "./walker.js"
import { analyzeFile } from "./complexity.js"
import { parsePragmas } from "./pragmas.js"
import { merge } from "./merge.js"
import pLimit from "p-limit"
import { loadCoverage, sniffCoverage, type CoverageMap } from "./coverage/index.js"
import { translateCoverage } from "./source-map.js"
import { readFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import { resolve as resolvePath } from "node:path"
import {
  DEFAULT_OPTIONS,
  type CrapEntry,
  type FunctionMetric,
  type ReportMeta,
  type ResolvedOptions,
} from "./options.js"

export type { CrapEntry, ReportMeta, ResolvedOptions, FunctionMetric, CoverageMap }

export { computeCrap, scoreOf, severityOf, resolveCoverage } from "./score.js"
export { renderHtml } from "./report/html.js"
export { renderJson } from "./report/json.js"
export { renderHuman } from "./report/human.js"
export { renderMarkdown } from "./report/markdown.js"
export { renderGithub } from "./report/github.js"
export { renderSarif } from "./report/sarif.js"
export { renderPrComment } from "./report/pr-comment.js"
export { diff, loadBaseline } from "./delta.js"
export { GLOSSARY, explain, listTerms } from "./glossary.js"

export interface AnalyzeResult {
  entries: CrapEntry[]
  meta: ReportMeta
}

export interface AnalyzeOptions extends Partial<ResolvedOptions> {
  /** Optional explicit coverage map (skip auto-detect and parsing). */
  coverageMap?: CoverageMap
}

/**
 * High-level analysis entry point. Returns the same CrapEntry array the CLI
 * would emit, plus reproducibility metadata. No I/O happens after this
 * returns: callers are free to pass the result into any of the renderers.
 */
export async function analyze(opts: AnalyzeOptions = {}): Promise<AnalyzeResult> {
  const resolved: ResolvedOptions = { ...DEFAULT_OPTIONS, ...opts }
  if (resolved.paths.length === 0) resolved.paths = ["."]

  const { root, files } = await collect(resolved)

  const concurrency = Math.max(1, Math.floor(resolved.jobs) || 1)
  const limit = pLimit(concurrency)
  const buckets: FunctionMetric[][] = new Array<FunctionMetric[]>(files.length)
  await Promise.all(
    files.map((file, i) =>
      limit(async () => {
        let source: string
        try {
          source = await readFile(file, "utf8")
        } catch {
          buckets[i] = []
          return
        }
        const fileMetrics = analyzeFile(source, file, {
          cognitive: resolved.cognitive,
          countNullishCoalescing: resolved.countNullishCoalescing,
        })
        const pragmas = parsePragmas(source)
        buckets[i] = fileMetrics.map((m) => {
          const pragma = pragmas.get(m.line)
          return {
            ...m,
            suppressed: pragma?.suppressed,
            localThreshold: pragma?.localThreshold,
          }
        })
      })
    )
  )
  const metrics: FunctionMetric[] = []
  for (const b of buckets) if (b) metrics.push(...b)

  let coverage: CoverageMap | null = opts.coverageMap ?? null
  if (!coverage && !resolved.noCov) {
    coverage = await loadCoverageForAnalyze(resolved, root)
  }

  const entries = merge({
    metrics,
    coverage,
    options: resolved,
    displayPath: (abs) => relPath(abs, root),
  })

  const meta: ReportMeta = {
    version: getVersion(),
    generatedAt: new Date().toISOString(),
    node: process.version,
    cwd: process.cwd(),
    command: "ts-crap (programmatic)",
    mode: coverage ? "crap" : "cc",
    coverageSource: coverage
      ? {
          path: coverage.source.path,
          kind: coverage.source.hasBranch
            ? "branch"
            : coverage.source.hasFn
              ? "fn"
              : coverage.source.hasLine
                ? "line"
                : null,
          hint: coverage.source.hint,
        }
      : undefined,
  }
  return { entries, meta }
}

async function loadCoverageForAnalyze(
  opts: ResolvedOptions,
  root: string
): Promise<CoverageMap | null> {
  const explicit = opts.lcov ?? opts.coverage
  if (explicit) {
    const abs = resolvePath(explicit)
    if (!existsSync(abs)) return null
    const cov = await loadCoverage(abs)
    return applySourceMap(cov, opts.sourceMap)
  }
  const sniffed = sniffCoverage(root) ?? sniffCoverage(process.cwd())
  if (!sniffed) return null
  const cov = await loadCoverage(sniffed.path, sniffed.format)
  return applySourceMap(cov, opts.sourceMap)
}

async function applySourceMap(cov: CoverageMap, mode: string | undefined): Promise<CoverageMap> {
  if (!mode) return cov
  if (mode === "auto" || mode === "true" || mode === "1") return await translateCoverage(cov)
  return await translateCoverage(cov, { baseDir: resolvePath(mode) })
}

function getVersion(): string {
  try {
    const url = new URL("../package.json", import.meta.url)
    const path = url.protocol === "file:" ? new URL(url).pathname : null
    if (!path) return "0.0.0"
    const { readFileSync } = require("node:fs") as typeof import("node:fs")
    const { version } = JSON.parse(readFileSync(path, "utf8")) as { version?: string }
    return version ?? "0.0.0"
  } catch {
    return "0.0.0"
  }
}

// `require` is provided by createRequire so we can JSON-load package.json
// without bringing the import-assertions ceremony into the public API.
import { createRequire as _createRequire } from "node:module"
const require: NodeRequire = _createRequire(import.meta.url)
