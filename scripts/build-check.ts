#!/usr/bin/env bun
/**
 * Preflight every app without the native packaging steps (Gradle APK and
 * electron-builder DMG). Those require local native toolchains; this script
 * verifies the code, tests and production bundles that feed them.
 */
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..");

interface Step {
  label: string;
  command: string[];
  env?: Record<string, string>;
}

const steps: Step[] = [
  { label: "Typecheck server, web, desktop & packages", command: ["typecheck"] },
  { label: "Typecheck mobile", command: ["typecheck:native"] },
  { label: "Lint mobile", command: ["--filter", "@plexy/mobile", "lint"] },
  { label: "Test server", command: ["test"] },
  { label: "Test desktop", command: ["test:desktop"] },
  { label: "Test mobile & local-library", command: ["test:native"] },
  { label: "Build web", command: ["--filter", "@plexy/web", "build"] },
  {
    label: "Build desktop main & preload",
    command: ["--filter", "@plexy/desktop", "build:main"],
  },
  {
    label: "Build server bundle",
    command: ["build:server"],
    env: { PLEXY_REUSE_WEB_BUILD: "true" },
  },
  {
    label: "Bundle mobile",
    command: ["--filter", "@plexy/mobile", "bundle"],
  },
];

for (const [index, step] of steps.entries()) {
  console.log(`\n[build:check ${index + 1}/${steps.length}] ${step.label}`);
  const child = Bun.spawn(["bun", "run", ...step.command], {
    cwd: root,
    env: { ...process.env, ...step.env },
    stdout: "inherit",
    stderr: "inherit",
  });
  const code = await child.exited;
  if (code !== 0) {
    console.error(`\n✗ build:check failed at: ${step.label}`);
    process.exit(code);
  }
  console.log(`✓ ${step.label}`);
}

console.log(
  `\n✓ build:check passed (${steps.length} stages).` +
    "\n  Native packaging is not included: run `bun run build` for APK/DMG artifacts.",
);
