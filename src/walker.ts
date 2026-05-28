// File discovery: turn user-provided paths into an absolute list of source
// files, respecting .gitignore and a sane set of default excludes.

import { existsSync, statSync } from "node:fs"
import { resolve, relative, dirname } from "node:path"
import { globby } from "globby"
import type { ResolvedOptions } from "./options.js"
import { canonicalize, toPosix } from "./util/paths.js"

const SOURCE_GLOBS = ["**/*.ts", "**/*.tsx", "**/*.js", "**/*.jsx", "**/*.mjs", "**/*.cjs"]

const DEFAULT_EXCLUDES = [
  "**/node_modules/**",
  "**/dist/**",
  "**/build/**",
  "**/out/**",
  "**/coverage/**",
  "**/.next/**",
  "**/.nuxt/**",
  "**/.cache/**",
  "**/.turbo/**",
  "**/.worktrees/**",
  "**/__mocks__/**",
  "**/__snapshots__/**",
  "**/*.d.ts",
  "**/*.test.ts",
  "**/*.spec.ts",
  "**/*.test.tsx",
  "**/*.spec.tsx",
  "**/*.test.js",
  "**/*.spec.js",
  "**/*.generated.*",
  "**/__generated__/**",
]

export interface WalkResult {
  root: string
  files: string[]
}

/**
 * Resolve the working root for a list of user paths.
 *
 * Rules:
 *   1. No paths provided -> auto-detect: `./src` if it exists, else cwd.
 *   2. One path, a directory -> use that directory as the root.
 *   3. One path, a single file -> use its parent directory.
 *   4. Multiple paths -> common ancestor (or cwd if they don't share one).
 */
export function resolveRoot(paths: readonly string[]): string {
  if (paths.length === 0) {
    const srcDir = resolve(process.cwd(), "src")
    return existsSync(srcDir) && statSync(srcDir).isDirectory()
      ? srcDir
      : process.cwd()
  }
  if (paths.length === 1) {
    const abs = canonicalize(paths[0] ?? ".")
    if (existsSync(abs) && statSync(abs).isDirectory()) return abs
    return dirname(abs)
  }
  return commonAncestor(paths.map(canonicalize)) ?? process.cwd()
}

function commonAncestor(absPaths: readonly string[]): string | null {
  if (absPaths.length === 0) return null
  const parts = absPaths.map((p) => toPosix(p).split("/"))
  const shortest = parts.reduce(
    (acc, cur) => (cur.length < acc.length ? cur : acc),
    parts[0] ?? []
  )
  const out: string[] = []
  for (let i = 0; i < shortest.length; i++) {
    const seg = shortest[i]
    if (parts.every((p) => p[i] === seg)) out.push(seg ?? "")
    else break
  }
  if (out.length === 0) return null
  const joined = out.join("/")
  return joined.startsWith("/") ? joined : `/${joined}`
}

/**
 * Collect source files from the user's paths. Each input may be a directory
 * (recursive walk) or a single file (used directly, ignoring excludes for
 * explicit inputs - power-user override).
 */
export async function collect(opts: ResolvedOptions): Promise<WalkResult> {
  const baseInputs = opts.paths.length > 0 ? opts.paths : [resolveRoot([])]
  const inputs = opts.workspace
    ? await expandWorkspaces(resolveRoot(opts.paths))
    : baseInputs
  const root = opts.workspace ? resolveRoot(opts.paths) : resolveRoot(opts.paths)

  const explicitFiles: string[] = []
  const scanDirs: string[] = []

  for (const raw of inputs) {
    const abs = canonicalize(raw)
    if (!existsSync(abs)) {
      throw new Error(`Path not found: ${raw}`)
    }
    if (statSync(abs).isFile()) {
      explicitFiles.push(abs)
    } else {
      scanDirs.push(abs)
    }
  }

  const ignore = [...DEFAULT_EXCLUDES, ...opts.exclude]

  const globbed: string[] = []
  for (const dir of scanDirs) {
    const found = await globby(SOURCE_GLOBS, {
      cwd: dir,
      absolute: true,
      gitignore: true,
      ignore,
      dot: false,
      followSymbolicLinks: false,
    })
    globbed.push(...found)
  }

  const seen = new Set<string>()
  const files: string[] = []
  for (const f of [...explicitFiles, ...globbed]) {
    const norm = canonicalize(f)
    if (seen.has(norm)) continue
    seen.add(norm)
    files.push(norm)
  }

  return { root, files }
}

/**
 * Read `package.json#workspaces` at `root` and return one absolute path per
 * matching directory. If no workspaces entry is found, returns [root] so the
 * caller can keep its single-package behaviour.
 *
 * Supports both the array shape (`["packages/*"]`) and the object shape
 * (`{ packages: [...] }`).
 */
export async function expandWorkspaces(root: string): Promise<string[]> {
  const pkgPath = resolve(root, "package.json")
  if (!existsSync(pkgPath)) return [root]
  const { readFile } = await import("node:fs/promises")
  let workspaces: unknown
  try {
    const json = JSON.parse(await readFile(pkgPath, "utf8")) as { workspaces?: unknown }
    workspaces = json.workspaces
  } catch {
    return [root]
  }
  const patterns = collectPatterns(workspaces)
  if (patterns.length === 0) return [root]
  const matches = await globby(patterns, {
    cwd: root,
    onlyDirectories: true,
    absolute: true,
    expandDirectories: false,
  })
  return matches.length > 0 ? matches : [root]
}

function collectPatterns(workspaces: unknown): string[] {
  if (Array.isArray(workspaces)) {
    return workspaces.filter((v): v is string => typeof v === "string")
  }
  if (workspaces && typeof workspaces === "object" && "packages" in workspaces) {
    const arr = (workspaces as { packages?: unknown }).packages
    if (Array.isArray(arr)) return arr.filter((v): v is string => typeof v === "string")
  }
  return []
}

/** Display a single file path relative to the walk root. */
export function relPath(file: string, root: string): string {
  const r = relative(root, file)
  return toPosix(r || file)
}
