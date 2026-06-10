import js from "@eslint/js";
import tseslint from "typescript-eslint";

const sideEffectGlobals = [
  "fetch",
  "setTimeout",
  "setInterval",
  "clearTimeout",
  "clearInterval",
  "document",
  "window",
  "localStorage",
  "sessionStorage",
  "crypto",
];

export default tseslint.config(
  {
    ignores: ["coverage/", "dist/", "node_modules/", "eslint.config.js"],
  },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/array-type": ["error", { default: "generic" }],
      "@typescript-eslint/consistent-type-definitions": ["error", "type"],
      "@typescript-eslint/no-confusing-void-expression": "error",
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-unnecessary-condition": "error",
      "@typescript-eslint/prefer-readonly": "error",
      "@typescript-eslint/strict-boolean-expressions": "error",
      "no-restricted-globals": [
        "error",
        ...sideEffectGlobals.map((name) => ({
          name,
          message: `${name} is managed by Hypertea effects or subscriptions.`,
        })),
      ],
    },
  },
);
