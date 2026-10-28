import { RuleTester } from "oxlint/plugins-dev"

import { requireSafetyCommentForTypeAssertionRule } from "./require-safety-comment-for-type-assertion.ts"

const tsx = new RuleTester({
  languageOptions: { parserOptions: { lang: "tsx" } },
})
const ts = new RuleTester({
  languageOptions: { parserOptions: { lang: "ts" } },
})
const error = { messageId: "missingSafetyComment" }

tsx.run("anti-slop/require-safety-comment-for-type-assertion", requireSafetyCommentForTypeAssertionRule, {
  valid: [
    "const values = [1, 2] as const;",
    "// SAFETY: The parser established the UserId invariant.\nconst id = value as UserId;",
    "function parse(): UserId {\n// SAFETY: Validation above established the UserId invariant.\nreturn value as UserId;\n}",
    "const id = /* SAFETY: Validation established the invariant. */ value as UserId;",
    "const el = <Foo /* SAFETY: Props are compatible. */ prop={value as T} />;",
    "const el = <Sonner\n  // SAFETY: Theme unions are compatible.\n  theme={theme as ToasterProps['theme']}\n/>;",
    "const el = <Sonner theme={(() => { // SAFETY: ok\nreturn theme as ToasterProps['theme']; })()} />;",
  ],
  invalid: [
    { code: "const id = value as UserId;", errors: [error] },
    {
      code: "const id = value as UserId; // SAFETY: Too late.",
      errors: [error],
    },
    {
      code: "// This cast seems fine.\nconst id = value as UserId;",
      errors: [error],
    },
    {
      code: "const el = <Sonner theme={theme as ToasterProps['theme']} />;",
      errors: [error],
    },
    {
      code: "// SAFETY: belongs to a different statement.\nfoo();\nconst id = value as UserId;",
      errors: [error],
    },
  ],
})

ts.run(
  "anti-slop/require-safety-comment-for-type-assertion: angle-bracket assertions, which only ts parses",
  requireSafetyCommentForTypeAssertionRule,
  {
    valid: ["const value = <const>{ id: 'one' };", "// SAFETY: The parser established the UserId invariant.\nconst id = <UserId>value;"],
    invalid: [{ code: "const id = <UserId>value;", errors: [error] }],
  },
)

tsx.run(
  "anti-slop/require-safety-comment-for-type-assertion: a SAFETY comment after the assertion does not count",
  requireSafetyCommentForTypeAssertionRule,
  {
    valid: [],
    invalid: [
      {
        code: "const el = <Foo style={{ color: 'red' } as React.CSSProperties\n  // SAFETY: Custom properties are valid CSSProperties keys.\n} />;",
        errors: [error],
      },
    ],
  },
)
