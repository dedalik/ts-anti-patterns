// Shared types and option contracts for the whole pipeline.
// Keep dumb: only types, defaults, and tiny helpers. Anything with I/O
// belongs in a sibling module.

export type Severity = "ok" | "info" | "warning" | "error"
export type Confidence = "exact" | "range" | "none"
export type MissingPolicy = "pessimistic" | "optimistic" | "skip"
export type Mode = "crap" | "cc"
export type CoverageKind = "branch" | "fn" | "line" | null
export type Format =
  | "human"
  | "json"
  | "html"
  | "markdown"
  | "github"
  | "sarif"
  | "pr-comment"

export interface SuppressedInfo {
  reason: string
}

// Output of complexity + cognitive + pragma passes for a single function.
export interface FunctionMetric {
  file: string // absolute filesystem path
  function: string // class-qualified display name, never empty
  line: number // 1-based start of definition
  endLine: number // 1-based end of body
  complexity: number // cyclomatic (McCabe)
  cognitive: number // cognitive (Sonar / G. Ann Campbell)
  sloc: number // source lines of code (no blank, no pure-comment)
  suppressed?: SuppressedInfo
  localThreshold?: number
}

// Per-function row of the final report, with score and severity attached.
export interface CrapEntry extends FunctionMetric {
  coverage: number | null
  coverageKind: CoverageKind
  confidence: Confidence
  score: number
  mode: Mode
  severity: Severity
  hint?: string
}

// Reproducibility metadata stamped into every report.
export interface ReportMeta {
  version: string // ts-anti-patterns version
  generatedAt: string // ISO-8601 UTC
  node: string // process.version
  cwd: string
  command: string // argv.join(" ")
  mode: Mode
  coverageSource?: {
    path: string
    kind: CoverageKind
    hint?: string // e.g. "vitest@1.6.0 (line+branch)"
  }
  configPath?: string
  configSha?: string // short hash of resolved config
  /** Set when sticky baseline produced a delta (no explicit --baseline). */
  stickyDelta?: {
    unchanged: number
    improved: number
    regression: number
    new: number
    removed: number
    moved: number
  }
}

// Final resolved options - what every downstream module reads.
export interface ResolvedOptions {
  paths: string[]
  lcov?: string
  coverage?: string
  noCov: boolean
  threshold: number
  failAboveSeverity: Severity
  top?: number
  min?: number
  missing: MissingPolicy
  exclude: string[]
  allow: string[]
  format: Format
  summary: boolean
  workspace: boolean
  baseline?: string
  failAbove: boolean
  failRegression: boolean
  epsilon: number
  jobs: number
  output?: string
  watch: boolean

  // Quality knobs (see .github/docs/architecture.md)
  useBranchCoverage: boolean
  sourceMap?: string | "auto"
  diagnose?: string
  skipAnonymous: boolean
  countNullishCoalescing: boolean
  cognitive: boolean
  hints: boolean
  htmlInlineSource: boolean
  stickyBaseline: boolean
  cache: boolean
}

export const DEFAULT_OPTIONS: ResolvedOptions = {
  paths: [],
  noCov: true,
  threshold: 30,
  failAboveSeverity: "warning",
  top: 20,
  missing: "pessimistic",
  exclude: [],
  allow: [],
  format: "human",
  summary: false,
  workspace: false,
  failAbove: false,
  failRegression: false,
  epsilon: 0.01,
  jobs: Math.max(1, Math.min(8, defaultJobs())),
  watch: false,
  useBranchCoverage: true,
  skipAnonymous: false,
  countNullishCoalescing: false,
  cognitive: true,
  hints: true,
  htmlInlineSource: false,
  stickyBaseline: true,
  cache: true,
}

function defaultJobs(): number {
  // Lazy: we want a sane default without pulling os at type-time. Re-resolved
  // at runtime by the CLI; this constant just supplies a fallback.
  return 4
}

export function isSeverityAtLeast(actual: Severity, minimum: Severity): boolean {
  const order: Severity[] = ["ok", "info", "warning", "error"]
  return order.indexOf(actual) >= order.indexOf(minimum)
}
