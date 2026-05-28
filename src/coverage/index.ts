// Coverage dispatcher: pick the format and parser, or sniff the filesystem
// for a known location. Used by the CLI to keep parsing logic out of cli.ts.

import { readFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import { join, basename } from "node:path"
import { parseLcov } from "./lcov.js"
import { parseJsonSummary } from "./json-summary.js"
import { parseClover } from "./clover.js"
import { parseCobertura } from "./cobertura.js"
import type { CoverageFormat, CoverageMap } from "./types.js"

const SNIFF_CANDIDATES: Array<{ relPath: string; format: CoverageFormat }> = [
  { relPath: "coverage/lcov.info", format: "lcov" },
  { relPath: "coverage/coverage-final.json", format: "json-summary" },
  { relPath: "coverage/coverage-summary.json", format: "json-summary" },
  { relPath: "coverage/clover.xml", format: "clover" },
  { relPath: "coverage/cobertura-coverage.xml", format: "cobertura" },
  { relPath: "lcov.info", format: "lcov" },
]

/** Walk through known locations under root; return the first that exists. */
export function sniffCoverage(root: string): { path: string; format: CoverageFormat } | null {
  for (const cand of SNIFF_CANDIDATES) {
    const full = join(root, cand.relPath)
    if (existsSync(full)) return { path: full, format: cand.format }
  }
  return null
}

/** Guess format from filename when the user passes an explicit path. */
export function formatFromPath(p: string): CoverageFormat {
  const name = basename(p).toLowerCase()
  if (name.endsWith(".info") || name.endsWith(".lcov")) return "lcov"
  if (name.endsWith("clover.xml")) return "clover"
  if (name.includes("cobertura")) return "cobertura"
  if (name.endsWith(".xml")) return "clover"
  if (name.endsWith(".json")) return "json-summary"
  return "lcov"
}

export async function loadCoverage(
  path: string,
  format?: CoverageFormat
): Promise<CoverageMap> {
  const fmt = format ?? formatFromPath(path)
  const text = await readFile(path, "utf8")
  switch (fmt) {
    case "lcov":
      return parseLcov(text, { sourcePath: path })
    case "json-summary":
      return parseJsonSummary(text, { sourcePath: path })
    case "clover":
      return parseClover(text, { sourcePath: path })
    case "cobertura":
      return parseCobertura(text, { sourcePath: path })
  }
}

export type { CoverageMap, CoverageFormat } from "./types.js"
