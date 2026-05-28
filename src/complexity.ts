// Per-function metrics extracted from a TypeScript/JavaScript source file.
//
// Produces:
//   - Cyclomatic complexity (McCabe): each branching node adds +1, switch
//     default does not add, '??' is opt-in via options.
//   - Cognitive complexity (Sonar / Campbell), computed in ./cognitive.
//   - Source Lines of Code (sloc) for the function body.
//   - A class-qualified, human-readable name.
//   - Line range (line, endLine) for downstream coverage joining.
//
// Crucially: we DO NOT descend into nested function bodies when counting CC
// for the outer function. Each function gets a self-contained score.

import { parse } from "@typescript-eslint/typescript-estree"
import type { TSESTree } from "@typescript-eslint/typescript-estree"
import { basename, extname } from "node:path"
import { cognitiveOfBody, type CognitiveOptions } from "./cognitive.js"
import type { FunctionMetric } from "./options.js"

export interface ComplexityOptions extends CognitiveOptions {
  cognitive: boolean
}

type AnyNode = TSESTree.Node
type FunctionNode =
  | TSESTree.FunctionDeclaration
  | TSESTree.FunctionExpression
  | TSESTree.ArrowFunctionExpression

interface FunctionFrame {
  node: FunctionNode
  name: string
  line: number
  endLine: number
  complexity: number
}

// AST node types that always add +1 to the enclosing function's cyclomatic
// complexity. SwitchCase, LogicalExpression, MemberExpression, and
// CallExpression carry conditional logic and are handled separately.
const ALWAYS_BRANCH = new Set<string>([
  "IfStatement",
  "ConditionalExpression",
  "ForStatement",
  "ForInStatement",
  "ForOfStatement",
  "WhileStatement",
  "DoWhileStatement",
  "CatchClause",
])

const FUNCTION_LIKE = new Set<string>([
  "FunctionDeclaration",
  "FunctionExpression",
  "ArrowFunctionExpression",
])

const CLASS_LIKE = new Set<string>(["ClassDeclaration", "ClassExpression"])

const SKIP_SUBTREE = new Set<string>(["TSDeclareFunction", "TSInterfaceDeclaration"])

export function analyzeFile(
  source: string,
  filePath: string,
  opts: ComplexityOptions
): FunctionMetric[] {
  let ast: TSESTree.Program
  try {
    ast = parse(source, {
      jsx: true,
      loc: true,
      range: true,
      tolerant: true,
    })
  } catch {
    return []
  }

  const sourceLines = source.split(/\r?\n/)
  const fileBase = basename(filePath, extname(filePath))
  const results: FunctionMetric[] = []
  const fnStack: FunctionFrame[] = []
  const classStack: string[] = []

  function topFn(): FunctionFrame | undefined {
    return fnStack[fnStack.length - 1]
  }

  function visit(node: AnyNode | null | undefined, parent: AnyNode | null): void {
    if (!node || typeof node !== "object" || !node.type) return
    if (SKIP_SUBTREE.has(node.type)) return

    const pushedClass = enterClassMaybe(node, parent, classStack)
    const openedFn = enterFunctionMaybe(node, parent, classStack, fileBase, fnStack)

    if (!openedFn) {
      const top = topFn()
      if (top) top.complexity += branchDelta(node, opts)
    }

    visitChildren(node, visit)

    if (openedFn) {
      fnStack.pop()
      results.push(finalizeFrame(openedFn, filePath, sourceLines, opts))
    }
    if (pushedClass) classStack.pop()
  }

  visit(ast, null)
  return results
}

function visitChildren(
  node: AnyNode,
  visit: (n: AnyNode, parent: AnyNode | null) => void
): void {
  for (const key of Object.keys(node)) {
    if (key === "parent" || key === "loc" || key === "range") continue
    const child = (node as unknown as Record<string, unknown>)[key]
    visitChild(child, node, visit)
  }
}

function visitChild(
  child: unknown,
  parent: AnyNode,
  visit: (n: AnyNode, parent: AnyNode | null) => void
): void {
  if (Array.isArray(child)) {
    for (const c of child) visitChild(c, parent, visit)
    return
  }
  if (child && typeof child === "object" && "type" in child) {
    visit(child as AnyNode, parent)
  }
}

function enterClassMaybe(
  node: AnyNode,
  parent: AnyNode | null,
  classStack: string[]
): boolean {
  if (!CLASS_LIKE.has(node.type)) return false
  classStack.push(
    classNameOf(node as TSESTree.ClassDeclaration | TSESTree.ClassExpression, parent)
  )
  return true
}

