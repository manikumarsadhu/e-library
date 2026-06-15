import js from "@eslint/js";
import globals from "globals";

export default [
  // Backend — Node.js ESM
  {
    files: ["api/**/*.js", "dev-server.js"],
    ...js.configs.recommended,
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        ...globals.node,
      },
    },
    rules: {
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
      "no-console": "off",
    },
  },

  // Frontend — Browser ESM
  {
    files: ["frontend/js/**/*.js"],
    ...js.configs.recommended,
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        ...globals.browser,
        pdfjsLib: "readonly",
      },
    },
    rules: {
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
      "no-console": ["warn", { allow: ["error", "warn"] }],
    },
  },

  // Ignore node_modules and build artifacts
  {
    ignores: ["node_modules/**", "*.min.js"],
  },
];
