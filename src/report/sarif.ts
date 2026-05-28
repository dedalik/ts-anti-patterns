// SARIF 2.1.0 output - the format GitHub Code Scanning consumes for
// inline PR annotations and the Security tab.
//
// Schema reference: https://docs.oasis-open.org/sarif/sarif/v2.1.0/
//
// One rule: `ts-crap/score`. Each function above OK severity → one result
// with level note|warning|error chosen by severity.

import { sortEntries } from "./human.js"
import type { CrapEntry, ReportMeta, Severity } from "../options.js"

export interface SarifOptions {
  threshold: number
  top?: number
  min?: number
}

const LEVEL: Record<Severity, "note" | "warning" | "error" | null> = {
  ok: null,
  info: "note",
  warning: "warning",
  error: "error",
}

const VERSION = "2.1.0"
const SCHEMA = "https://json.schemastore.org/sarif-2.1.0.json"

export function renderSarif(
  entries: CrapEntry[],
  meta: ReportMeta,
  opts: SarifOptions
): string {
  let view = sortEntries(entries)
  if (typeof opts.min === "number") view = view.filter((e) => e.score >= opts.min!)
  if (typeof opts.top === "number") view = view.slice(0, opts.top)

  const results = []
  for (const e of view) {
    const level = LEVEL[e.severity]
    if (!level) continue
    results.push({
      ruleId: "ts-crap/score",
      level,
      message: {
        text: messageText(e, opts.threshold),
        markdown: messageMarkdown(e, opts.threshold),
      },
      locations: [
        {
          physicalLocation: {
            artifactLocation: { uri: e.file, uriBaseId: "%SRCROOT%" },
            region: { startLine: e.line, endLine: e.endLine },
          },
        },
      ],
      properties: {
        score: round(e.score),
        complexity: e.complexity,
        cognitive: e.cognitive,
        sloc: e.sloc,
        coverage: e.coverage == null ? null : round(e.coverage),
        coverageKind: e.coverageKind,
        confidence: e.confidence,
        severity: e.severity,
        mode: e.mode,
        suppressed: !!e.suppressed,
      },
    })
  }

  const doc = {
    $schema: SCHEMA,
    version: VERSION,
    runs: [
      {
        tool: {
          driver: {
            name: "ts-crap",
            version: meta.version,
            informationUri: "https://github.com/dedalik/ts-crap",
            rules: [
              {
                id: "ts-crap/score",
                name: "CrapScore",
                shortDescription: {
                  text: "Function exceeds the configured ts-crap threshold.",
                },
                fullDescription: {
                  text:
                    "CRAP = comp² × (1 − cov/100)³ + comp. In CC-only mode " +
                    "(no coverage source) the score equals cyclomatic complexity.",
                },
                helpUri: "https://github.com/dedalik/ts-crap#crap-score",
                defaultConfiguration: { level: "warning" },
                properties: { tags: ["maintainability", "complexity", "ts-crap"] },
              },
            ],
          },
        },
        invocations: [
          {
            commandLine: meta.command,
            startTimeUtc: meta.generatedAt,
            executionSuccessful: true,
          },
        ],
        results,
      },
    ],
  }

  return JSON.stringify(doc, null, 2) + "\n"
}

function messageText(e: CrapEntry, threshold: number): string {
  const cov = e.coverage == null ? "n/a" : `${e.coverage.toFixed(1)}% (${e.confidence})`
  return (
    `${e.function} has CRAP ${e.score.toFixed(1)} (threshold ${threshold}). ` +
    `CC=${e.complexity}, Cog=${e.cognitive}, SLOC=${e.sloc}, cov=${cov}.` +
    (e.hint ? ` ${e.hint}` : "")
  )
}

function messageMarkdown(e: CrapEntry, threshold: number): string {
  const lines = [
    `**${e.function}** - score **${e.score.toFixed(1)}** (threshold ${threshold})`,
    "",
    `- CC: \`${e.complexity}\``,
    `- Cognitive: \`${e.cognitive}\``,
    `- SLOC: \`${e.sloc}\``,
  ]
  if (e.coverage != null) {
    lines.push(`- Coverage: \`${e.coverage.toFixed(1)}%\` (\`${e.confidence}\`)`)
  }
  if (e.hint) {
    lines.push("")
    lines.push(`> ${e.hint}`)
  }
  return lines.join("\n")
}

function round(n: number): number {
  return Math.round(n * 100) / 100
}
