// Config-file loading via cosmiconfig.
// Discovery walks up from CWD looking for any of:
//   - package.json     ("ts-anti-patterns" key)
//   - .ts-anti-patterns.json
//   - .ts-anti-patterns.yaml / .yml
//   - ts-anti-patterns.config.{js,cjs,mjs,ts,json}
//
// CLI flags override config. Unknown keys are reported but not fatal - we
// don't want a typo to wedge CI.

import { createHash } from "node:crypto"
import { cosmiconfig } from "cosmiconfig"
import { DEFAULT_OPTIONS, type ResolvedOptions, type Severity } from "./options.js"

export interface ConfigDiscovery {
  config: Partial<ResolvedOptions>
  configPath?: string
  configSha?: string
  unknownKeys: string[]
}

const KNOWN_KEYS = new Set<keyof ResolvedOptions>([
  "paths",
  "lcov",
  "coverage",
  "noCov",
  "threshold",
  "failAboveSeverity",
  "top",
  "min",
  "missing",
  "exclude",
  "allow",
  "format",
  "summary",
  "workspace",
  "baseline",
  "failAbove",
  "failRegression",
  "epsilon",
  "jobs",
  "output",
  "watch",
  "useBranchCoverage",
  "sourceMap",
  "diagnose",
  "skipAnonymous",
  "countNullishCoalescing",
  "cognitive",
  "hints",
  "htmlInlineSource",
  "stickyBaseline",
  "cache",
])

export async function loadConfig(searchFrom?: string): Promise<ConfigDiscovery> {
  const explorer = cosmiconfig("ts-anti-patterns", {
    searchPlaces: [
      "package.json",
      ".ts-anti-patterns.json",
      ".ts-anti-patterns.yaml",
      ".ts-anti-patterns.yml",
      "ts-anti-patterns.config.json",
      "ts-anti-patterns.config.js",
      "ts-anti-patterns.config.cjs",
      "ts-anti-patterns.config.mjs",
    ],
  })

  const result = await explorer.search(searchFrom)
  if (!result || result.isEmpty) {
    return { config: {}, unknownKeys: [] }
  }

  const raw = (result.config ?? {}) as Record<string, unknown>
  const unknownKeys: string[] = []
  const config: Partial<ResolvedOptions> = {}

  for (const [key, value] of Object.entries(raw)) {
    if (KNOWN_KEYS.has(key as keyof ResolvedOptions)) {
      ;(config as Record<string, unknown>)[key] = value
    } else {
      unknownKeys.push(key)
    }
  }

  const configSha = shortSha(JSON.stringify(config))
  return { config, configPath: result.filepath, configSha, unknownKeys }
}

/**
 * Merge: defaults < config < CLI. The CLI is the strongest voice.
 * Caller passes the CLI-only overrides; defaults come from DEFAULT_OPTIONS.
 */
export function mergeOptions(
  cli: Partial<ResolvedOptions>,
  fromConfig: Partial<ResolvedOptions>
): ResolvedOptions {
  return { ...DEFAULT_OPTIONS, ...fromConfig, ...cli }
}

export function isValidSeverity(s: string): s is Severity {
  return s === "ok" || s === "info" || s === "warning" || s === "error"
}

function shortSha(s: string): string {
  return createHash("sha256").update(s).digest("hex").slice(0, 8)
}
