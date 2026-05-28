// Coverage-side data model. Independent of the parser (lcov, json-summary,
// clover, cobertura) - each parser fills these structures and we merge
// against AST metrics in merge.ts.
//
// Indexing rule: file coverage is keyed by line of the function START, not
// by function name. Names diverge across tools (mangled, renamed, anonymous);
// lines survive transpilation through source maps.

export type CoverageFormat = "lcov" | "json-summary" | "clover" | "cobertura"

export interface BranchHit {
  block: number
  branch: number
  // -1 = not instrumented; 0 = not taken; >0 = taken count
  taken: number
}

export interface FunctionHit {
  name: string // tool-provided; usually mangled, kept for diagnostics only
  hits: number
}

/**
 * Per-file coverage data, keyed by line numbers from the SOURCE side
 * (after source-map translation, if any). All maps may be empty: an
 * instrumented file with zero hits still produces an entry with empty maps
 * so we can distinguish "no data" from "no calls".
 */
export interface FileCoverage {
  // FN:<line>,<name> + FNDA:<count>,<name>  → keyed by FN line.
  fnHitsByLine: Map<number, FunctionHit>
  // DA:<line>,<hits>
  lineHits: Map<number, number>
  // BRDA:<line>,<block>,<branch>,<taken>  → grouped by source line.
  branchHitsByLine: Map<number, BranchHit[]>
}

export interface CoverageSource {
  format: CoverageFormat
  path: string // absolute or display-relative path of the source file
  // Optional descriptive label, e.g. "vitest@1.6.0 (line+branch)".
  hint?: string
  hasBranch: boolean
  hasFn: boolean
  hasLine: boolean
}

export interface CoverageMap {
  /**
   * File-level coverage. Keys are whatever the parser found in SF: records
   * (or equivalent). They may be absolute, workspace-relative, or even
   * relative to a directory that doesn't exist on this machine. Merge time
   * decides how to match them against discovered source files - see
   * `src/merge.ts`.
   */
  files: Map<string, FileCoverage>
  source: CoverageSource
}

export function emptyFileCoverage(): FileCoverage {
  return {
    fnHitsByLine: new Map(),
    lineHits: new Map(),
    branchHitsByLine: new Map(),
  }
}
