import { defineRule } from "@oxlint/plugins"
import type { ESTree, SourceCode } from "@oxlint/plugins"

type TypeAssertion = ESTree.TSAsExpression | ESTree.TSTypeAssertion

const commentOwnerKinds = new Set(["ExpressionStatement", "PropertyDefinition", "ReturnStatement", "ThrowStatement", "VariableDeclaration"])

function isConstAssertion(node: TypeAssertion): boolean {
  return (
    node.typeAnnotation.type === "TSTypeReference" &&
    node.typeAnnotation.typeName.type === "Identifier" &&
    node.typeAnnotation.typeName.name === "const"
  )
}

function hasSafetyComment(sourceCode: SourceCode, node: TypeAssertion): boolean {
  // `getCommentsBefore` only sees comments sitting between the node and its
  // preceding token. Inside JSX (attributes, expression containers, object
  // literals used as prop values) the SAFETY comment is separated from the
  // assertion by JSX structure, so it never qualifies; it must be found by
  // scanning the span of each ancestor instead.
  const allComments = sourceCode.getAllComments()
  let current: ESTree.Node = node
  while (true) {
    const matches = (comment: { start: number; end: number; value: string }) => comment.end <= node.start && /\bSAFETY\s*:/u.test(comment.value)
    if (allComments.some((comment) => comment.start >= current.start && matches(comment)) || sourceCode.getCommentsBefore(current).some(matches)) {
      return true
    }
    if (commentOwnerKinds.has(current.type) || current.parent.type === "Program") return false
    current = current.parent
  }
}

/** Require every non-const type assertion to state the invariant TypeScript cannot express. */
export const requireSafetyCommentForTypeAssertionRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description: "Require a nearby SAFETY comment for every TypeScript type assertion except const assertions.",
    },
    messages: {
      missingSafetyComment:
        "This type assertion has no `SAFETY:` justification. State the checked invariant immediately before the assertion or its containing statement.",
    },
  },
  createOnce(context) {
    const checkAssertion = (node: TypeAssertion) => {
      if (isConstAssertion(node) || hasSafetyComment(context.sourceCode, node)) return
      context.report({ node, messageId: "missingSafetyComment" })
    }

    return {
      TSAsExpression: checkAssertion,
      TSTypeAssertion: checkAssertion,
    }
  },
})
