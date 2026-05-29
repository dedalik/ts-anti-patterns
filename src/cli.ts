#!/usr/bin/env node
// ts-anti-patterns - CLI entry point.
//
// Phase 2+: defaults to CC-only. Coverage is enabled explicitly via
// --cov (auto-detect) or --lcov/--coverage (explicit path).
// Source-map translation for transpiled coverage available via --source-map.

import { readFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import { spawn } from "node:child_process"
import { createRequire } from "node:module"
import { resolve as resolvePath } from "node:path"
import { cac } from "cac"
import pLimit from "p-limit"
import { loadConfig, mergeOptions } from "./config.js"
import { analyzeFile } from "./complexity.js"
import {
  loadCoverage,
  sniffCoverage,
  type CoverageMap,
} from "./coverage/index.js"
import { merge } from "./merge.js"
import {
  DEFAULT_OPTIONS,
  isSeverityAtLeast,
  type CrapEntry,
  type Format,
  type FunctionMetric,
  type ReportMeta,
  type ResolvedOptions,
  type Severity,
} from "./options.js"
import { parsePragmas } from "./pragmas.js"
import { openCache, noopCache } from "./cache.js"
import { diff, loadBaseline, type DeltaSummary, type DeltaRow } from "./delta.js"
import { diagnose } from "./diagnose.js"
import { explain, listTerms } from "./glossary.js"
import { runInit, quickStart } from "./init.js"
import { loadSticky, saveSticky, stickyDelta } from "./sticky.js"
import { installSkill, resolveSkillPath, showSkill, uninstallSkill } from "./skill-cmd.js"
import { watch } from "./watch.js"
import { renderGithub } from "./report/github.js"
import { renderHtml } from "./report/html.js"
import { renderHuman } from "./report/human.js"
import { renderJson } from "./report/json.js"
import { renderMarkdown } from "./report/markdown.js"
import { renderPrComment } from "./report/pr-comment.js"
import { renderSarif } from "./report/sarif.js"
import { translateCoverage } from "./source-map.js"
import { collect, relPath } from "./walker.js"
import { displayPath } from "./util/paths.js"

const require = createRequire(import.meta.url)
const pkg = require("../package.json") as { version: string }

// cac translates --kebab-case → camelCase and maps --no-foo → foo: false.
// We collect both shapes here so the action handler stays straightforward.
interface CliFlags {
  threshold?: number
  failAbove?: boolean
  failAboveSeverity?: string
  top?: number
  min?: number
  format?: string
  output?: string
  exclude?: string[]
  allow?: string[]
  cov?: boolean // --no-cov => false
  skipAnonymous?: boolean
  countNullishCoalescing?: boolean
  cognitive?: boolean // --no-cognitive => false
  hints?: boolean // --no-hints => false
  config?: string
  lcov?: string
  coverage?: string
  sourceMap?: string
  missing?: string
  baseline?: string
  failRegression?: boolean
  epsilon?: number
  summary?: boolean
  diagnose?: string
  workspace?: boolean
  jobs?: number
  watch?: boolean
  cache?: boolean
  full?: boolean
  runCoverage?: boolean
  coverageCommand?: string
}

const cli = cac("ts-anti-patterns")

cli
  .command("[...paths]", "Analyze TypeScript/JavaScript files for complexity & coverage risk")
  .option("--threshold <n>", "Score threshold (default 30)", { default: DEFAULT_OPTIONS.threshold })
  .option(
    "--fail-above",
    "Exit non-zero if any function exceeds the severity threshold (default warning)"
  )
  .option(
    "--fail-above-severity <level>",
    "Minimum severity that triggers --fail-above (info|warning|error)",
    { default: DEFAULT_OPTIONS.failAboveSeverity }
  )
  .option("--top <n>", "Show only top N worst functions")
  .option("--min <n>", "Hide functions below this score")
  .option(
    "--format <fmt>",
    "Output format: human|json|html|markdown|github|sarif|pr-comment",
    { default: DEFAULT_OPTIONS.format }
  )
  .option("--output <path>", "Write report to file instead of stdout")
  .option("--exclude <glob>", "Exclude glob (repeatable)", { type: [] })
  .option("--allow <glob>", "Allow-list glob (repeatable, restricts to matches)", { type: [] })
  .option("--lcov <path>", "Explicit LCOV file")
  .option("--coverage <path>", "Explicit coverage file (lcov/json-summary/clover/cobertura by extension)")
  .option("--cov", "Enable coverage auto-detection from conventional coverage/* files")
  .option("--full", "One-command mode: run coverage generation, then analyze in CRAP mode")
  .option("--run-coverage", "Attempt to generate coverage before analysis")
  .option("--coverage-command <cmd>", "Custom command used by --run-coverage/--full")
  .option(
    "--source-map <mode>",
    "Translate coverage through source maps: 'auto' or path to a .map file"
  )
  .option(
    "--missing <policy>",
    "Missing-coverage policy: pessimistic|optimistic|skip",
    { default: DEFAULT_OPTIONS.missing }
  )
  .option("--no-cov", "Force CC-only mode even when --cov/--coverage is set")
  .option("--skip-anonymous", "Hide anonymous arrow/fn rows from the report")
  .option(
    "--count-nullish-coalescing",
    "Count '??' as a branch in CC and Cognitive (off by default)"
  )
  .option("--no-cognitive", "Skip cognitive complexity computation")
  .option("--no-hints", "Suppress per-function actionable hints")
  .option("--config <path>", "Path to config file (overrides discovery)")
  .option("--baseline <path>", "Compare against a previously saved JSON report")
  .option("--fail-regression", "Exit non-zero when any regression vs baseline is detected")
  .option("--epsilon <n>", "Score delta treated as unchanged for --baseline", {
    default: DEFAULT_OPTIONS.epsilon,
  })
  .option("--summary", "Print only the aggregate summary line")
  .option("--diagnose <path>", "Debug a single file: show every discovered function and why it was kept/filtered")
  .option("--workspace", "Scan each package listed in package.json#workspaces")
  .option("--jobs <n>", "Parallel file-analysis concurrency (default os.cpus().length)")
  .option("--watch", "Re-render in human format whenever a source file changes (debounced 200ms)")
  .option("--no-cache", "Disable the .ts-anti-patterns-cache/ AST cache")
  .action(async (paths: string[], flags: CliFlags) => {
    try {
      await run(paths, flags)
    } catch (err) {
      const e = err as Error
      if (process.env.TS_CRAP_DEBUG) {
        process.stderr.write(`ts-anti-patterns: ${e.stack ?? e.message}\n`)
      } else {
        process.stderr.write(`ts-anti-patterns: ${e.message}\n`)
      }
      process.exitCode = 2
    }
  })

cli
  .command("skill <action>", "Install or manage the bundled Cursor/agent skill (install|uninstall|show|path)")
  .option("--project", "Install under ./.agents/skills instead of ~/.agents/skills")
  .action(async (action: string, flags: { project?: boolean }) => {
    const scope = flags.project ? "project" : "global"
    if (action === "install") {
      const dest = await installSkill(scope)
      process.stdout.write(`Installed ts-anti-patterns skill to ${dest}\n`)
      return
    }
    if (action === "uninstall") {
      const removed = await uninstallSkill(scope)
      if (removed) {
        process.stdout.write(`Removed ts-anti-patterns skill from ${resolveSkillPath(scope)}\n`)
      } else {
        process.stdout.write(`No ts-anti-patterns skill installed at ${resolveSkillPath(scope)}\n`)
      }
      return
    }
    if (action === "show") {
      process.stdout.write(await showSkill())
      return
    }
    if (action === "path") {
      process.stdout.write(`${resolveSkillPath(scope)}\n`)
      return
    }
    process.stderr.write(
      "Unknown skill action. Use one of: install, uninstall, show, path.\n"
    )
    process.exitCode = 2
  })

cli
  .command("init", "Create .ts-anti-patterns.json with sensible defaults and add an 'crap' npm script")
  .action(async () => {
    const result = await runInit(process.cwd())
    process.stdout.write(quickStart(result))
  })

cli
  .command("explain [term]", "Explain a ts-anti-patterns term (crap, cc, cognitive, coverage, ...)")
  .action((term: string | undefined) => {
    if (!term) {
      process.stdout.write("Available terms:\n")
      for (const t of listTerms()) process.stdout.write(`  ${t}\n`)
      return
    }
    const text = explain(term)
    if (text) {
      process.stdout.write(text)
    } else {
      process.stderr.write(`No glossary entry for '${term}'. Try one of: ${listTerms().join(", ")}.\n`)
      process.exitCode = 1
    }
  })

cli.help()
cli.version(pkg.version)
cli.parse()

async function run(paths: string[], flags: CliFlags): Promise<void> {
  const discovery = await loadConfig(flags.config ? resolvePath(flags.config) : undefined)
  warnOnUnknownConfig(discovery.unknownKeys)

  const opts = resolveOptions(paths, flags, discovery.config)
  const { root } = await collect(opts)
  const display = (abs: string) => relPath(abs, root)

  await maybeGenerateCoverage(opts, root, flags)
  const coverage = await maybeLoadCoverage(opts, root, flags)

  // --diagnose short-circuits the normal pipeline: focused output for one file.
  if (flags.diagnose) {
    const out = await diagnose(resolvePath(flags.diagnose), {
      options: opts,
      coverage,
      displayPath: display,
      configPath: discovery.configPath,
      configSha: discovery.configSha,
    })
    await emit(out, opts.output)
    return
  }

  const baseline = await maybeLoadBaseline(opts)

  const once = async (): Promise<void> => {
    const { files } = await collect(opts)
    const metrics = await analyzeMetrics(files, opts, root)
    const entries = merge({
      metrics,
      coverage,
      options: opts,
      displayPath: display,
    })

    const delta = baseline
      ? diff(entries, baseline, { epsilon: opts.epsilon })
      : undefined

    let stickySummary: ReturnType<typeof stickyDelta> = null
    if (!baseline) {
      const previous = await loadSticky(root)
      if (previous) stickySummary = stickyDelta(entries, previous, opts.epsilon)
    }

    const meta = buildMeta(opts, discovery, coverage, entries)
    if (stickySummary) meta.stickyDelta = stickySummary

    const out = await render(entries, meta, opts, delta)
    await emit(out, opts.output)

    // Save sticky baseline as JSON regardless of the chosen format.
    if (!baseline) {
      const json = renderJson(entries, meta, { threshold: opts.threshold })
      await saveSticky(root, json).catch(() => undefined)
    }

    if (opts.failAbove) applyExitCode(entries, opts.failAboveSeverity)
    if (opts.failRegression && delta && delta.summary.regression > 0) {
      process.exitCode = 1
    }
  }

  if (flags.watch) {
    if (opts.format !== "human") {
      process.stderr.write(
        "ts-anti-patterns: --watch only renders the human format; other formats are ignored.\n"
      )
    }
    const handle = watch({
      root,
      initial: true,
      debounceMs: 200,
      onTrigger: async () => {
        process.stdout.write("\x1b[2J\x1b[H") // clear screen
        try {
          await once()
        } catch (err) {
          const e = err as Error
          process.stderr.write(`ts-anti-patterns: ${e.message}\n`)
        }
      },
    })

    const shutdown = async (): Promise<void> => {
      await handle.close()
      process.exit(0)
    }
    process.once("SIGINT", () => void shutdown())
    process.once("SIGTERM", () => void shutdown())
    // Block forever - chokidar keeps the event loop alive.
    return new Promise<void>(() => undefined)
  }

  await once()
}

async function maybeLoadBaseline(opts: ResolvedOptions): Promise<CrapEntry[] | null> {
  if (!opts.baseline) return null
  const abs = resolvePath(opts.baseline)
  if (!existsSync(abs)) {
    throw new Error(`baseline not found: ${opts.baseline}`)
  }
  const text = await readFile(abs, "utf8")
  return loadBaseline(text)
}

function resolveOptions(
  paths: string[],
  flags: CliFlags,
  fromConfig: Partial<ResolvedOptions>
): ResolvedOptions {
  const noCov = resolveNoCov(flags)
  const cliOverrides: Partial<ResolvedOptions> = {
    paths: paths.length > 0 ? paths : undefined,
    threshold: numFlag(flags.threshold),
    failAbove: flags.failAbove === true ? true : undefined,
    failAboveSeverity: severityFlag(flags.failAboveSeverity),
    top: numFlag(flags.top),
    min: numFlag(flags.min),
    format: formatFlag(flags.format),
    output: flags.output,
    exclude: stringArray(flags.exclude),
    allow: stringArray(flags.allow),
    lcov: flags.lcov,
    coverage: flags.coverage,
    sourceMap: flags.sourceMap,
    missing: missingFlag(flags.missing),
    noCov,
    skipAnonymous: flags.skipAnonymous === true ? true : undefined,
    countNullishCoalescing: flags.countNullishCoalescing === true ? true : undefined,
    cognitive: flags.cognitive === false ? false : undefined,
    hints: flags.hints === false ? false : undefined,
    baseline: flags.baseline,
    failRegression: flags.failRegression === true ? true : undefined,
    epsilon: numFlag(flags.epsilon),
    summary: flags.summary === true ? true : undefined,
    workspace: flags.workspace === true ? true : undefined,
    jobs: numFlag(flags.jobs),
    cache: flags.cache === false ? false : undefined,
  }
  for (const k of Object.keys(cliOverrides) as (keyof typeof cliOverrides)[]) {
    if (cliOverrides[k] === undefined) delete cliOverrides[k]
  }
  const opts = mergeOptions(cliOverrides, fromConfig)
  opts.paths = paths
  return opts
}

function warnOnUnknownConfig(keys: readonly string[]): void {
  if (keys.length > 0) {
    process.stderr.write(`ts-anti-patterns: ignoring unknown config keys: ${keys.join(", ")}\n`)
  }
}

async function analyzeMetrics(
  files: readonly string[],
  opts: ResolvedOptions,
  root: string
): Promise<FunctionMetric[]> {
  const complexityOpts = {
    cognitive: opts.cognitive,
    countNullishCoalescing: opts.countNullishCoalescing,
  }
  const cache = opts.cache ? await openCache(root, complexityOpts) : noopCache()
  const concurrency = Math.max(1, Math.floor(opts.jobs) || 1)
  const limit = pLimit(concurrency)

  // Index buckets keep the result order deterministic regardless of how the
  // tasks finish. Cached entries land in the same lane as freshly computed
  // ones, so downstream sorting stays stable.
  const buckets: FunctionMetric[][] = new Array<FunctionMetric[]>(files.length)
  await Promise.all(
    files.map((file, i) =>
      limit(async () => {
        const cached = cache.get(file)
        if (cached) {
          buckets[i] = cached
          return
        }
        const source = await readFileSafe(file)
        if (source === undefined) {
          buckets[i] = []
          return
        }
        const metrics = analyzeFile(source, file, complexityOpts)
        const pragmas = parsePragmas(source)
        const decorated = metrics.map((m) => {
          const pragma = pragmas.get(m.line)
          return {
            ...m,
            suppressed: pragma?.suppressed,
            localThreshold: pragma?.localThreshold,
          }
        })
        cache.set(file, decorated)
        buckets[i] = decorated
      })
    )
  )
  if (opts.cache) await cache.save()
  const out: FunctionMetric[] = []
  for (const b of buckets) if (b) out.push(...b)
  return out
}

async function readFileSafe(file: string): Promise<string | undefined> {
  try {
    return await readFile(file, "utf8")
  } catch {
    return undefined
  }
}

async function maybeLoadCoverage(
  opts: ResolvedOptions,
  root: string,
  flags: CliFlags
): Promise<CoverageMap | null> {
  if (opts.noCov) return null

  // 1. Explicit --lcov or --coverage: error if missing (user asked for it).
  const explicit = flags.lcov ?? flags.coverage ?? opts.lcov ?? opts.coverage
  if (explicit) {
    const abs = resolvePath(explicit)
    if (!existsSync(abs)) {
      throw new Error(
        `coverage file not found: ${explicit}. Did the test run produce it? Use --no-cov to fall back to CC-only.`
      )
    }
    const cov = await loadCoverage(abs)
    return maybeApplySourceMap(cov, opts.sourceMap)
  }

  // 2. Auto-sniff. Try the walker root first (covers monorepo packages and
  // explicit subdir scans), then fall back to process.cwd() so the
  // conventional <project>/coverage/ layout is found when the user scans
  // a subdirectory.
  const sniffed = sniffCoverage(root) ?? sniffCoverage(process.cwd())
  if (!sniffed) return null
  try {
    const cov = await loadCoverage(sniffed.path, sniffed.format)
    return maybeApplySourceMap(cov, opts.sourceMap)
  } catch {
    return null
  }
}

function resolveNoCov(flags: CliFlags): boolean | undefined {
  const argv = process.argv.slice(2)
  // Explicit --no-cov always wins.
  if (argv.includes("--no-cov")) return true
  if (flags.full === true) return false
  // Explicit --cov always enables coverage sniffing.
  if (argv.includes("--cov")) return false
  if (flags.runCoverage === true) return false
  // Explicit coverage paths imply coverage mode even when default is CC-only.
  if (flags.lcov || flags.coverage) return false
  return undefined
}

async function maybeGenerateCoverage(
  opts: ResolvedOptions,
  root: string,
  flags: CliFlags
): Promise<void> {
  if (opts.noCov) return

  const explicit = flags.lcov ?? flags.coverage ?? opts.lcov ?? opts.coverage
  if (explicit) return

  const already = sniffCoverage(root) ?? sniffCoverage(process.cwd())
  if (already) return

  if (!shouldRunCoverage(flags)) return

  const command = await resolveCoverageCommand(flags.coverageCommand)
  if (!command) {
    throw new Error(
      "unable to auto-resolve coverage command. Use --coverage-command '<cmd>' or generate coverage manually."
    )
  }

  process.stderr.write(`ts-anti-patterns: generating coverage via '${command}'\n`)
  await runShell(command, process.cwd())

  const after = sniffCoverage(root) ?? sniffCoverage(process.cwd())
  if (!after) {
    throw new Error(
      "coverage generation finished but no coverage file was found. Use --coverage-command to point to your exact test command."
    )
  }
}

function shouldRunCoverage(flags: CliFlags): boolean {
  return flags.full === true || flags.runCoverage === true
}

async function resolveCoverageCommand(custom?: string): Promise<string | null> {
  if (custom && custom.trim().length > 0) return custom

  type PkgJson = {
    scripts?: Record<string, string>
    dependencies?: Record<string, string>
    devDependencies?: Record<string, string>
  }
  let pkg: PkgJson | null = null
  try {
    const text = await readFile(resolvePath(process.cwd(), "package.json"), "utf8")
    pkg = JSON.parse(text) as PkgJson
  } catch {
    return null
  }

  const scripts = pkg.scripts ?? {}
  const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) }

  if (scripts["test:coverage"]) return "npm run test:coverage"
  if (deps.vitest) return "npx vitest run --coverage --coverage.reporter=lcov"
  if (deps.jest) return "npx jest --coverage --coverageReporters=lcov"
  if (scripts.test) return "npm test -- --coverage"
  return null
}

