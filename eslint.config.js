import tseslint from "@typescript-eslint/eslint-plugin";
import tsparser from "@typescript-eslint/parser";
import { boundaryConfigBlocks } from "./eslint.boundaries.js";

export default [
  {
    ignores: [
      "node_modules/**",
      "dist/**",
      ".next/**",
      "build/**",
      ".agents/**",
      "next-env.d.ts",
      // Synthetic fixtures — linted only by `pnpm lint:boundaries`.
      "tests/eslint-boundaries/**",
    ],
  },
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: "module",
      },
    },
    plugins: {
      "@typescript-eslint": tseslint,
    },
    rules: {
      ...tseslint.configs.recommended.rules,
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  ...boundaryConfigBlocks({
    protocol: ["src/protocol/**/*.{ts,tsx}"],
    worker: ["src/worker/**/*.{ts,tsx}"],
    lib: ["src/lib/**/*.{ts,tsx}"],
    app: ["src/app/**/*.{ts,tsx}"],
    components: ["src/components/**/*.{ts,tsx}"],
    cli: ["src/cli/**/*.{ts,tsx}"],
    types: ["src/types/**/*.{ts,tsx}", "src/types/**/*.d.ts"],
  }),
];
