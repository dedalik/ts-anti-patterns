// Source-level pragmas:
//   // ts-crap-ignore "reason"        suppress this function from --fail-above
//   // ts-crap-ignore reason text     (quotes optional)
//   // ts-crap-threshold 60           override threshold for this function
//
// The pragma must be on a line directly above a function-bearing statement.
// Blank lines between the pragma and the function are allowed; other code or
// non-pragma comments break the association.
//
// We don't try to be clever with TSDoc/JSDoc - only line comments starting
// with the ts-crap- prefix qualify.

export interface PragmaInfo {
  suppressed?: { reason: string }
  localThreshold?: number
}

/**
 * Parse the source for ts-crap pragmas, returning a map keyed by the 1-based
 * line of the *first non-blank, non-comment line beneath the pragma block*.
 * The function-name resolver in complexity.ts records each function at its
 * declaration line; the orchestrator joins by that same line.
 *
 * Lines that aren't pragma-bearing are absent from the map.
 */
export function parsePragmas(source: string): Map<number, PragmaInfo> {
  const out = new Map<number, PragmaInfo>()
  const lines = source.split(/\r?\n/)

  let pending: PragmaInfo | undefined
  let pendingLine = -1

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i] ?? ""
    const trimmed = raw.trim()

    if (!trimmed) {
      // Blank line - preserves the pending pragma if any.
      continue
    }

    if (trimmed.startsWith("//")) {
      const directive = trimmed.slice(2).trim()
      const parsed = parsePragmaLine(directive)
      if (parsed) {
        pending = mergePragma(pending, parsed)
        pendingLine = i + 1
        continue
      }
      // A non-pragma comment in between breaks the association.
      pending = undefined
      pendingLine = -1
      continue
    }

    // Real code line - bind any pending pragma here.
    if (pending) {
      out.set(i + 1, pending)
      pending = undefined
      pendingLine = -1
    }
  }

  // Suppress the lint warning if pendingLine ended up unused (file ended in pragma).
  void pendingLine

  return out
}

function parsePragmaLine(directive: string): PragmaInfo | undefined {
  // Match either `ts-crap-ignore <rest>` or `ts-crap-threshold <n>`.
  const ignoreMatch = directive.match(/^ts-crap-ignore(?:\s+(.*))?$/)
  if (ignoreMatch) {
    const rawReason = (ignoreMatch[1] ?? "").trim()
    const reason = stripQuotes(rawReason) || "(no reason given)"
    return { suppressed: { reason } }
  }
  const thresholdMatch = directive.match(/^ts-crap-threshold\s+(-?\d+(?:\.\d+)?)\s*$/)
  if (thresholdMatch) {
    const value = parseFloat(thresholdMatch[1] ?? "NaN")
    if (Number.isFinite(value) && value >= 0) {
      return { localThreshold: value }
    }
  }
  return undefined
}

function stripQuotes(s: string): string {
  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'"))
  ) {
    return s.slice(1, -1)
  }
  return s
}

function mergePragma(a: PragmaInfo | undefined, b: PragmaInfo): PragmaInfo {
  if (!a) return b
  return {
    suppressed: b.suppressed ?? a.suppressed,
    localThreshold: b.localThreshold ?? a.localThreshold,
  }
}