async function runShell(command: string, cwd: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, {
      cwd,
      env: process.env,
      shell: true,
      stdio: "inherit",
    })
    child.on("error", reject)
    child.on("exit", (code, signal) => {
      if (code === 0) {
        resolve()
        return
      }
      reject(new Error(`coverage command failed (code=${code ?? "null"}, signal=${signal ?? "none"})`))
    })
  })
}

async function maybeApplySourceMap(
  cov: CoverageMap,
  mode: string | "auto" | undefined
): Promise<CoverageMap> {
  if (!mode) return cov
  if (mode === "auto" || mode === "true" || mode === "1") {
    return await translateCoverage(cov)
  }
  // Otherwise the user gave us a specific directory hint.
  return await translateCoverage(cov, { baseDir: resolvePath(mode) })
}

function buildMeta(
  opts: ResolvedOptions,
  discovery: Awaited<ReturnType<typeof loadConfig>>,
  coverage: CoverageMap | null,
  entries: readonly CrapEntry[]
): ReportMeta {
  return {
    version: pkg.version,
    generatedAt: new Date().toISOString(),
    node: process.version,
    cwd: process.cwd(),
    command: ["ts-anti-patterns", ...process.argv.slice(2)].join(" "),
    mode: entries.some((e) => e.mode === "crap") ? "crap" : "cc",
    coverageSource: coverage
      ? {
          path: displayPath(coverage.source.path, opts.output ? process.cwd() : process.cwd()),
          kind: coverage.source.hasBranch
            ? "branch"
            : coverage.source.hasFn
              ? "fn"
              : coverage.source.hasLine
                ? "line"
                : null,
          hint: describeCoverageSource(coverage),
        }
      : undefined,
    configPath: discovery.configPath
      ? displayPath(discovery.configPath, process.cwd())
      : undefined,
    configSha: discovery.configSha,
  }
}

