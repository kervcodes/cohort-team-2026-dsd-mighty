#!/usr/bin/env bun
/**
 * check-ds-coverage.ts — verify every primitive in components/ui/ has a
 * matching entry in components/ui/manifest.ts.
 *
 * The design-system enforcement set:
 *   - check-design-system.ts  enforces per-file (lint-staged, pre-push, CI, Claude hook)
 *   - check-ds-coverage.ts    proves the manifest itself stays complete
 *   - check-ds-page.ts        proves /design-system documents every manifest entry
 *
 * Scope: top-level `.tsx` files in the UI dir. Subdirectories (domain helpers),
 * test files and `index.tsx` are excluded. A primitive with nothing to ban
 * still needs an entry — register it as a custom rule with `patterns: []`.
 *
 * Exit codes:
 *   0  every primitive is covered
 *   1  one or more primitives have no manifest entry
 *   2  setup problem
 */

import { existsSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

interface DsRule {
  importPath: string;
}

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const UI_DIR_CANDIDATES = ["src/components/ui", "components/ui"];

function findUiDir(): string | null {
  const candidates = process.env.DS_UI_DIR ? [process.env.DS_UI_DIR] : UI_DIR_CANDIDATES;
  for (const candidate of candidates) {
    const abs = resolve(ROOT, candidate);
    if (existsSync(join(abs, "manifest.ts"))) return abs;
  }
  return null;
}

const uiDir = findUiDir();
if (!uiDir) {
  process.stderr.write(
    "check-ds-coverage: cannot find components/ui/manifest.ts (looked in src/components/ui and components/ui; set DS_UI_DIR to override).\n",
  );
  process.exit(2);
}

// `@/` resolves to src/ in a src layout, otherwise to the repo root.
const srcDir = join(ROOT, "src");
const aliasRoot = process.env.DS_ALIAS_ROOT
  ? resolve(ROOT, process.env.DS_ALIAS_ROOT)
  : uiDir.startsWith(srcDir + sep)
    ? srcDir
    : ROOT;

const { DS_RULES } = (await import(pathToFileURL(join(uiDir, "manifest.ts")).href)) as {
  DS_RULES: DsRule[];
};

function collectPrimitives(dir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (!entry.endsWith(".tsx") || entry === "index.tsx") continue;
    if (/\.(test|spec|stories)\.tsx$/.test(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isFile()) results.push(full);
  }
  return results.sort();
}

function importPathFor(absFile: string): string {
  const rel = relative(aliasRoot, absFile).split(sep).join("/");
  return `@/${rel.replace(/\.tsx$/, "")}`;
}

const primitives = collectPrimitives(uiDir);
const covered = new Set(DS_RULES.map((r) => r.importPath));
const uncovered = primitives.filter((file) => !covered.has(importPathFor(file)));

if (uncovered.length === 0) {
  process.stdout.write(
    `check-ds-coverage: OK — ${primitives.length} primitives, ${DS_RULES.length} manifest entries.\n`,
  );
  process.exit(0);
}

process.stderr.write(
  `check-ds-coverage: ${uncovered.length} primitive(s) in ${relative(ROOT, uiDir)}/ have no manifest entry.\n\n`,
);
for (const file of uncovered) {
  process.stderr.write(
    `  ${relative(ROOT, file)}\n      expected importPath: '${importPathFor(file)}'\n\n`,
  );
}
process.stderr.write(
  "Enable a preset in manifest.config.ts (ENABLED_RULES) or add a custom rule (CUSTOM_RULES; use `patterns: []` if there is nothing to ban) so the enforcement scripts and the /design-system page learn about this primitive.\n",
);
process.exit(1);
