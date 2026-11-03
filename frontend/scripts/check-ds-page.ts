#!/usr/bin/env bun
/**
 * check-ds-page.ts — every component in the manifest must appear on the
 * /design-system catalogue page, so the page cannot drift from the manifest.
 *
 * A component "appears" when its name (every capitalized identifier in a rule's
 * `component` field, e.g. `<Box> or <Stack>` -> Box, Stack) occurs in the source
 * of `app/design-system/page.tsx` or any file beside it.
 *
 * The page must also contain the eight required sections, each marked with an id:
 *   ds-principles, ds-foundations, ds-tokens, ds-components,
 *   ds-patterns, ds-content, ds-accessibility, ds-governance
 *
 * Exit codes:
 *   0  page exists, has every required section and documents every manifest component
 *   1  page is missing, sections are missing, or components are missing from it
 *   2  setup problem
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

interface DsRule {
  name: string;
  component: string;
}

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const UI_DIR_CANDIDATES = ["src/components/ui", "components/ui"];
const PAGE_DIR_CANDIDATES = ["src/app/design-system", "app/design-system"];
const REQUIRED_SECTIONS = [
  "ds-principles",
  "ds-foundations",
  "ds-tokens",
  "ds-components",
  "ds-patterns",
  "ds-content",
  "ds-accessibility",
  "ds-governance",
];

function firstExisting(candidates: string[], marker: string): string | null {
  for (const candidate of candidates) {
    const abs = resolve(ROOT, candidate);
    if (existsSync(join(abs, marker))) return abs;
  }
  return null;
}

function readTree(dir: string): string {
  let combined = "";
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) combined += readTree(full);
    else if (/\.(tsx|ts|mdx)$/.test(entry)) combined += `\n${readFileSync(full, "utf8")}`;
  }
  return combined;
}

const uiDir = firstExisting(
  process.env.DS_UI_DIR ? [process.env.DS_UI_DIR] : UI_DIR_CANDIDATES,
  "manifest.ts",
);
if (!uiDir) {
  process.stderr.write(
    "check-ds-page: cannot find components/ui/manifest.ts (looked in src/components/ui and components/ui; set DS_UI_DIR to override).\n",
  );
  process.exit(2);
}

const pageDir = firstExisting(PAGE_DIR_CANDIDATES, "page.tsx");
if (!pageDir) {
  process.stderr.write(
    "check-ds-page: the /design-system catalogue page is required but app/design-system/page.tsx was not found.\n",
  );
  process.exit(1);
}

const { DS_RULES } = (await import(pathToFileURL(join(uiDir, "manifest.ts")).href)) as {
  DS_RULES: DsRule[];
};
const pageSource = readTree(pageDir);

const missing = new Map<string, string[]>();
for (const rule of DS_RULES) {
  for (const name of rule.component.match(/\b[A-Z][A-Za-z0-9]*\b/g) ?? []) {
    if (new RegExp(`\\b${name}\\b`).test(pageSource)) continue;
    missing.set(name, [...(missing.get(name) ?? []), rule.name]);
  }
}

const missingSections = REQUIRED_SECTIONS.filter(
  (id) => !new RegExp(`\\bid=(?:"${id}"|'${id}'|\\{["']${id}["']\\})`).test(pageSource),
);

if (missing.size === 0 && missingSections.length === 0) process.exit(0);

if (missingSections.length > 0) {
  process.stderr.write(
    `check-ds-page: ${missingSections.length} required section(s) missing from ${relative(ROOT, pageDir)}/\n\n`,
  );
  for (const id of missingSections) process.stderr.write(`  id="${id}"\n`);
  process.stderr.write(
    "\nThe page needs: Principles, Foundations, Tokens, Components, Patterns, Content guidelines, Accessibility, Governance — each as an element with the id above.\n\n",
  );
}
if (missing.size > 0) {
  process.stderr.write(
    `check-ds-page: ${missing.size} manifest component(s) missing from ${relative(ROOT, pageDir)}/\n\n`,
  );
  for (const [name, ruleNames] of missing) {
    process.stderr.write(`  ${name}  (rule: ${ruleNames.join(", ")})\n`);
  }
  process.stderr.write(
    "\nAdd a live example of each component to the /design-system page, so developers can find what to reach for.\n",
  );
}
process.exit(1);