function describeCoverageSource(cov: CoverageMap): string {
  const parts: string[] = [cov.source.format]
  const kinds: string[] = []
  if (cov.source.hasBranch) kinds.push("branch")
  if (cov.source.hasFn) kinds.push("fn")
  if (cov.source.hasLine) kinds.push("line")
  if (kinds.length > 0) parts.push(`(${kinds.join("+")})`)
  return parts.join(" ")
}

async function emit(out: string, outputPath: string | undefined): Promise<void> {
  if (outputPath) {
    const { writeFile } = await import("node:fs/promises")
    await writeFile(outputPath, out, "utf8")
  } else {
    process.stdout.write(out)
  }
}

function applyExitCode(entries: readonly CrapEntry[], minSeverity: Severity): void {
  const triggers = entries.filter(
    (e) => !e.suppressed && isSeverityAtLeast(e.severity, minSeverity)
  )
  if (triggers.length > 0) process.exitCode = 1
}

async function render(
  entries: CrapEntry[],
  meta: ReportMeta,
  opts: ResolvedOptions,
  delta?: { rows: DeltaRow[]; summary: DeltaSummary }
): Promise<string> {
  if (opts.format === "json") {
    return renderJson(entries, meta, { threshold: opts.threshold })
  }
  if (opts.format === "html") {
    return renderHtml(entries, meta, {
      threshold: opts.threshold,
      top: opts.top,
      min: opts.min,
    })
  }
  if (opts.format === "markdown") {
    return renderMarkdown(entries, meta, {
      threshold: opts.threshold,
      top: opts.top,
      min: opts.min,
    })
  }
  if (opts.format === "github") {
    return renderGithub(entries, meta, {
      threshold: opts.threshold,
      top: opts.top,
      min: opts.min,
    })
  }
  if (opts.format === "sarif") {
    return renderSarif(entries, meta, {
      threshold: opts.threshold,
      top: opts.top,
      min: opts.min,
    })
  }
  if (opts.format === "pr-comment") {
    return renderPrComment(entries, meta, {
      threshold: opts.threshold,
      top: opts.top ?? 10,
      delta,
    })
  }
  if (opts.format === "human") {
    return renderHuman(entries, meta, {
      threshold: opts.threshold,
      top: opts.top,
      min: opts.min,
      showHints: opts.hints,
      colors: !opts.output && process.stdout.isTTY === true,
      summary: opts.summary,
    })
  }
  throw new Error(`Output format '${opts.format}' is not supported.`)
}

