// Fixture: covers the cases we care about in Phase 1.

export function trivial(a: number): number {
  return a + 1
}

export function ifElse(x: number): string {
  if (x > 0) return "pos"
  else if (x < 0) return "neg"
  else return "zero"
}

export function flatSwitch(x: number): string {
  switch (x) {
    case 1:
      return "one"
    case 2:
      return "two"
    case 3:
      return "three"
    default:
      return "other"
  }
}

export function logicalChain(a: boolean, b: boolean, c: boolean): boolean {
  return a && b && c
}

export function logicalMixed(a: boolean, b: boolean, c: boolean): boolean {
  return a && b || c
}

export function withNullish(x: string | null, y: string | null): string {
  return x ?? y ?? "fallback"
}

export function optionalChain(o: { a?: { b?: number } } | null): number {
  return o?.a?.b ?? 0
}

export function nested(items: number[]): number {
  let total = 0
  for (const item of items) {
    if (item > 0) {
      for (const i of [1, 2, 3]) {
        if (i > item) total++
      }
    }
  }
  return total
}

export class UserCard {
  private name: string
  static counter = 0

  constructor(name: string) {
    this.name = name
  }

  render(): string {
    return `<${this.name}>`
  }

  get size(): number {
    return this.name.length
  }

  set size(_v: number) {
    // no-op
  }

  #private(): string {
    return this.name
  }

  static factory(name: string): UserCard {
    return new UserCard(name)
  }
}

export const arrowConst = (n: number) => n * 2

export default function() {
  return 42
}

// Nested function inside a function - outer must NOT inherit inner CC.
export function outer() {
  function inner(z: number): number {
    if (z > 0) return 1
    if (z < 0) return -1
    return 0
  }
  return inner(1)
}
