import eslint from "@eslint/js";
import eslintConfigPrettier from "eslint-config-prettier";
import vitest from "eslint-plugin-vitest";
import tsEslint from "typescript-eslint";
// https://eslint.org/docs/latest/use/configure/migration-guide#using-eslintrc-configs-in-flat-config
import typescriptParser from "@typescript-eslint/parser";
import reactPlugin from "eslint-plugin-react";
import hooksPlugin from "eslint-plugin-react-hooks";
import importPlugin from "eslint-plugin-import-x";
import { createTypeScriptImportResolver } from "eslint-import-resolver-typescript";
import unusedImports from "eslint-plugin-unused-imports";

export default [
  {
    ignores: [
      "node_modules/",
      "dist/",
      "build/",
      "public/build/",
      "coverage/",
      "app/**/*generated*",
      "app/**/entry.worker.ts",
      "app/**/__generated__/",
      "./**/.storybook/*",
      ".shopify",
      "./**/*.yml",
      "shopify-app-remix",
      "app/types/",
      "vite.config.ts",
      "i18n/",
      "extensions/scan-product/node_modules/",
      "extensions/scan-product/dist/",
      ".graphqlrc.ts",
    ],
  },
  {
    languageOptions: {
      globals: {
        NodeJS: true,
        React: true,
      },
    },
  },
  // Replacement for "eslint:recommended" and "eslint:all"
  eslint.configs.recommended,
  eslintConfigPrettier,
  ...tsEslint.configs.strict,
  ...tsEslint.configs.stylistic,
  {
    languageOptions: {
      parser: typescriptParser,
    },
    files: ["**/*.ts", "**/*.tsx"],
    plugins: {
      react: reactPlugin,
      "react-hooks": hooksPlugin,
      "import-x": importPlugin,
      "unused-imports": unusedImports,
    },
    rules: {
      ...hooksPlugin.configs.recommended.rules,
      ...importPlugin.flatConfigs.recommended.rules,
      "@typescript-eslint/consistent-type-definitions": ["error", "type"],
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-unused-vars": "off",
      "no-unused-vars": "off",
      "import-x/order": [
        "error",
        {
          // グループごとの並び順
          groups: [
            "builtin", // node "builtin" のモジュール
            "external", // npm install したパッケージ
            "internal", // パス設定したモジュール
            ["parent", "sibling"], // 親階層と子階層のファイル
            "object", // object-imports
            "type", // 型だけをインポートする
            "index", // 同階層のファイル
          ],
          // グループごとに改行を入れるか
          "newlines-between": "never",
          // アルファベット順・大文字小文字を区別なし
          alphabetize: {
            order: "asc",
            caseInsensitive: true,
          },
        },
      ],
      "import-x/no-nodejs-modules": "off",
      "unused-imports/no-unused-imports": "error",
      "unused-imports/no-unused-vars": [
        "warn",
        {
          vars: "all",
          varsIgnorePattern: "^_",
          args: "after-used",
          argsIgnorePattern: "^_",
        },
      ],
    },
    settings: {
      "import-x/resolver-next": [
        createTypeScriptImportResolver({
          alwaysTryTypes: true, // always try to resolve types under `<root>@types` directory even it doesn't contain any source code, like `@types/unist`
          project: "./tsconfig.json",
        }),
      ],
    },
  },
  // ...compat.config({
  //   env: {
  //     browser: true,
  //     es6: true,
  //     node: true,
  //   },
  //   extends: ["plugin:tailwindcss/recommended"],
  //   rules: {
  //     "no-irregular-whitespace": "off",
  //     "tailwindcss/no-custom-classname": "off",
  //     "tailwindcss/migration-from-tailwind-2": "off",
  //     "tailwindcss/enforces-shorthand": "error",
  //     "tailwindcss/classnames-order": "error",
  //   },
  // }),
  {
    files: ["./**/*.(test|spec).(ts|js)"], // or any other pattern
    plugins: {
      vitest,
    },
    rules: {
      ...vitest.configs.recommended.rules, // you can also use vitest.configs.all.rules to enable all rules
      "vitest/max-nested-describe": ["error", { max: 3 }], // you can also modify rules' behavior using option like this
    },
  },
];
