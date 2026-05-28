// Path utilities. Phase 1 only needs canonical() and relativize() for
// stable display. The full two-level index + suffix matching lives here
// for Phase 2 (merge.ts).

import { resolve, relative, sep, isAbsolute } from "node:path"

const POSIX_SEP = "/"

/**
 * Resolve to an absolute, OS-canonical path. Does not touch the filesystem;
 * symlink resolution happens elsewhere (Phase 2). Safe to call on inputs
 * that may or may not exist.
 */
export function canonicalize(p: string): string {
  return resolve(p)
}

/**
 * Display a file path relative to a root, always using POSIX separators so
 * reports are diffable across Linux/macOS/Windows.
 */
export function displayPath(absFile: string, root: string): string {
  const rel = relative(root, absFile)
  return toPosix(rel || absFile)
}

export function toPosix(p: string): string {
  return sep === POSIX_SEP ? p : p.split(sep).join(POSIX_SEP)
}

/**
 * Suffix-match path B against A by path components, not bytes. Used in
 * Phase 2 to match LCOV-relative paths against absolute filesystem paths.
 *
 * Example: suffixMatch("src/foo.ts", "/proj/src/foo.ts") -> true,
 *          suffixMatch("oo/bar.rs", "/x/foo/bar.rs") -> false.
 */
export function suffixMatch(needle: string, haystack: string): boolean {
  const a = toPosix(needle).split(POSIX_SEP).filter(Boolean)
  const b = toPosix(haystack).split(POSIX_SEP).filter(Boolean)
  if (a.length === 0 || a.length > b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[a.length - 1 - i] !== b[b.length - 1 - i]) return false
  }
  return true
}

export function ensureAbsolute(p: string, base?: string): string {
  if (isAbsolute(p)) return p
  return canonicalize(base ? resolve(base, p) : p)
}

/**
 * Split a path into POSIX-style components, dropping empty segments and
 * any leading slash. Used by the merge step to build a suffix-match index
 * over coverage paths without ever resolving them against CWD.
 */
export function componentsOf(p: string): string[] {
  return toPosix(p).split(POSIX_SEP).filter(Boolean)
}

/**
 * Lowercase a path on case-insensitive filesystems (macOS HFS+, Windows).
 * Linux paths are case-sensitive - leave them alone.
 */
export function caseFold(p: string): string {
  if (process.platform === "darwin" || process.platform === "win32") {
    return p.toLowerCase()
  }
  return p
}
