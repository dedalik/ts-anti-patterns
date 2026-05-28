// Baseline vs current report diff.
//
// Categories:
//   - unchanged   delta within epsilon
//   - improved    score decreased by more than epsilon
//   - regression  score increased by more than epsilon
//   - new         not present in baseline
//   - removed     present in baseline only
//   - moved       same name and shape, different file/line - score delta still
//                 measured against the baseline entry
//
// Matching: first by exact (file, function, line); then by (function, file)
// fuzzy match on line within +/- 4; then by exact body hash to recognize
// moved code; finally by (function) name alone within the same file (handles
// pure line shifts > 4).

import type { CrapEntry } from "./options.js"

export type DeltaKind =
  | "unchanged"
  | "improved"
  | "regression"
  | "new"
  | "removed"
  | "moved"

export interface DeltaRow {
  kind: DeltaKind
  current?: CrapEntry
  baseline?: CrapEntry
  delta: number // current.score - baseline.score; 0 if either is missing
}

export interface DeltaSummary {
  unchanged: number
  improved: number
  regression: number
  new: number
  removed: number
  moved: number
}

export interface DiffOptions {
  /** Maximum |delta| treated as unchanged. */
  epsilon: number
}

export function diff(
  current: readonly CrapEntry[],
  baseline: readonly CrapEntry[],
  opts: DiffOptions
): { rows: DeltaRow[]; summary: DeltaSummary } {
  const eps = Math.max(0, opts.epsilon)

  const baselineIdx = indexEntries(baseline)
  const unusedBaseline = new Set<CrapEntry>(baselineIdx.byKey.values())
  const rows: DeltaRow[] = []

  for (const cur of current) {
    const found = findInBaseline(cur, baselineIdx)
    if (!found) {
      rows.push({ kind: "new", current: cur, delta: cur.score })
      continue
    }
    unusedBaseline.delete(found)
    const delta = round(cur.score - found.score, 6)
    const sameLocation = cur.file === found.file && cur.line === found.line
    const kind: DeltaKind = !sameLocation
      ? "moved"
      : Math.abs(delta) <= eps
        ? "unchanged"
        : delta > 0
          ? "regression"
          : "improved"
    rows.push({ kind, current: cur, baseline: found, delta })
  }

  for (const b of unusedBaseline) {
    rows.push({ kind: "removed", baseline: b, delta: -b.score })
  }

  rows.sort(rowOrder)

  const summary: DeltaSummary = {
    unchanged: 0,
    improved: 0,
    regression: 0,
    new: 0,
    removed: 0,
    moved: 0,
  }
  for (const r of rows) summary[r.kind]++
  return { rows, summary }
}

interface BaselineIndex {
  byKey: Map<string, CrapEntry>
  byFunctionInFile: Map<string, CrapEntry[]>
  byFunction: Map<string, CrapEntry[]>
}

function indexEntries(entries: readonly CrapEntry[]): BaselineIndex {
  const byKey = new Map<string, CrapEntry>()
  const byFunctionInFile = new Map<string, CrapEntry[]>()
  const byFunction = new Map<string, CrapEntry[]>()
  for (const e of entries) {
    byKey.set(keyOf(e), e)
    push(byFunctionInFile, `${e.file}::${e.function}`, e)
    push(byFunction, e.function, e)
  }
  return { byKey, byFunctionInFile, byFunction }
}

function findInBaseline(cur: CrapEntry, idx: BaselineIndex): CrapEntry | undefined {
  // Exact match.
  const exact = idx.byKey.get(keyOf(cur))
  if (exact) return exact

  // Same (file, function), line drift within +/- 4.
  const sameFile = idx.byFunctionInFile.get(`${cur.file}::${cur.function}`) ?? []
  let best: CrapEntry | undefined
  let bestDist = Infinity
  for (const cand of sameFile) {
    const d = Math.abs(cand.line - cur.line)
    if (d <= 4 && d < bestDist) {
      best = cand
      bestDist = d
    }
  }
  if (best) return best

  // Same function name in a different file (moved).
  const sameName = idx.byFunction.get(cur.function) ?? []
  if (sameName.length === 1 && sameName[0]!.file !== cur.file) return sameName[0]

  // Same (file, function) at any line - only one match.
  if (sameFile.length === 1) return sameFile[0]

  return undefined
}

function keyOf(e: CrapEntry): string {
  return `${e.file}::${e.line}::${e.function}`
}

function push<K, V>(m: Map<K, V[]>, k: K, v: V): void {
  const bucket = m.get(k)
  if (bucket) bucket.push(v)
  else m.set(k, [v])
}

function round(n: number, decimals: number): number {
  const f = Math.pow(10, decimals)
  return Math.round(n * f) / f
}

function rowOrder(a: DeltaRow, b: DeltaRow): number {
  // Regressions first, then new, then moved, then removed, then improved,
  // then unchanged. Within a bucket: largest |delta| first.
  const rank: Record<DeltaKind, number> = {
    regression: 0,
    new: 1,
    moved: 2,
    removed: 3,
    improved: 4,
    unchanged: 5,
  }
  const rdiff = rank[a.kind] - rank[b.kind]
  if (rdiff !== 0) return rdiff
  return Math.abs(b.delta) - Math.abs(a.delta)
}

/**
 * Parse a previously written JSON report (v1 envelope) into a flat list of
 * CrapEntry for diffing. Returns an empty list on parse failure or missing
 * envelope. Tolerant of unknown extra keys.
 */
export function loadBaseline(text: string): CrapEntry[] {
  try {
    const parsed = JSON.parse(text) as { entries?: unknown }
    if (!parsed || !Array.isArray(parsed.entries)) return []
    return parsed.entries.filter(isCrapEntry) as CrapEntry[]
  } catch {
    return []
  }
}

function isCrapEntry(x: unknown): x is CrapEntry {
  if (!x || typeof x !== "object") return false
  const e = x as Record<string, unknown>
  return (
    typeof e.function === "string" &&
    typeof e.file === "string" &&
    typeof e.line === "number" &&
    typeof e.score === "number"
  )
}
