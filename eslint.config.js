import eslint from "@eslint/js";
import tseslint from "@typescript-eslint/eslint-plugin";
import tsparser from "@typescript-eslint/parser";
import globals from "globals";

export default [
  eslint.configs.recommended,
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
      },
      globals: {
        ...globals.node,
      },
    },
    plugins: {
      "@typescript-eslint": tseslint,
    },
    rules: {
      ...tseslint.configs.recommended.rules,
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/explicit-function-return-type": "off",
      "@typescript-eslint/no-explicit-any": "warn",
      // Ban manual `.length / 4` token estimation on serialized strings.
      // Use estimateSerializedTokens() from @agent-recorder/core instead —
      // it uses TextEncoder for byte-accurate UTF-8 counting, consistent with
      // estimateTokens(). String.length is a UTF-16 char count and
      // under-counts non-ASCII (emoji, CJK, etc.).
      "no-restricted-syntax": [
        "error",
        {
          // Flag `.length / 4` only when `.length` is on an identifier or
          // member expression (i.e. a string variable). Excludes the correct
          // pattern `encode(...).length / 4` where the object is a
          // CallExpression (Uint8Array.length, not String.length).
          selector:
            "BinaryExpression[operator='/'][right.value=4] > MemberExpression.left[property.name='length'][object.type!='CallExpression']",
          message:
            "Use estimateSerializedTokens() from @agent-recorder/core instead of .length / 4. String.length is UTF-16 char count, not UTF-8 bytes.",
        },
      ],
    },
  },
  {
    files: ["packages/ui/**/*.ts", "packages/ui/**/*.tsx"],
    languageOptions: {
      globals: {
        ...globals.browser,
      },
    },
  },
  {
    ignores: ["**/dist/**", "**/node_modules/**", "**/*.js"],
  },
];