function enterFunctionMaybe(
  node: AnyNode,
  parent: AnyNode | null,
  classStack: readonly string[],
  fileBase: string,
  fnStack: FunctionFrame[]
): FunctionFrame | undefined {
  if (!FUNCTION_LIKE.has(node.type)) return undefined
  const fnNode = node as FunctionNode
  const frame: FunctionFrame = {
    node: fnNode,
    name: resolveName(fnNode, parent, classStack, fileBase),
    line: fnNode.loc?.start.line ?? 0,
    endLine: fnNode.loc?.end.line ?? 0,
    complexity: 1,
  }
  fnStack.push(frame)
  return frame
}

function finalizeFrame(
  frame: FunctionFrame,
  filePath: string,
  sourceLines: readonly string[],
  opts: ComplexityOptions
): FunctionMetric {
  const cognitive = opts.cognitive
    ? cognitiveOfBody(frame.node.body as AnyNode, {
        countNullishCoalescing: opts.countNullishCoalescing,
      })
    : 0
  return {
    file: filePath,
    function: frame.name,
    line: frame.line,
    endLine: frame.endLine,
    complexity: frame.complexity,
    cognitive,
    sloc: countSloc(sourceLines, frame.line, frame.endLine),
  }
}

// Compute the contribution of a single node to its enclosing function's
// cyclomatic complexity. Returns 0 if the node does not branch.
function branchDelta(node: AnyNode, opts: ComplexityOptions): number {
  if (ALWAYS_BRANCH.has(node.type)) return 1
  if (node.type === "SwitchCase") return node.test ? 1 : 0
  if (node.type === "LogicalExpression") return logicalDelta(node, opts)
  if (node.type === "MemberExpression" || node.type === "CallExpression") {
    return node.optional ? 1 : 0
  }
  return 0
}

function logicalDelta(node: TSESTree.LogicalExpression, opts: ComplexityOptions): number {
  const op = node.operator
  if (op === "&&" || op === "||") return 1
  if (op === "??" && opts.countNullishCoalescing) return 1
  return 0
}

function classNameOf(
  node: TSESTree.ClassDeclaration | TSESTree.ClassExpression,
  parent: AnyNode | null
): string {
  if (node.id && node.id.name) return node.id.name
  // `const C = class { ... }` → use the binding identifier
  if (
    parent &&
    parent.type === "VariableDeclarator" &&
    parent.id.type === "Identifier"
  ) {
    return parent.id.name
  }
  if (
    parent &&
    parent.type === "AssignmentExpression" &&
    parent.left.type === "Identifier"
  ) {
    return parent.left.name
  }
  return "<anonymous>"
}

function resolveName(
  node: FunctionNode,
  parent: AnyNode | null,
  classStack: readonly string[],
  fileBase: string
): string {
  const named = namedDeclName(node)
  if (named) return named
  const exported = exportDefaultName(node, parent, fileBase)
  if (exported) return exported
  const fromParent = parent ? parentScopedName(node, parent, classStack) : undefined
  if (fromParent) return fromParent
  return anonymousName(node)
}

function namedDeclName(node: FunctionNode): string | undefined {
  if (node.type === "FunctionDeclaration" && node.id) return node.id.name
  return undefined
}

function exportDefaultName(
  node: FunctionNode,
  parent: AnyNode | null,
  fileBase: string
): string | undefined {
  if (parent?.type !== "ExportDefaultDeclaration") return undefined
  if (node.type === "FunctionDeclaration" && node.id?.name) return node.id.name
  return `${fileBase}.<default>`
}

function parentScopedName(
  node: FunctionNode,
  parent: AnyNode,
  classStack: readonly string[]
): string | undefined {
  if (parent.type === "MethodDefinition") return methodName(parent, classStack)
  if (parent.type === "PropertyDefinition") return propertyName(parent, classStack)
  if (parent.type === "VariableDeclarator" && parent.id.type === "Identifier") {
    return parent.id.name
  }
  if (parent.type === "AssignmentExpression") return assignmentTargetName(parent.left)
  if (parent.type === "Property") return objectKeyName(parent.key)
  return undefined
}

function anonymousName(node: FunctionNode): string {
  const kind = node.type === "ArrowFunctionExpression" ? "arrow" : "fn"
  return `<${kind}@${node.loc?.start.line ?? 0}>`
}

