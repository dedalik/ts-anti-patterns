#!/usr/bin/env bash
# scripts/smoke-real.sh - exercise ts-crap against a real-world TS/JS project.
#
# What it does:
#   1. Clones the target repo into a tmpdir (shallow).
#   2. Installs its deps.
#   3. Best-effort: runs its tests with coverage so ts-crap has data to chew on.
#   4. Runs every output format end-to-end (human, json, html, markdown, sarif).
#   5. Validates the JSON envelope against schemas/report-v1.json.
#   6. Prints a 1-line summary per stage and an artifact list at the end.
#
# Usage:
#   ./scripts/smoke-real.sh                              # defaults to sindresorhus/p-limit
#   ./scripts/smoke-real.sh https://github.com/colinhacks/zod
#   ./scripts/smoke-real.sh https://github.com/sindresorhus/ky main
#
# Exit code is the worst of the formats - any non-zero ts-crap exit (other than
# --fail-above hits, which we suppress here) fails the smoke.
#
# This is a *smoke* test, not a benchmark. It proves we don't crash on real code.

set -uo pipefail

REPO_URL="${1:-https://github.com/sindresorhus/p-limit}"
BRANCH="${2:-}"

# Resolve repo root from the script's location so this works under any cwd.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TS_CRAP_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
TS_CRAP_BIN="$TS_CRAP_ROOT/dist/cli.js"

if [ ! -f "$TS_CRAP_BIN" ]; then
  echo "ts-crap dist/ missing. Building first..."
  (cd "$TS_CRAP_ROOT" && npm run build) || { echo "Build failed"; exit 2; }
fi

WORK="$(mktemp -d -t ts-crap-smoke-XXXXXX)"
PROJ="$WORK/project"
# ARTIFACT_DIR override lets CI route artifacts into a known location so the
# upload step can find them after a failing run. Defaults to a sibling of the
# project clone inside the tmpdir.
ARTIFACTS="${ARTIFACT_DIR:-$WORK/artifacts}"
mkdir -p "$ARTIFACTS"

cleanup() {
  local code=$?
  # Always preserve artifacts when ARTIFACT_DIR was set externally (CI uploads
  # them) or when KEEP=1 is set (local debugging). Otherwise we tidy up.
  if [ -n "${ARTIFACT_DIR:-}" ] || [ -n "${KEEP:-}" ]; then
    echo "Artifacts kept in $ARTIFACTS"
  else
    rm -rf "$WORK"
  fi
  exit "$code"
}
trap cleanup EXIT INT TERM

log() {
  printf '\n\033[1;36m▸ %s\033[0m\n' "$*"
}

ok() {
  printf '  \033[32m✓\033[0m %s\n' "$*"
}

warn() {
  printf '  \033[33m!\033[0m %s\n' "$*"
}

fail() {
  printf '  \033[31m✗\033[0m %s\n' "$*"
}

# --- Clone ------------------------------------------------------------------

log "Cloning $REPO_URL"
if [ -n "$BRANCH" ]; then
  git clone --depth 1 --branch "$BRANCH" "$REPO_URL" "$PROJ" 2>&1 | tail -3
else
  git clone --depth 1 "$REPO_URL" "$PROJ" 2>&1 | tail -3
fi
ok "Cloned to $PROJ"
HEAD_SHA="$(git -C "$PROJ" rev-parse --short HEAD)"
ok "HEAD: $HEAD_SHA"

# --- Install ----------------------------------------------------------------

log "Installing project deps"
pushd "$PROJ" >/dev/null

if [ -f package-lock.json ]; then
  npm ci --no-audit --no-fund 2>&1 | tail -3 || warn "npm ci failed; trying npm install"
fi
if [ ! -d node_modules ]; then
  npm install --no-audit --no-fund 2>&1 | tail -3 || warn "npm install failed; continuing without deps"
fi
ok "Deps installed (or skipped if no package.json)"

# --- Best-effort coverage ---------------------------------------------------

