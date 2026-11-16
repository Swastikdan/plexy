#!/usr/bin/env bun
/**
 * Runs the mobile + local-library suites with coverage and enforces a floor.
 *
 * Bun 1.4 accepts `--coverage-threshold` but does not fail when the floor is
 * missed, so the check is done here against the lcov report instead. The
 * floors sit just below the current numbers on purpose: they exist to catch a
 * regression, not to demand a rewrite. Raise them as the suite grows; never
 * lower them to make a branch green.
 *
 * The report is written to `.build/coverage/native/lcov.info` so CI can keep
 * it as an artifact after the run.
 */
import { readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const coverageDir = resolve(root, ".build/coverage/native");
const lcovPath = resolve(coverageDir, "lcov.info");
const FLOORS = { functions: 0.8, lines: 0.85 } as const;

await rm(coverageDir, { recursive: true, force: true });

const suite = Bun.spawn(
  [
    process.execPath,
    "test",
    "apps/mobile/tests",
    "packages/local-library/tests",
    "--coverage",
    "--coverage-reporter=lcov",
    `--coverage-dir=${coverageDir}`,
  ],
  { cwd: root, stdout: "inherit", stderr: "inherit" },
);
if (await suite.exited) {
  console.error("\n✗ mobile tests failed; the coverage floor was not evaluated.");
  process.exit(1);
}

interface FileCoverage {
  file: string;
  functionFound: number;
  functionHit: number;
  lineFound: number;
  lineHit: number;
}

let lcov: string;
try {
  lcov = await readFile(lcovPath, "utf8");
} catch {
  console.error(`\n✗ No coverage report at ${lcovPath}.`);
  process.exit(1);
}

const files: FileCoverage[] = [];
let current: FileCoverage | null = null;
for (const line of lcov.split("\n")) {
  if (line.trim() === "end_of_record") {
    if (current) {
      files.push(current);
      current = null;
    }
    continue;
  }
  const separator = line.indexOf(":");
  if (separator === -1) continue;
  const key = line.slice(0, separator);
  const value = line.slice(separator + 1);
  if (key === "SF") {
    current = { file: value, functionFound: 0, functionHit: 0, lineFound: 0, lineHit: 0 };
    continue;
  }
  if (!current) continue;
  if (key === "FNF") current.functionFound = Number(value);
  else if (key === "FNH") current.functionHit = Number(value);
  else if (key === "LF") current.lineFound = Number(value);
  else if (key === "LH") current.lineHit = Number(value);
}

if (!files.length) {
  console.error("\n✗ The coverage report listed no source files.");
  process.exit(1);
}

const ratio = (hit: number, found: number) => (found ? hit / found : 1);
const sum = (pick: (file: FileCoverage) => number) =>
  files.reduce((total, file) => total + pick(file), 0);

const totals = {
  functions: ratio(sum((f) => f.functionHit), sum((f) => f.functionFound)),
  lines: ratio(sum((f) => f.lineHit), sum((f) => f.lineFound)),
};

const percent = (value: number) => `${(value * 100).toFixed(2)}%`;
const weakest = [...files]
  .sort((a, b) => ratio(a.lineHit, a.lineFound) - ratio(b.lineHit, b.lineFound))
  .slice(0, 8);

console.log("\nCoverage (mobile + local-library):");
console.log(`  functions ${percent(totals.functions)}  floor ${percent(FLOORS.functions)}`);
console.log(`  lines     ${percent(totals.lines)}  floor ${percent(FLOORS.lines)}`);
console.log("\nLowest line coverage:");
for (const file of weakest) {
  console.log(
    `  ${percent(ratio(file.lineHit, file.lineFound)).padStart(7)}  ${
      file.file.replace(`${root}/`, "")
    }`,
  );
}

const missed: string[] = [];
if (totals.functions < FLOORS.functions) missed.push("functions");
if (totals.lines < FLOORS.lines) missed.push("lines");
if (missed.length) {
  console.error(`\n✗ Coverage below floor: ${missed.join(", ")}.`);
  console.error("  Add tests for the untested paths above, or lower the floor in");
  console.error("  scripts/test-native.ts with a note explaining why.");
  process.exit(1);
}
console.log(`\n✓ Coverage floor met. Report: ${lcovPath}`);
