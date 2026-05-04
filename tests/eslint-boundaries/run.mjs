#!/usr/bin/env node
// Runner for the synthetic module-boundary lint fixtures.
//
// Lints every file under tests/eslint-boundaries/<element>/ using the
// dedicated boundary config and asserts:
//   - fail-*.ts files produce >= 1 `no-restricted-imports` violation
//   - pass-*.ts files produce 0 boundary violations
//
// Exits non-zero on any mismatch. Wired into `pnpm lint:boundaries`.

import { spawnSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..");
const RULE_ID = "no-restricted-imports";

function listFixtures(root) {
  const out = [];
  for (const element of readdirSync(root)) {
    const dir = join(root, element);
    if (!statSync(dir).isDirectory()) continue;
    for (const name of readdirSync(dir)) {
      if (!name.endsWith(".ts")) continue;
      out.push(join(dir, name));
    }
  }
  return out;
}

function expectedFor(filePath) {
  const base = filePath.split("/").pop() ?? "";
  if (base.startsWith("fail-")) return "fail";
  if (base.startsWith("pass-")) return "pass";
  return null;
}

function runEslint(files) {
  const result = spawnSync(
    "pnpm",
    [
      "exec",
      "eslint",
      "--no-config-lookup",
      "--config",
      "eslint.config.boundaries.js",
      "--format",
      "json",
      ...files.map((f) => relative(repoRoot, f)),
    ],
    { cwd: repoRoot, encoding: "utf8" },
  );
  // ESLint exits 1 when there are lint errors; that's expected here.
  // It exits 2 only on crashes or config errors.
  if (result.status === 2 || result.error) {
    process.stderr.write(result.stderr);
    process.stderr.write(result.stdout);
    throw new Error("eslint crashed (status 2)");
  }
  if (!result.stdout.trim()) {
    process.stderr.write(result.stderr);
    throw new Error("eslint produced no JSON output");
  }
  return JSON.parse(result.stdout);
}

const fixtures = listFixtures(here);
if (fixtures.length === 0) {
  console.error("No fixtures found under tests/eslint-boundaries/.");
  process.exit(1);
}

const report = runEslint(fixtures);
const byPath = new Map(report.map((r) => [r.filePath, r]));

let failures = 0;
const lines = [];
for (const fixture of fixtures) {
  const expected = expectedFor(fixture);
  const rel = relative(repoRoot, fixture);
  if (!expected) {
    lines.push(`SKIP   ${rel} (filename has no fail-/pass- prefix)`);
    continue;
  }
  const entry = byPath.get(fixture);
  const messages = (entry?.messages ?? []).filter((m) => m.ruleId === RULE_ID);
  const count = messages.length;
  if (expected === "fail" && count < 1) {
    failures++;
    lines.push(`FAIL   ${rel} expected ≥1 ${RULE_ID} violation, got 0`);
  } else if (expected === "pass" && count > 0) {
    failures++;
    lines.push(`FAIL   ${rel} expected 0 ${RULE_ID} violations, got ${count}`);
    for (const m of messages) {
      lines.push(`         ↳ line ${m.line}: ${m.message}`);
    }
  } else {
    lines.push(`OK     ${rel} (${expected}, ${count} violation${count === 1 ? "" : "s"})`);
  }
}

console.log(lines.join("\n"));
if (failures > 0) {
  console.error(`\n${failures} fixture${failures === 1 ? "" : "s"} did not match expectation.`);
  process.exit(1);
}
console.log(`\nAll ${fixtures.length} boundary fixtures matched expectation.`);
