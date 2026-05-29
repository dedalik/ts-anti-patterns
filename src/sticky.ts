// Sticky local baseline.
//
// Every successful run writes the JSON report to .ts-anti-patterns-cache/last.json.
// The next run, if no explicit --baseline is given, reads that file and
// surfaces "Δ since last run" in the human-format header. It never gates
// CI (only --baseline + --fail-regression does that) - it's a developer
// reminder, nothing more.

import { existsSync } from "node:fs"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { loadBaseline, diff, type DeltaSummary } from "./delta.js"
import type { CrapEntry } from "./options.js"

export const STICKY_PATH = ".ts-anti-patterns-cache/last.json"

export async function saveSticky(root: string, jsonReport: string): Promise<void> {
  const abs = resolve(root, STICKY_PATH)
  await mkdir(dirname(abs), { recursive: true })
  await writeFile(abs, jsonReport, "utf8")
}

export async function loadSticky(root: string): Promise<CrapEntry[] | null> {
  const abs = resolve(root, STICKY_PATH)
  if (!existsSync(abs)) return null
  try {
    const text = await readFile(abs, "utf8")
    return loadBaseline(text)
  } catch {
    return null
  }
}

export function stickyDelta(
  current: readonly CrapEntry[],
  previous: readonly CrapEntry[],
  epsilon: number
): DeltaSummary | null {
  if (previous.length === 0) return null
  const { summary } = diff(current, previous, { epsilon })
  // Don't surface trivial deltas - the noise isn't worth a line.
  const interesting =
    summary.regression + summary.improved + summary.new + summary.removed + summary.moved
  if (interesting === 0) return null
  return summary
}