function methodName(
  md: TSESTree.MethodDefinition,
  classStack: readonly string[]
): string {
  const cls = classStack[classStack.length - 1] ?? "<anonymous>"
  const keyName = methodOrPropertyKeyName(md.key)
  if (md.kind === "constructor") return `${cls}.<constructor>`
  if (md.kind === "get") return `${cls}.<get>.${keyName}`
  if (md.kind === "set") return `${cls}.<set>.${keyName}`
  if (md.key.type === "PrivateIdentifier") return `${cls}#${md.key.name}`
  if (md.static) return `${cls}.<static>.${keyName}`
  return `${cls}.${keyName}`
}

function propertyName(
  pd: TSESTree.PropertyDefinition,
  classStack: readonly string[]
): string {
  const cls = classStack[classStack.length - 1] ?? "<anonymous>"
  if (pd.key.type === "PrivateIdentifier") return `${cls}#${pd.key.name}`
  const keyName = methodOrPropertyKeyName(pd.key)
  if (pd.static) return `${cls}.<static>.${keyName}`
  return `${cls}.${keyName}`
}

function methodOrPropertyKeyName(key: TSESTree.Node): string {
  if (key.type === "Identifier") return key.name
  if (key.type === "PrivateIdentifier") return `#${key.name}`
  if (key.type === "Literal") return String((key as TSESTree.Literal).value)
  return "[computed]"
}

function objectKeyName(key: TSESTree.Node): string {
  if (key.type === "Identifier") return key.name
  if (key.type === "Literal") return String((key as TSESTree.Literal).value)
  return "[computed]"
}

function assignmentTargetName(left: TSESTree.Node): string {
  if (left.type === "Identifier") return left.name
  if (left.type === "MemberExpression") {
    const object = memberObjectName(left.object)
    const prop = methodOrPropertyKeyName(left.property)
    return left.computed ? `${object}[${prop}]` : `${object}.${prop}`
  }
  return "<assigned>"
}

// --- Backward-compat alias for the legacy CLI/tests while we migrate.
// Will be removed at the end of Phase 1 when cli.ts is rewritten.
/** @deprecated use analyzeFile */
export interface FunctionComplexity {
  name: string
  line: number
  complexity: number
}

/** @deprecated use analyzeFile */
export function analyzeComplexity(source: string, filePath: string): FunctionComplexity[] {
  return analyzeFile(source, filePath, {
    cognitive: false,
    countNullishCoalescing: false,
  }).map((m) => ({ name: m.function, line: m.line, complexity: m.complexity }))
}

function memberObjectName(node: TSESTree.Node): string {
  if (node.type === "Identifier") return node.name
  if (node.type === "ThisExpression") return "this"
  if (node.type === "MemberExpression") {
    return assignmentTargetName(node)
  }
  return "?"
}

// Count non-blank, non-comment-only lines in [start, end].
// Block comments are approximated: a line that is entirely inside a block
// comment but doesn't contain code on either side is skipped. Edge cases
// (lines that share code + block comment) count as code.
function countSloc(lines: readonly string[], start: number, end: number): number {
  let count = 0
  let inBlockComment = false
  const lo = Math.max(1, start)
  const hi = Math.min(lines.length, end)
  for (let i = lo; i <= hi; i++) {
    const raw = lines[i - 1] ?? ""
    const trimmed = raw.trim()
    if (!trimmed) continue

    const { hasCode, leavesBlock } = analyzeCommentLine(trimmed, inBlockComment)
    inBlockComment = leavesBlock
    if (hasCode) count++
  }
  return count
}

function analyzeCommentLine(
  trimmed: string,
  inBlock: boolean
): { hasCode: boolean; leavesBlock: boolean } {
  // Cheap heuristic - not a full tokenizer. Good enough for SLOC.
  let i = 0
  let block = inBlock
  let foundCode = false
  while (i < trimmed.length) {
    if (block) {
      const end = trimmed.indexOf("*/", i)
      if (end === -1) return { hasCode: foundCode, leavesBlock: true }
      i = end + 2
      block = false
      continue
    }
    if (trimmed.startsWith("//", i)) return { hasCode: foundCode, leavesBlock: false }
    if (trimmed.startsWith("/*", i)) {
      block = true
      i += 2
      continue
    }
    // Any non-whitespace, non-comment char counts as code on this line.
    if (!/\s/.test(trimmed[i] ?? " ")) foundCode = true
    i++
  }
  return { hasCode: foundCode, leavesBlock: block }
}