function numFlag(v: unknown): number | undefined {
  if (v === undefined || v === null || v === "") return undefined
  const n = typeof v === "number" ? v : Number(v)
  return Number.isFinite(n) ? n : undefined
}

function severityFlag(v: string | undefined): Severity | undefined {
  if (!v) return undefined
  if (v === "ok" || v === "info" || v === "warning" || v === "error") return v
  throw new Error(`--fail-above-severity must be one of: info, warning, error (got ${v})`)
}

function missingFlag(v: string | undefined): "pessimistic" | "optimistic" | "skip" | undefined {
  if (!v) return undefined
  if (v === "pessimistic" || v === "optimistic" || v === "skip") return v
  throw new Error(`--missing must be one of: pessimistic, optimistic, skip (got ${v})`)
}

// cac sets array-typed options to [null] when no value is provided. Coerce
// to a clean string[] (or undefined to defer to config/defaults).
function stringArray(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined
  const strings = v.filter((x): x is string => typeof x === "string" && x.length > 0)
  return strings.length > 0 ? strings : undefined
}

function formatFlag(v: string | undefined): Format | undefined {
  if (!v) return undefined
  const valid = ["human", "json", "html", "markdown", "github", "sarif", "pr-comment"]
  if (valid.includes(v)) return v as Format
  throw new Error(`--format must be one of: ${valid.join(", ")} (got ${v})`)
}
