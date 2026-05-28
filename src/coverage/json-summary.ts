// istanbul `coverage-summary.json` (and full `coverage-final.json`) parser.
//
// `coverage-summary.json` is per-file aggregate: { lines, statements, functions, branches }
// with `{ total, covered, skipped, pct }` payloads. No per-line data - we
// produce a single synthetic "average" entry per file that merge.ts can use
// as a line-range fallback (confidence = "range").
//
// `coverage-final.json` is per-line detail and supports function-level
// hits, but is much heavier. We detect it by the presence of `statementMap`
// / `fnMap` / `branchMap` keys.

import {
  emptyFileCoverage,
  type CoverageMap,
  type FileCoverage,
} from "./types.js"

export interface ParseJsonSummaryOptions {
  sourcePath: string
}

interface SummaryBlock {
  total?: number
  covered?: number
  pct?: number
}

interface FinalFileBlock {
  fnMap?: Record<
    string,
    { name?: string; line?: number; decl?: { start?: { line?: number } } }
  >
  f?: Record<string, number>
  statementMap?: Record<string, { start?: { line?: number } }>
  s?: Record<string, number>
  branchMap?: Record<
    string,
    { line?: number; loc?: { start?: { line?: number } } }
  >
  b?: Record<string, number[]>
}

export function parseJsonSummary(text: string, opts: ParseJsonSummaryOptions): CoverageMap {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return {
      files: new Map(),
      source: {
        format: "json-summary",
        path: opts.sourcePath,
        hasBranch: false,
        hasFn: false,
        hasLine: false,
      },
    }
  }
  if (!parsed || typeof parsed !== "object") {
    return {
      files: new Map(),
      source: {
        format: "json-summary",
        path: opts.sourcePath,
        hasBranch: false,
        hasFn: false,
        hasLine: false,
      },
    }
  }

  const data = parsed as Record<string, unknown>
  // coverage-final.json carries per-statement detail; coverage-summary.json
  // carries only aggregate `pct` values. Detect by inspecting the first entry.
  const finalDetected = looksLikeFinal(data)

  const files = new Map<string, FileCoverage>()
  let hasBranch = false
  let hasFn = false
  let hasLine = false

  for (const [key, value] of Object.entries(data)) {
    if (key === "total") continue // summary aggregate, skip
    if (!value || typeof value !== "object") continue
    const cov = emptyFileCoverage()

    if (finalDetected) {
      const block = value as FinalFileBlock
      if (block.fnMap && block.f) {
        for (const [id, def] of Object.entries(block.fnMap)) {
          const line = def.decl?.start?.line ?? def.line ?? 0
          if (!line) continue
          const hits = block.f[id] ?? 0
          cov.fnHitsByLine.set(line, { name: def.name ?? `<fn#${id}>`, hits })
          hasFn = true
        }
      }
      if (block.statementMap && block.s) {
        for (const [id, def] of Object.entries(block.statementMap)) {
          const line = def.start?.line ?? 0
          if (!line) continue
          const hits = block.s[id] ?? 0
          cov.lineHits.set(line, (cov.lineHits.get(line) ?? 0) + hits)
          hasLine = true
        }
      }
      if (block.branchMap && block.b) {
        for (const [id, def] of Object.entries(block.branchMap)) {
          const line = def.loc?.start?.line ?? def.line ?? 0
          if (!line) continue
          const taken = block.b[id] ?? []
          const bucket = cov.branchHitsByLine.get(line) ?? []
          for (let i = 0; i < taken.length; i++) {
            bucket.push({ block: parseInt(id, 10) || 0, branch: i, taken: taken[i] ?? -1 })
          }
          cov.branchHitsByLine.set(line, bucket)
          hasBranch = true
        }
      }
    } else {
      // Aggregate summary: synthesize one "line 1" entry expressing the
      // file-wide percentage. merge.ts treats this as a range fallback.
      const summary = value as { lines?: SummaryBlock }
      const pct = summary.lines?.pct
      if (typeof pct === "number" && Number.isFinite(pct)) {
        // We can't key per-line; we encode the percentage as a single hit on
        // line 1 with synthetic totals. merge.ts decides what to do with it
        // when it can't find per-function data.
        const total = summary.lines?.total ?? 0
        const covered = summary.lines?.covered ?? 0
        cov.lineHits.set(1, covered)
        // Carry the total via a sentinel line that won't collide with real ones.
        cov.lineHits.set(0, total)
        hasLine = true
      }
    }

    if (cov.fnHitsByLine.size + cov.lineHits.size + cov.branchHitsByLine.size > 0) {
      files.set(key, cov)
    }
  }

  return {
    files,
    source: {
      format: "json-summary",
      path: opts.sourcePath,
      hasBranch,
      hasFn,
      hasLine,
    },
  }
}

function looksLikeFinal(data: Record<string, unknown>): boolean {
  for (const [k, v] of Object.entries(data)) {
    if (k === "total") continue
    if (v && typeof v === "object") {
      const block = v as Record<string, unknown>
      return "statementMap" in block || "fnMap" in block || "branchMap" in block
    }
  }
  return false
}
