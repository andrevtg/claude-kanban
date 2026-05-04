// Module-boundary rules — see docs/01-architecture.md ("Module boundaries")
// and docs/03-decisions.md (ADR-011).
//
// Encodes which `src/<element>/` directories may import from which other
// `src/<element>/` directories. The rules are applied via ESLint's built-in
// `no-restricted-imports` rule (catches both value and type imports). The
// element-to-files mapping is parameterized so the same rules can be run
// against `src/` (production lint) and against the synthetic fixtures under
// `tests/eslint-boundaries/` (regression check that the rule still fires on
// each forbidden shape).

const ELEMENT_PATTERNS = {
  protocol: ["**/protocol/**", "**/protocol", "@/protocol/**", "@/protocol"],
  worker: ["**/worker/**", "**/worker", "@/worker/**", "@/worker"],
  lib: ["**/lib/**", "**/lib", "@/lib/**", "@/lib"],
  app: ["**/app/**", "**/app", "@/app/**", "@/app"],
  components: ["**/components/**", "**/components", "@/components/**", "@/components"],
  cli: ["**/cli/**", "**/cli", "@/cli/**", "@/cli"],
  types: ["**/types/**", "**/types", "@/types/**", "@/types"],
};

const FORBIDDEN = {
  protocol: ["lib", "worker", "app", "components", "cli", "types"],
  worker: ["lib", "app", "components", "cli"],
  lib: ["worker", "app", "components", "cli"],
  app: ["worker"],
  components: ["worker"],
  cli: ["worker"],
  types: ["protocol", "lib", "worker", "app", "components", "cli"],
};

function buildPatterns(sourceElement) {
  return FORBIDDEN[sourceElement].map((target) => ({
    group: ELEMENT_PATTERNS[target],
    message:
      `src/${sourceElement}/** must not import from src/${target}/**. ` +
      `See docs/01-architecture.md (Module boundaries) and docs/03-decisions.md (ADR-011). ` +
      `If the two sides need to share a type, move it into src/protocol/.`,
  }));
}

/**
 * Build the per-element ESLint config blocks that enforce the module
 * boundaries. `fileGlobs` maps each element name to the glob(s) whose files
 * should be treated as belonging to that element.
 */
export function boundaryConfigBlocks(fileGlobs) {
  return Object.keys(FORBIDDEN).map((element) => ({
    files: fileGlobs[element],
    rules: {
      "no-restricted-imports": ["error", { patterns: buildPatterns(element) }],
    },
  }));
}

export const ELEMENTS = Object.keys(FORBIDDEN);
