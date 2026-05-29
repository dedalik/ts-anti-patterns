---
name: ts-anti-patterns
description: Use when the user asks for CRAP/complexity analysis, risk scoring, or top risky TypeScript/JavaScript functions.
---

# ts-anti-patterns - Risk and Complexity Analysis

Use `ts-anti-patterns` to find risky functions by combining cyclomatic complexity with optional test coverage.

## Fast paths

- **CC-only (default):** `npx ts-anti-patterns@latest ./src`
- **Full CRAP:** `npx ts-anti-patterns@latest --full`
- **HTML report:** `npx ts-anti-patterns@latest ./src --format html --output crap-report.html`
- **Top offenders:** default shows top 20 (`--top 20`)

## CI

- `npx ts-anti-patterns@latest ./src --threshold 30 --fail-above --summary`
- `npx ts-anti-patterns@latest --cov --baseline baseline.json --fail-regression --format json`

## Notes

- Default mode is CC-only (coverage off unless `--cov`, `--full`, or `--lcov`).
- Use `--coverage-command "<cmd>"` when tests need a custom runner command.
