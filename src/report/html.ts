// Bundle the static HTML template + ESM app.js + CSS + JSON data into a
// single self-contained file. No network requests, no inlined fonts.
//
// Template markers (replaced literally - they live inside HTML comments so
// the source template is still valid HTML and renders harmlessly on its own):
//   <!-- @@STYLES@@ -->   → CSS bundle
//   <!-- @@SCRIPT@@ -->   → app.js source
//   <!-- @@DATA@@ -->     → JSON payload

import { readFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { dirname, resolve as resolvePath } from "node:path"
import { sortEntries } from "./human.js"
import { roundForJson } from "./json.js"
import { GLOSSARY } from "../glossary.js"
import type { CrapEntry, ReportMeta } from "../options.js"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const TEMPLATE_DIR = resolvePath(__dirname, "html-template")

export interface HtmlOptions {
  threshold: number
  top?: number
  min?: number
}

// Cached on first read for speed and so we can flush them in tests.
let templateCache: string | null = null
let appCache: string | null = null
let stylesCache: string | null = null

export async function renderHtml(
  entries: CrapEntry[],
  meta: ReportMeta,
  opts: HtmlOptions
): Promise<string> {
  const [template, app, styles] = await Promise.all([
    readTemplate(),
    readApp(),
    readStyles(),
  ])

  const filtered = filterEntries(entries, opts)
  const data = {
    schemaVersion: "1.0.0",
    meta: { ...meta, threshold: opts.threshold },
    entries: filtered.map(serializeEntry),
    glossary: glossary(),
  }
  const json = JSON.stringify(data)

  // Replace the markers in a fixed order so a literal "@@SCRIPT@@" inside
  // the JSON body can't trip the next replacement.
  return template
    .replace("<!-- @@STYLES@@ -->", () => styles)
    .replace("<!-- @@DATA@@ -->", () => escapeForScriptTag(json))
    .replace("<!-- @@SCRIPT@@ -->", () => app)
}

function filterEntries(entries: CrapEntry[], opts: HtmlOptions): CrapEntry[] {
  const sorted = sortEntries(entries)
  let view = sorted
  if (typeof opts.min === "number") view = view.filter((e) => e.score >= opts.min!)
  if (typeof opts.top === "number") view = view.slice(0, opts.top)
  return view
}

function serializeEntry(e: CrapEntry): Record<string, unknown> {
  return {
    function: e.function,
    file: e.file,
    line: e.line,
    endLine: e.endLine,
    complexity: e.complexity,
    cognitive: e.cognitive,
    sloc: e.sloc,
    coverage: e.coverage == null ? null : roundForJson(e.coverage, 2),
    coverageKind: e.coverageKind,
    confidence: e.confidence,
    score: roundForJson(e.score, 2),
    mode: e.mode,
    severity: e.severity,
    hint: e.hint,
    suppressed: e.suppressed,
    localThreshold: e.localThreshold,
  }
}

async function readTemplate(): Promise<string> {
  if (templateCache !== null) return templateCache
  templateCache = await readFile(resolvePath(TEMPLATE_DIR, "template.html"), "utf8")
  return templateCache
}

async function readApp(): Promise<string> {
  if (appCache !== null) return appCache
  appCache = await readFile(resolvePath(TEMPLATE_DIR, "app.js"), "utf8")
  return appCache
}

async function readStyles(): Promise<string> {
  if (stylesCache !== null) return stylesCache
  stylesCache = await readFile(resolvePath(TEMPLATE_DIR, "styles.css"), "utf8")
  return stylesCache
}

/**
 * Escape a JSON payload so it can safely live inside a
 * `<script type="application/json">` block. The browser stops the tag at
 * `</script>` regardless of context, so we only need to neutralise that.
 */
function escapeForScriptTag(json: string): string {
  return json.replace(/<\/script>/gi, "<\\/script>")
}

function glossary(): Record<string, { title: string; html: string }> {
  const out: Record<string, { title: string; html: string }> = {}
  for (const [key, entry] of Object.entries(GLOSSARY)) {
    out[key] = { title: entry.title, html: entry.html }
  }
  return out
}
