// Single source of truth for the metric glossary.
//
// The HTML report's `?` popovers and the `ts-crap explain <term>` CLI both
// read from here. Each entry has:
//   - `title` - short name shown in headings.
//   - `text`  - plain-text body for terminals and the CLI.
//   - `html`  - rich body for the HTML popover (a subset of markup).
//
// Keep these short. A glossary entry is a teaser, not documentation.

export interface GlossaryEntry {
  title: string
  text: string
  html: string
}

export const GLOSSARY: Record<string, GlossaryEntry> = {
  crap: {
    title: "CRAP score",
    text:
      "Change Risk Anti-Patterns score.\n" +
      "Formula: CRAP = comp² × (1 − cov/100)³ + comp\n" +
      "At 100% coverage CRAP equals complexity. At 0% coverage it grows " +
      "quadratically with complexity.",
    html:
      "<p>Change Risk Anti-Patterns score:</p>" +
      "<p><code>CRAP = comp² × (1 − cov/100)³ + comp</code></p>" +
      "<p>At 100% coverage CRAP equals complexity. At 0% coverage it grows quadratically.</p>",
  },
  cc: {
    title: "Cyclomatic Complexity (CC)",
    text:
      "McCabe's count of linearly independent paths through a function.\n" +
      "+1 per branch: if, each case except default, ?:, &&, ||, optional " +
      "chains, loops, catch. Nested functions don't add to the parent.",
    html:
      "<p>McCabe's count of linearly independent paths through a function.</p>" +
      "<p>+1 per branch: <code>if</code>, each <code>case</code> (except <code>default</code>), " +
      "<code>?:</code>, <code>&&</code>, <code>||</code>, optional chains, loops, " +
      "<code>catch</code>. Nested functions don't add to the parent.</p>",
  },
  cognitive: {
    title: "Cognitive Complexity",
    text:
      "Sonar / G. Ann Campbell's measure of how hard a function is for a " +
      "human to read. Penalises nesting (deeper = more) and recursion. " +
      "else-if chains don't compound.",
    html:
      "<p>Sonar / G. Ann Campbell's measure of how hard a function is for a human to read.</p>" +
      "<p>Penalises nesting (deeper = more) and recursion. <code>else if</code> chains don't compound.</p>",
  },
  coverage: {
    title: "Coverage",
    text:
      "Per-function execution coverage from your test runner.\n" +
      "ts-crap picks the highest-confidence source available:\n" +
      "  1. Branch coverage (BRDA / cond) - every decision exercised.\n" +
      "  2. Function coverage (FN / FNDA) - function entered at least once.\n" +
      "  3. Line-range fallback - average of hit-counts across the body.",
    html:
      "<p>Per-function execution coverage from your test runner. ts-crap chooses the " +
      "highest-confidence source available:</p>" +
      "<ol><li><strong>Branch</strong> coverage (BRDA / cond) - every decision exercised.</li>" +
      "<li><strong>Function</strong> coverage (FN / FNDA) - function entered at least once.</li>" +
      "<li><strong>Line-range</strong> fallback - average of hit-counts across the body.</li></ol>",
  },
  confidence: {
    title: "Confidence",
    text:
      "How precise the coverage signal is:\n" +
      "  ● exact  - branch or fn-level data covers this function.\n" +
      "  ◐ range  - line-range fallback (less precise).\n" +
      "  ○ none   - no coverage data for this function.",
    html:
      "<p>How precise the coverage signal is:</p>" +
      "<p><code>●</code> exact - branch or fn-level data covers this function.</p>" +
      "<p><code>◐</code> range - line-range fallback (less precise).</p>" +
      "<p><code>○</code> none - no coverage data for this function.</p>",
  },
  severity: {
    title: "Severity bands",
    text:
      "Calculated from score vs threshold (T):\n" +
      "  ok       score ≤ T/2\n" +
      "  info     T/2 < score ≤ T\n" +
      "  warning  T  < score ≤ 2T\n" +
      "  error    score > 2T\n" +
      "A `// ts-crap-threshold N` pragma overrides T for one function.",
    html:
      "<p>Calculated from score vs threshold (T):</p>" +
      "<ul><li><code>ok</code>: score ≤ T/2</li>" +
      "<li><code>info</code>: T/2 < score ≤ T</li>" +
      "<li><code>warning</code>: T < score ≤ 2T</li>" +
      "<li><code>error</code>: score > 2T</li></ul>" +
      "<p>A <code>// ts-crap-threshold N</code> pragma overrides T for one function.</p>",
  },
  missing: {
    title: "Missing-coverage policy",
    text:
      "What to do with functions that aren't in any coverage record:\n" +
      "  pessimistic - treat as 0% (default; punishes blind spots)\n" +
      "  optimistic  - treat as 100%\n" +
      "  skip        - drop from the report",
    html:
      "<p>What to do with functions that aren't covered by any coverage record:</p>" +
      "<ul><li><code>pessimistic</code>: treat as 0% (default - punishes blind spots)</li>" +
      "<li><code>optimistic</code>: treat as 100%</li>" +
      "<li><code>skip</code>: drop from the report</li></ul>",
  },
  pragma: {
    title: "In-source pragmas",
    text:
      "// ts-crap-ignore [reason]\n" +
      "  Suppresses the next function from --fail-above. The reason appears " +
      "in the Suppressed section.\n\n" +
      "// ts-crap-threshold N\n" +
      "  Per-function threshold that overrides the global one for severity.",
    html:
      "<p><code>// ts-crap-ignore [reason]</code> on the line above a function " +
      "suppresses it from <code>--fail-above</code>. The reason shows up in the " +
      "Suppressed section.</p>" +
      "<p><code>// ts-crap-threshold N</code> sets a per-function threshold that " +
      "overrides the global one for that function's severity.</p>",
  },
}

export function explain(term: string): string | null {
  const key = term.trim().toLowerCase()
  const entry = GLOSSARY[key]
  if (!entry) return null
  return `${entry.title}\n${"-".repeat(entry.title.length)}\n${entry.text}\n`
}

export function listTerms(): string[] {
  return Object.keys(GLOSSARY).sort()
}
