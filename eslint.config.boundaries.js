// ESLint config used by `pnpm lint:boundaries` to lint the synthetic
// fixtures under `tests/eslint-boundaries/`. The main `eslint.config.js`
// globally ignores that directory; this config re-applies the boundary
// rules to it so the fixtures can be exercised in isolation.
//
// Files are mapped to elements by their parent directory under
// `tests/eslint-boundaries/<element>/`.

import tsparser from "@typescript-eslint/parser";
import { boundaryConfigBlocks } from "./eslint.boundaries.js";

export default [
  {
    ignores: ["node_modules/**", "dist/**", ".next/**", "build/**"],
  },
  {
    files: ["tests/eslint-boundaries/**/*.ts"],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: "module",
      },
    },
  },
  ...boundaryConfigBlocks({
    protocol: ["tests/eslint-boundaries/protocol/**/*.ts"],
    worker: ["tests/eslint-boundaries/worker/**/*.ts"],
    lib: ["tests/eslint-boundaries/lib/**/*.ts"],
    app: ["tests/eslint-boundaries/app/**/*.ts"],
    components: ["tests/eslint-boundaries/components/**/*.ts"],
    cli: ["tests/eslint-boundaries/cli/**/*.ts"],
    types: ["tests/eslint-boundaries/types/**/*.ts"],
  }),
];
