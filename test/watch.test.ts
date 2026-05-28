// watch.ts behaviour: debounces a save-burst into one trigger, coalesces
// while an earlier callback is still running, ignores non-source files,
// and respects close().

import { describe, it, expect, afterEach } from "vitest"
import { mkdtempSync, rmSync, writeFileSync, appendFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { watch, type WatchHandle } from "../src/watch.js"

const dirs: string[] = []
const handles: WatchHandle[] = []

function mkRoot(): string {
  const d = mkdtempSync(join(tmpdir(), "ts-crap-watch-"))
  dirs.push(d)
  return d
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

afterEach(async () => {
  while (handles.length) {
    const h = handles.pop()
    if (h) await h.close()
  }
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})

describe("watch()", () => {
  it("fires once on startup", async () => {
    const root = mkRoot()
    writeFileSync(join(root, "a.ts"), "export const x = 1\n")
    let calls = 0
    const handle = watch({
      root,
      debounceMs: 30,
      onTrigger: () => {
        calls++
      },
    })
    handles.push(handle)
    // Initial trigger is queued via setTimeout(0) inside watch().
    await sleep(150)
    expect(calls).toBe(1)
  })

  it("debounces a save-burst into one callback", async () => {
    const root = mkRoot()
    writeFileSync(join(root, "a.ts"), "const x = 1\n")
    let calls = 0
    const handle = watch({
      root,
      initial: false,
      debounceMs: 80,
      onTrigger: () => {
        calls++
      },
    })
    handles.push(handle)
    await sleep(50) // settle the initial scan

    // Five quick saves should collapse to one trigger.
    for (let i = 0; i < 5; i++) {
      appendFileSync(join(root, "a.ts"), `// edit ${i}\n`)
      await sleep(10)
    }
    // awaitWriteFinish (80ms) + our debounce (80ms) + headroom.
    await sleep(400)
    expect(calls).toBe(1)
  })

  it("ignores non-source files like README.md or coverage/*.info", async () => {
    const root = mkRoot()
    writeFileSync(join(root, "a.ts"), "const x = 1\n")
    let calls = 0
    const handle = watch({
      root,
      initial: false,
      debounceMs: 50,
      onTrigger: () => {
        calls++
      },
    })
    handles.push(handle)
    await sleep(50)

    writeFileSync(join(root, "README.md"), "# hi\n")
    writeFileSync(join(root, "notes.txt"), "x\n")
    await sleep(400)
    expect(calls).toBe(0)
  })

  it("coalesces a trigger that arrives while the previous callback is still running", async () => {
    const root = mkRoot()
    writeFileSync(join(root, "a.ts"), "const x = 1\n")
    let calls = 0
    let resolveFirst: () => void = () => undefined
    const firstDone = new Promise<void>((r) => {
      resolveFirst = r
    })
    const handle = watch({
      root,
      initial: false,
      debounceMs: 30,
      onTrigger: async () => {
        calls++
        if (calls === 1) await firstDone
      },
    })
    handles.push(handle)
    await sleep(50)

    // Kick off run #1; it's blocked on firstDone.
    appendFileSync(join(root, "a.ts"), "// edit a\n")
    // chokidar's awaitWriteFinish (stabilityThreshold 80ms) + our debounce
    // (30ms) gates the first callback. Give it room.
    await sleep(250)
    expect(calls).toBe(1)

    // While #1 is stuck, write again - should be coalesced into one rerun.
    appendFileSync(join(root, "a.ts"), "// edit b\n")
    await sleep(20)
    appendFileSync(join(root, "a.ts"), "// edit c\n")
    await sleep(250)
    expect(calls).toBe(1) // still 1, not 2 - the writes were buffered

    // Unblock - exactly one rerun should follow.
    resolveFirst()
    await sleep(400)
    expect(calls).toBe(2)
  })

  it("close() stops further callbacks", async () => {
    const root = mkRoot()
    writeFileSync(join(root, "a.ts"), "const x = 1\n")
    let calls = 0
    const handle = watch({
      root,
      initial: false,
      debounceMs: 30,
      onTrigger: () => {
        calls++
      },
    })
    handles.push(handle)
    await sleep(50)
    await handle.close()

    appendFileSync(join(root, "a.ts"), "// after close\n")
    await sleep(400)
    expect(calls).toBe(0)
  })
})
