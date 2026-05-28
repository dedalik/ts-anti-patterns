// Join AST metrics (which know absolute filesystem paths) with coverage
// data (which may use relative, workspace-relative, or absolute paths from
// the test runner's CWD - different from ours).
//
// The CRITICAL invariant: relative LCOV paths are NEVER resolved against
// ts-crap's own CWD. We only join via component-level suffix matching. This
// keeps the tool correct when run from a different directory than the
// project root (e.g., a monorepo, a CI script that cd's, an editor plugin).
//
// Coverage priority for each function:
//   1. Branch coverage in [fn.line, fn.endLine]   → confidence "exact",  kind "branch"
//   2. FN/FNDA exactly at fn.line                 → confidence "exact",  kind "fn"
//   3. Line coverage in [fn.line, fn.endLine]     → confidence "range",  kind "line"
//   4. Nothing                                    → confidence "none",   kind null
//
// In case 4, we apply the missing-coverage policy at the cli layer; merge
// itself just reports `coverage: null`.

import { componentsOf, canonicalize, caseFold } from "./util/paths.js"
import { hintFor } from "./hints.js"
import { scoreOf, severityOf } from "./score.js"
import type {
  CoverageKind,
  Confidence,
  CrapEntry,
  FunctionMetric,
  ResolvedOptions,
} from "./options.js"
import type { CoverageMap, FileCoverage } from "./coverage/types.js"

export interface MergeContext {
  metrics: FunctionMetric[]
  coverage: CoverageMap | null
  options: ResolvedOptions
  // Map of absolute filesystem path → relative-display path for output.
  // merge does not compute this - cli passes it in.
  displayPath: (abs: string) => string
}

export function merge(ctx: MergeContext): CrapEntry[] {
  const { metrics, coverage, options } = ctx
  const index = coverage ? buildIndex(coverage) : undefined

  const out: CrapEntry[] = []
  for (const m of metrics) {
    if (options.skipAnonymous && /^<(arrow|fn)@\d+>$/.test(m.function)) continue

    const lookup = index ? lookupFileCoverage(index, m.file) : undefined
    const { coverage: cov, coverageKind, confidence } = pickCoverage(lookup, m, options)

    // Missing-coverage policy only applies when a coverage source exists.
    // No source at all → CC-only mode; we never invent a coverage number.
    let policyCov: number | null = cov
    if (coverage && cov === null) {
      const next = applyMissingPolicy(options)
      if (next === undefined) continue // missing=skip
      policyCov = next
    }
    const { score, mode } = scoreOf(m, policyCov)
    const severity = severityOf(score, options.threshold, m.localThreshold)

    out.push({
      ...m,
      file: ctx.displayPath(m.file),
      coverage: policyCov,
      coverageKind,
      confidence,
      score,
      mode,
      severity,
    })
  }

  if (options.hints) {
    for (const entry of out) {
      const hint = hintFor({
        complexity: entry.complexity,
        cognitive: entry.cognitive,
        coverage: entry.coverage,
        mode: entry.mode,
        threshold: options.threshold,
      })
      if (hint) entry.hint = hint
    }
  }

  return out
}

// --- Path index -----------------------------------------------------------

interface CoverageIndex {
  /** Canonical absolute path → FileCoverage. */
  byAbsolute: Map<string, FileCoverage>
  /**
   * For relative or unrooted coverage paths. Keyed by the LAST component
   * (basename) for O(1) initial filter, then we verify with full suffix
   * match against candidate metric paths.
   */
  byBasename: Map<string, Array<{ components: string[]; cov: FileCoverage }>>
}

function buildIndex(cov: CoverageMap): CoverageIndex {
  const byAbsolute = new Map<string, FileCoverage>()
  const byBasename = new Map<string, Array<{ components: string[]; cov: FileCoverage }>>()

  for (const [rawPath, fileCov] of cov.files) {
    const components = componentsOf(rawPath)
    if (components.length === 0) continue

    if (rawPath.startsWith("/") || /^[A-Za-z]:[\\/]/.test(rawPath)) {
      // Absolute (POSIX or Windows). Canonicalize once.
      byAbsolute.set(caseFold(canonicalize(rawPath)), fileCov)
      continue
    }

    // Relative - go into the suffix index.
    const last = components[components.length - 1]
    if (!last) continue
    const key = caseFold(last)
    const bucket = byBasename.get(key) ?? []
    bucket.push({ components, cov: fileCov })
    byBasename.set(key, bucket)
  }

  return { byAbsolute, byBasename }
}

