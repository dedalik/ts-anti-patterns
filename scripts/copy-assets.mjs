#!/usr/bin/env node
// Copy static non-TS assets into dist/ so they ship with the package.
// At the moment this is only the HTML report template; the CLI reads them
// at runtime via paths relative to its own location in dist/report/.

import { cp, mkdir } from "node:fs/promises"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"

const here = fileURLToPath(new URL(".", import.meta.url))
const repo = resolve(here, "..")

const SOURCES = [
  ["src/report/html-template", "dist/report/html-template"],
  ["src/skill", "dist/skill"],
]

for (const [from, to] of SOURCES) {
  const src = resolve(repo, from)
  const dst = resolve(repo, to)
  await mkdir(dst, { recursive: true })
  await cp(src, dst, { recursive: true, force: true })
  process.stdout.write(`copied ${from} → ${to}\n`)
}
