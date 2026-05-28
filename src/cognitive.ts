// Cognitive Complexity (Sonar / G. Ann Campbell, 2018).
//
// Differs from McCabe in two important ways:
//   1. Nested control structures get a nesting penalty (B3: +nesting).
//   2. Linear flow (sequential statements) doesn't get punished even at large
//      counts - the metric tracks understandability rather than path count.
//
// We compute one cognitive score per function (no descent into nested
// functions, mirroring our CC policy), so each function is judged on its own
// shape.

import type { TSESTree } from "@typescript-eslint/typescript-estree"

export interface CognitiveOptions {
  countNullishCoalescing: boolean
}

type AnyNode = TSESTree.Node

// Nodes that count as a flow break AND raise nesting for their children.
const FLOW_BREAKS = new Set<string>([
  "IfStatement",
  "ConditionalExpression",
  "ForStatement",
  "ForInStatement",
  "ForOfStatement",
  "WhileStatement",
  "DoWhileStatement",
  "SwitchStatement",
  "CatchClause",
])

// Nodes that stop descent: inner functions get scored independently.
const FUNCTION_LIKE = new Set<string>([
  "FunctionDeclaration",
  "FunctionExpression",
  "ArrowFunctionExpression",
])

// Walk a function body and return its cognitive complexity. Inner functions
// found along the way contribute nesting bonus only - their bodies are not
// inlined into the outer score.
export function cognitiveOfBody(body: AnyNode, opts: CognitiveOptions): number {
  let total = 0

  function visit(node: AnyNode | null | undefined, nesting: number, parent: AnyNode | null): void {
    if (!node || typeof node !== "object" || !node.type) return

    const verdict = classify(node, parent, nesting, opts)
    total += verdict.bump
    if (!verdict.descend) return

    for (const key of Object.keys(node)) {
      if (key === "parent" || key === "loc" || key === "range") continue
      const child = (node as unknown as Record<string, unknown>)[key]
      visitChild(child, verdict.nestingForChildren, node)
    }
  }

  function visitChild(child: unknown, nesting: number, parent: AnyNode): void {
    if (Array.isArray(child)) {
      for (const c of child) visitChild(c, nesting, parent)
      return
    }
    if (child && typeof child === "object" && "type" in child) {
      visit(child as AnyNode, nesting, parent)
    }
  }

  visit(body, 0, null)
  return total
}

interface Classification {
  bump: number
  nestingForChildren: number
  descend: boolean
}

function classify(
  node: AnyNode,
  parent: AnyNode | null,
  nesting: number,
  opts: CognitiveOptions
): Classification {
  if (FLOW_BREAKS.has(node.type)) {
    return { bump: 1 + nesting, nestingForChildren: nesting + 1, descend: true }
  }
  if (FUNCTION_LIKE.has(node.type)) {
    return { bump: 0, nestingForChildren: nesting, descend: false }
  }
  if (node.type === "LogicalExpression") {
    return {
      bump: logicalBump(node, parent, opts),
      nestingForChildren: nesting,
      descend: true,
    }
  }
  return { bump: 0, nestingForChildren: nesting, descend: true }
}

// Per Sonar B4: only count a logical operator when it differs from its parent
// in the same chain. `a && b && c` is +1, `a && b || c` is +2.
function logicalBump(
  node: TSESTree.LogicalExpression,
  parent: AnyNode | null,
  opts: CognitiveOptions
): number {
  const op = node.operator
  const counted = op === "&&" || op === "||" || (opts.countNullishCoalescing && op === "??")
  if (!counted) return 0
  const parentSameChain =
    parent !== null && parent.type === "LogicalExpression" && parent.operator === op
  return parentSameChain ? 0 : 1
}
