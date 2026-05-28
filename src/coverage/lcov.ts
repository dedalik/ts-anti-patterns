// LCOV parser - line-keyed, with full BRDA branch support.
//
// LCOV record types we handle:
//   SF:<path>                       new file
//   FN:<line>,<name>                function declaration
//   FNDA:<count>,<name>             function hit count
//   DA:<line>,<hits>                line hit count
//   BRDA:<line>,<block>,<branch>,<taken>   branch hit
//   end_of_record                   close file
//
// Unrecognized record types (FNF, FNH, LF, LH, BRF, BRH) are summary counts
// that we recompute ourselves and therefore ignore.
//
// IMPORTANT: keys here are exactly what LCOV gave us. We do NOT canonicalize
// against CWD. That belongs to merge.ts, where we know which roots are being
// scanned.

import {
  emptyFileCoverage,
  type CoverageMap,
  type FileCoverage,
} from "./types.js"

export interface ParseLcovOptions {
  sourcePath: string
}

export function parseLcov(text: string, opts: ParseLcovOptions): CoverageMap {
  const files = new Map<string, FileCoverage>()
  let hasBranch = false
  let hasFn = false
  let hasLine = false

  // Per-record state. `endOfRecord` flushes into `files`.
  let currentFile = ""
  let current = emptyFileCoverage()
  // FN: gives us (line → name); FNDA: gives us (name → hits). We join at
  // end_of_record.
  let nameToLine = new Map<string, number>()
  let nameToHits = new Map<string, number>()

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue

    if (line.startsWith("SF:")) {
      currentFile = line.slice(3).trim()
      current = emptyFileCoverage()
      nameToLine = new Map()
      nameToHits = new Map()
      continue
    }

    if (line === "end_of_record") {
      if (currentFile) {
        joinFnHits(current, nameToLine, nameToHits)
        files.set(currentFile, current)
      }
      currentFile = ""
      current = emptyFileCoverage()
      nameToLine = new Map()
      nameToHits = new Map()
      continue
    }

    if (!currentFile) continue

    if (line.startsWith("FN:")) {
      const { lineNo, name } = parseFn(line.slice(3))
      if (name) {
        nameToLine.set(name, lineNo)
        hasFn = true
      }
      continue
    }

    if (line.startsWith("FNDA:")) {
      const { count, name } = parseFnda(line.slice(5))
      if (name) {
        nameToHits.set(name, (nameToHits.get(name) ?? 0) + count)
      }
      continue
    }

    if (line.startsWith("DA:")) {
      const { lineNo, hits } = parseDa(line.slice(3))
      if (lineNo > 0) {
        current.lineHits.set(lineNo, (current.lineHits.get(lineNo) ?? 0) + hits)
        hasLine = true
      }
      continue
    }

    if (line.startsWith("BRDA:")) {
      const brda = parseBrda(line.slice(5))
      if (brda) {
        const bucket = current.branchHitsByLine.get(brda.lineNo) ?? []
        bucket.push({ block: brda.block, branch: brda.branch, taken: brda.taken })
        current.branchHitsByLine.set(brda.lineNo, bucket)
        hasBranch = true
      }
      continue
    }
  }

  return {
    files,
    source: {
      format: "lcov",
      path: opts.sourcePath,
      hasBranch,
      hasFn,
      hasLine,
    },
  }
}

function joinFnHits(
  cov: FileCoverage,
  nameToLine: Map<string, number>,
  nameToHits: Map<string, number>
): void {
  for (const [name, line] of nameToLine) {
    const hits = nameToHits.get(name) ?? 0
    // Preserve the highest hit count if multiple FN entries collide on the
    // same line (e.g. overloads collapsed by the instrumenter).
    const prev = cov.fnHitsByLine.get(line)
    if (!prev || hits > prev.hits) {
      cov.fnHitsByLine.set(line, { name, hits })
    }
  }
}

function parseFn(payload: string): { lineNo: number; name: string } {
  // FN:<line>,<name>  - name may contain commas; only the first one separates.
  const comma = payload.indexOf(",")
  if (comma === -1) return { lineNo: 0, name: "" }
  const lineNo = parseInt(payload.slice(0, comma), 10)
  const name = payload.slice(comma + 1).trim()
  return { lineNo: Number.isFinite(lineNo) ? lineNo : 0, name }
}

function parseFnda(payload: string): { count: number; name: string } {
  // FNDA:<count>,<name>
  const comma = payload.indexOf(",")
  if (comma === -1) return { count: 0, name: "" }
  const count = parseInt(payload.slice(0, comma), 10)
  const name = payload.slice(comma + 1).trim()
  return { count: Number.isFinite(count) ? count : 0, name }
}

function parseDa(payload: string): { lineNo: number; hits: number } {
  // DA:<line>,<hits>[,<checksum>]
  const parts = payload.split(",")
  const lineNo = parseInt(parts[0] ?? "0", 10)
  const hitsRaw = parts[1] ?? "0"
  // Some tools emit "-" for "uninstrumented".
  const hits = hitsRaw === "-" ? 0 : parseInt(hitsRaw, 10)
  return {
    lineNo: Number.isFinite(lineNo) ? lineNo : 0,
    hits: Number.isFinite(hits) ? hits : 0,
  }
}

function parseBrda(payload: string):
  | { lineNo: number; block: number; branch: number; taken: number }
  | undefined {
  // BRDA:<line>,<block>,<branch>,<taken>
  // taken: integer hit count, or '-' meaning "branch not exercised at all".
  const parts = payload.split(",")
  if (parts.length < 4) return undefined
  const lineNo = parseInt(parts[0] ?? "0", 10)
  const block = parseInt(parts[1] ?? "0", 10)
  const branch = parseInt(parts[2] ?? "0", 10)
  const takenRaw = parts[3] ?? "0"
  const taken = takenRaw === "-" ? -1 : parseInt(takenRaw, 10)
  if (!Number.isFinite(lineNo) || lineNo <= 0) return undefined
  return {
    lineNo,
    block: Number.isFinite(block) ? block : 0,
    branch: Number.isFinite(branch) ? branch : 0,
    taken: Number.isFinite(taken) ? taken : -1,
  }
}
