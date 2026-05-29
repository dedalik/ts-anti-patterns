// File-watch mode. Re-runs the human-format render whenever any TS/JS
// source under the walk root changes. Debounced 200ms so a save burst
// doesn't trigger N renders.

import chokidar, { type FSWatcher } from "chokidar"

export interface WatchHandle {
  close: () => Promise<void>
}

export interface WatchOptions {
  /** Directory tree to watch. */
  root: string
  /** Globs to ignore (in addition to chokidar's defaults). */
  ignored?: (string | RegExp)[]
  /** Run once on startup. Default true. */
  initial?: boolean
  /** Debounce window in ms. Default 200. */
  debounceMs?: number
  /** Called whenever the debounce window expires after one or more events. */
  onTrigger: () => Promise<void> | void
}

const SOURCE_EXTS = /\.(ts|tsx|js|jsx|mjs|cjs)$/i

export function watch(opts: WatchOptions): WatchHandle {
  const debounceMs = opts.debounceMs ?? 200
  let pending: NodeJS.Timeout | null = null
  let running = false
  let rerunRequested = false

  const trigger = (): void => {
    if (pending) clearTimeout(pending)
    pending = setTimeout(run, debounceMs)
  }

  async function run(): Promise<void> {
    pending = null
    if (running) {
      rerunRequested = true
      return
    }
    running = true
    try {
      await opts.onTrigger()
    } finally {
      running = false
      if (rerunRequested) {
        rerunRequested = false
        trigger()
      }
    }
  }

  const watcher: FSWatcher = chokidar.watch(opts.root, {
    ignored: [
      /(^|[\\/])node_modules([\\/]|$)/,
      /(^|[\\/])\.git([\\/]|$)/,
      /(^|[\\/])dist([\\/]|$)/,
      /(^|[\\/])build([\\/]|$)/,
      /(^|[\\/])coverage([\\/]|$)/,
      /(^|[\\/])\.ts-anti-patterns-cache([\\/]|$)/,
      ...(opts.ignored ?? []),
    ],
    ignoreInitial: opts.initial === false ? true : true,
    awaitWriteFinish: { stabilityThreshold: 80, pollInterval: 30 },
    persistent: true,
  })

  watcher.on("change", (p) => {
    if (SOURCE_EXTS.test(p)) trigger()
  })
  watcher.on("add", (p) => {
    if (SOURCE_EXTS.test(p)) trigger()
  })
  watcher.on("unlink", (p) => {
    if (SOURCE_EXTS.test(p)) trigger()
  })

  // Always run at least once after startup so the user sees output, unless
  // explicitly told not to.
  if (opts.initial !== false) trigger()

  return {
    async close(): Promise<void> {
      if (pending) clearTimeout(pending)
      await watcher.close()
    },
  }
}
