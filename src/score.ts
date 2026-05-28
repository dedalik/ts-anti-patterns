// Scoring math: CRAP formula, severity bands, display rounding.
//
// CRAP(m) = comp(m)² × (1 − cov(m)/100)³ + comp(m)
//
// In CC-only mode (no coverage available), score reduces to CC, keeping the
// threshold semantics consistent across modes.

import type {
  FunctionMetric,
  Mode,
  Severity,
  MissingPolicy as MissingPolicyType,
} from "./options.js"

// Re-export so legacy importers keep working.
export type MissingPolicy = MissingPolicyType

/**
 * CRAP per function. coveragePct must be in [0, 100]. Use 0 for fully
 * uncovered (pessimistic), 100 for fully covered (optimistic), or call
 * scoreOf() which respects null + policy.
 */
export function computeCrap(complexity: number, coveragePct: number): number {
  const cov = coveragePct / 100
  return complexity ** 2 * (1 - cov) ** 3 + complexity
}

/**
 * Apply the missing-coverage policy. Returns null when 'skip' and coverage
 * is unknown - caller should drop the entry from the report.
 */
export function resolveCoverage(
  coverage: number | null,
  policy: MissingPolicy
): number | null {
  if (coverage !== null) return coverage
  if (policy === "pessimistic") return 0
  if (policy === "optimistic") return 100
  return null
}

/**
 * Compute the score the user actually sees in the report. In CRAP mode this
 * is CRAP; in CC-only mode this is just CC.
 */
export function scoreOf(
  m: Pick<FunctionMetric, "complexity">,
  coverage: number | null
): { score: number; mode: Mode } {
  if (coverage === null) {
    return { score: m.complexity, mode: "cc" }
  }
  return { score: computeCrap(m.complexity, coverage), mode: "crap" }
}

/**
 * Severity bands:
 *   ok       score <= threshold/2
 *   info     score <= threshold
 *   warning  score <= 2 * threshold
 *   error    score >  2 * threshold
 *
 * A function-local threshold from a `// ts-crap-threshold N` pragma
 * overrides the global threshold for that function.
 */
export function severityOf(
  score: number,
  threshold: number,
  localThreshold?: number
): Severity {
  const t = localThreshold ?? threshold
  if (score <= t / 2) return "ok"
  if (score <= t) return "info"
  if (score <= 2 * t) return "warning"
  return "error"
}

/** Display rounding: one fractional digit for stable, scannable columns. */
export function displayScore(score: number): string {
  return score.toFixed(1)
}

/** Legacy shape kept so reporter.ts compiles during Phase 1 transition. */
/** @deprecated use options.CrapEntry */
export interface CrapEntry {
  file: string
  function: string
  line: number
  complexity: number
  coverage: number | null
  crap: number
}
