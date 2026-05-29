// `ts-anti-patterns init` - drops a sensible .ts-anti-patterns.json next to package.json,
// registers an npm script, and prints a 3-line quick-start so the user
// knows what to do next.
//
// Idempotent: if .ts-anti-patterns.json or the npm script already exists they're
// left alone and the user is told.

import { existsSync } from "node:fs"
import { readFile, writeFile } from "node:fs/promises"
import { resolve, relative } from "node:path"

export interface InitResult {
  configCreated: boolean
  scriptAdded: boolean
  configPath: string
  notes: string[]
}

const DEFAULT_CONFIG = {
  threshold: 30,
  failAbove: false,
  missing: "pessimistic",
  skipAnonymous: false,
  exclude: [] as string[],
  allow: [] as string[],
}

export async function runInit(cwd: string): Promise<InitResult> {
  const notes: string[] = []
  const configPath = resolve(cwd, ".ts-anti-patterns.json")
  let configCreated = false
  if (existsSync(configPath)) {
    notes.push(`Skipped: ${relative(cwd, configPath)} already exists.`)
  } else {
    await writeFile(configPath, JSON.stringify(DEFAULT_CONFIG, null, 2) + "\n", "utf8")
    configCreated = true
    notes.push(`Created ${relative(cwd, configPath)} with default settings.`)
  }

  const pkgPath = resolve(cwd, "package.json")
  let scriptAdded = false
  if (existsSync(pkgPath)) {
    const raw = await readFile(pkgPath, "utf8")
    const indent = detectIndent(raw)
    const trailingNewline = raw.endsWith("\n")
    let json: { scripts?: Record<string, string> } & Record<string, unknown>
    try {
      json = JSON.parse(raw) as typeof json
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      notes.push(`Skipped npm script - package.json is invalid JSON (${message}).`)
      return { configCreated, scriptAdded, configPath, notes }
    }
    json.scripts ??= {}
    if (json.scripts.crap) {
      notes.push(`Skipped: npm script 'crap' already exists.`)
    } else {
      json.scripts.crap = "ts-anti-patterns"
      const serialized =
        JSON.stringify(json, null, indent) + (trailingNewline ? "\n" : "")
      await writeFile(pkgPath, serialized, "utf8")
      scriptAdded = true
      notes.push(`Added 'crap' script to package.json.`)
    }
  } else {
    notes.push("No package.json found - skipped npm script setup.")
  }

  return { configCreated, scriptAdded, configPath, notes }
}

export function quickStart(result: InitResult): string {
  return [
    "",
    ...result.notes.map((n) => "  " + n),
    "",
    "Quick start:",
    "  npm run crap                 # complexity-only scan of ./src",
    "  npm run crap -- --threshold 50 --fail-above",
    "  npm run crap -- --format html --output crap.html",
    "",
  ].join("\n")
}

function detectIndent(json: string): string | number {
  const match = json.match(/^(\s+)"/m)
  if (!match) return 2
  const ws = match[1] ?? ""
  if (ws.includes("\t")) return "\t"
  return ws.length || 2
}
