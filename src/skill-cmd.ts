import { copyFile, mkdir, readFile, rm } from "node:fs/promises"
import { existsSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

export type SkillScope = "global" | "project"

const SKILL_NAME = "ts-anti-patterns"

export function resolveSkillPath(scope: SkillScope, cwd = process.cwd()): string {
  if (scope === "project") {
    return join(cwd, ".agents", "skills", SKILL_NAME, "SKILL.md")
  }
  return join(homedir(), ".agents", "skills", SKILL_NAME, "SKILL.md")
}

export function resolveBundledSkillPath(): string {
  const here = fileURLToPath(new URL(".", import.meta.url))
  const candidates = [
    resolve(here, "skill", "SKILL.md"),
    resolve(here, "..", "src", "skill", "SKILL.md"),
  ]
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }
  throw new Error(
    `bundled SKILL.md not found. Looked in: ${candidates.join(", ")}`
  )
}

export async function installSkill(scope: SkillScope, cwd = process.cwd()): Promise<string> {
  const src = resolveBundledSkillPath()
  const dest = resolveSkillPath(scope, cwd)
  await mkdir(dirname(dest), { recursive: true })
  await copyFile(src, dest)
  return dest
}

export async function uninstallSkill(scope: SkillScope, cwd = process.cwd()): Promise<boolean> {
  const dest = resolveSkillPath(scope, cwd)
  if (!existsSync(dest)) return false
  await rm(dest, { force: true })
  try {
    await rm(dirname(dest))
  } catch {
    // keep non-empty dirs
  }
  return true
}

export async function showSkill(): Promise<string> {
  const src = resolveBundledSkillPath()
  return readFile(src, "utf8")
}