function lookupFileCoverage(
  index: CoverageIndex,
  absPath: string
): FileCoverage | undefined {
  // Direct absolute hit first.
  const direct = index.byAbsolute.get(caseFold(canonicalize(absPath)))
  if (direct) return direct

  // Suffix-match: bucket by basename, then accept the LONGEST matching suffix.
  // We do NOT join the relative path with CWD or any root.
  const target = componentsOf(absPath).map(caseFold)
  if (target.length === 0) return undefined
  const last = target[target.length - 1]
  if (!last) return undefined
  const bucket = index.byBasename.get(last)
  if (!bucket) return undefined

  let best: { matchLen: number; cov: FileCoverage } | undefined
  for (const cand of bucket) {
    const candComps = cand.components.map(caseFold)
    const matchLen = suffixMatchLength(target, candComps)
    if (matchLen === 0) continue
    if (!best || matchLen > best.matchLen) {
      best = { matchLen, cov: cand.cov }
    }
  }
  return best?.cov
}

function suffixMatchLength(target: readonly string[], candidate: readonly string[]): number {
  const n = Math.min(target.length, candidate.length)
  let matched = 0
  for (let i = 1; i <= n; i++) {
    if (target[target.length - i] !== candidate[candidate.length - i]) break
    matched++
  }
  // All of `candidate` must be a suffix of `target` for a valid match.
  return matched === candidate.length ? matched : 0
}

// --- Coverage selection ---------------------------------------------------

interface CoveragePick {
  coverage: number | null
  coverageKind: CoverageKind
  confidence: Confidence
}

function pickCoverage(
  fileCov: FileCoverage | undefined,
  m: FunctionMetric,
  opts: ResolvedOptions
): CoveragePick {
  if (!fileCov) return { coverage: null, coverageKind: null, confidence: "none" }

  if (opts.useBranchCoverage) {
    const branch = branchCoverageIn(fileCov, m.line, m.endLine)
    if (branch !== null) {
      return { coverage: branch, coverageKind: "branch", confidence: "exact" }
    }
  }

  const fnHit = fileCov.fnHitsByLine.get(m.line)
  if (fnHit !== undefined) {
    return {
      coverage: fnHit.hits > 0 ? 100 : 0,
      coverageKind: "fn",
      confidence: "exact",
    }
  }

  const line = lineCoverageIn(fileCov, m.line, m.endLine)
  if (line !== null) {
    return { coverage: line, coverageKind: "line", confidence: "range" }
  }

  return { coverage: null, coverageKind: null, confidence: "none" }
}

function branchCoverageIn(
  fc: FileCoverage,
  startLine: number,
  endLine: number
): number | null {
  let total = 0
  let taken = 0
  let seen = false
  for (const [line, hits] of fc.branchHitsByLine) {
    if (line < startLine || line > endLine) continue
    for (const h of hits) {
      if (h.taken === -1) continue // not instrumented
      total++
      if (h.taken > 0) taken++
      seen = true
    }
  }
  if (!seen || total === 0) return null
  return (taken / total) * 100
}

function lineCoverageIn(
  fc: FileCoverage,
  startLine: number,
  endLine: number
): number | null {
  let total = 0
  let hit = 0
  for (const [line, hits] of fc.lineHits) {
    if (line < startLine || line > endLine) continue
    total++
    if (hits > 0) hit++
  }
  if (total === 0) return null
  return (hit / total) * 100
}

function applyMissingPolicy(opts: ResolvedOptions): number | undefined {
  if (opts.missing === "pessimistic") return 0
  if (opts.missing === "optimistic") return 100
  return undefined // skip
}
