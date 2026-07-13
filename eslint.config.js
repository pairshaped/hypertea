import js from "@eslint/js";
import tseslint from "typescript-eslint";

import { hyperteaPurity } from "./eslint-purity.js";

const typedFiles = ["src/**/*.ts"];

export default tseslint.config(
  {
    ignores: ["benchmark/", "coverage/", "dist/", "node_modules/", "eslint.config.js"],
  },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked.map((config) => ({ ...config, files: typedFiles })),
  ...tseslint.configs.stylisticTypeChecked.map((config) => ({ ...config, files: typedFiles })),
  {
    files: typedFiles,
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
    },
  },
  // program.ts is the pure public facade. index.ts owns the runtime's browser
  // effects, so it is intentionally outside the application purity boundary.
  ...hyperteaPurity({ files: ["src/program.ts"] }),
);
