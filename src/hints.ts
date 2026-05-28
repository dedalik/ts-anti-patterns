// Actionable, deterministic hints for each function in the report.
// Strictly rule-based - no LLM, no network. The rules express the four
// CC×Coverage quadrants and what to do in each.
//
// In CC-only mode (no coverage data) we still produce hints, but only the
// ones that depend on CC alone.

import type { CrapEntry, FunctionMetric, Mode } from "./options.js"

export interface HintInput
  extends Pick<FunctionMetric, "complexity" | "cognitive"> {
  coverage: number | null
  mode: Mode
  threshold: number
}

const TRIVIAL_CC = 5
const HIGH_CC_LIMIT = 15

/**
 * Pick one short, actionable hint. Returns undefined for ok/trivial rows.
 */
export function hintFor(entry: HintInput): string | undefined {
  const { complexity, cognitive, coverage, mode, threshold } = entry

  if (mode === "cc" || coverage === null) {
    if (complexity > threshold) {
      return cognitive > complexity * 1.5
        ? "Highly nested - flatten branches or split this function."
        : "Too complex - split this function or extract branches."
    }
    if (complexity > threshold / 2) {
      return "Borderline complexity - add tests and watch it doesn't grow."
    }
    return undefined
  }

  // CRAP mode - coverage is meaningful.
  if (coverage >= 80) {
    if (complexity > threshold) {
      return "Tests can't save this - simplify (extract 1-2 branches)."
    }
    return undefined
  }

  if (complexity <= TRIVIAL_CC) {
    if (coverage < 50) {
      return "Cheap to test - 1 or 2 tests will move you to green."
    }
    return undefined
  }

  if (complexity <= HIGH_CC_LIMIT) {
    if (coverage < 50) {
      return "Untested complexity - add tests to cut score sharply."
    }
    return "Mid-complexity - raise coverage above 80% to flatten the score."
  }

  // High CC + low/medium coverage
  if (coverage < 30) {
    return "Hot risk: complex AND untested - prioritize."
  }
  return "Complex code - simplify, then test the remaining branches."
}

/** Decorate entries in-place with hints. */
export function applyHints(entries: CrapEntry[], threshold: number): void {
  for (const entry of entries) {
    const hint = hintFor({
      complexity: entry.complexity,
      cognitive: entry.cognitive,
      coverage: entry.coverage,
      mode: entry.mode,
      threshold,
    })
    if (hint) entry.hint = hint
  }
}