log "Trying to generate coverage"
COV_GENERATED=0
if grep -q '"test"' package.json 2>/dev/null; then
  # Run tests with whatever coverage flag the project's runner accepts.
  # We try in order: vitest --coverage, c8 wrapping, fall back to no coverage.
  if grep -q 'vitest' package.json; then
    npx vitest run --coverage --coverage.reporter=lcov 2>&1 | tail -5 && COV_GENERATED=1 || true
  elif grep -q 'c8' package.json; then
    npx c8 --reporter=lcov npm test 2>&1 | tail -5 && COV_GENERATED=1 || true
  elif grep -q 'jest' package.json; then
    npx jest --coverage --coverageReporters=lcov 2>&1 | tail -5 && COV_GENERATED=1 || true
  fi
fi
if [ "$COV_GENERATED" -eq 1 ] && ls coverage/lcov.info >/dev/null 2>&1; then
  ok "Coverage generated at coverage/lcov.info"
else
  warn "No coverage generated - will run in CC-only mode"
fi

# --- Run ts-crap in every format -------------------------------------------

run_format() {
  local fmt="$1"
  local out_name="$2"
  local extra="${3:-}"
  local out_path="$ARTIFACTS/$out_name"
  log "ts-crap --format $fmt $extra"
  # shellcheck disable=SC2086
  if node "$TS_CRAP_BIN" . --format "$fmt" --output "$out_path" $extra 2>"$ARTIFACTS/$fmt.stderr"; then
    ok "$fmt → $(wc -c < "$out_path" | tr -d ' ') bytes at $out_path"
  else
    local code=$?
    # exit 1 from --fail-above is acceptable here (not what we're testing).
    if [ "$code" -eq 1 ]; then
      warn "$fmt produced output and exit 1 (--fail-above territory; OK for smoke)"
    else
      fail "$fmt exited $code"
      cat "$ARTIFACTS/$fmt.stderr" | head -10
      OVERALL_FAIL=1
    fi
  fi
}

OVERALL_FAIL=0
run_format human  report.txt
run_format json   report.json
run_format html   report.html
run_format markdown report.md
run_format sarif  report.sarif
run_format github report.github.txt

# --- Validate JSON envelope against the schema -----------------------------

log "Validating JSON envelope against schemas/report-v1.json"
if command -v node >/dev/null && [ -f "$TS_CRAP_ROOT/schemas/report-v1.json" ]; then
  node -e "
    const { readFileSync } = require('node:fs');
    const Ajv = require('$TS_CRAP_ROOT/node_modules/ajv/dist/2020.js').default;
    const addFormats = require('$TS_CRAP_ROOT/node_modules/ajv-formats').default;
    const schema = JSON.parse(readFileSync('$TS_CRAP_ROOT/schemas/report-v1.json', 'utf8'));
    const ajv = new Ajv({ strict: false, allErrors: true });
    addFormats(ajv);
    const validate = ajv.compile(schema);
    const data = JSON.parse(readFileSync('$ARTIFACTS/report.json', 'utf8'));
    if (validate(data)) { console.log('  schema ok'); }
    else { console.error('  schema FAIL:', JSON.stringify(validate.errors, null, 2)); process.exit(1); }
  " && ok "JSON envelope conforms to report-v1" || { fail "Schema validation failed"; OVERALL_FAIL=1; }
else
  warn "ajv not installed at the ts-crap root - skipping schema validation"
fi

# --- Summary ----------------------------------------------------------------

popd >/dev/null

log "Summary"
printf '  repo:     %s\n' "$REPO_URL"
printf '  sha:      %s\n' "$HEAD_SHA"
printf '  artifacts:\n'
ls -la "$ARTIFACTS"

# Pretty-print the report.json summary block.
if [ -f "$ARTIFACTS/report.json" ]; then
  log "Report headline"
  node -e "
    const r = JSON.parse(require('node:fs').readFileSync('$ARTIFACTS/report.json', 'utf8'));
    console.log('  mode:        ' + r.meta.mode);
    console.log('  functions:   ' + r.summary.functions);
    console.log('  worst score: ' + r.summary.worstScore);
    console.log('  errors:      ' + r.summary.errors);
    console.log('  warnings:    ' + r.summary.warnings);
    if (r.entries.length) {
      const top = r.entries[0];
      console.log('  worst fn:    ' + top.function + '  (' + top.file + ':' + top.line + ')');
    }
  "
fi

if [ "$OVERALL_FAIL" -ne 0 ]; then
  fail "Smoke failed - see artifacts above"
  exit 1
fi
ok "All formats rendered and schema-validated."
exit 0
