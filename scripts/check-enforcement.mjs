#!/usr/bin/env node
/**
 * Rule -> enforcer table check — keeps ENFORCEMENT.md honest.
 *
 * Every binding rule in the table names the mechanism that enforces it. A rule whose only
 * enforcer is "convention", "review" or "audit" (an agent or human re-reading a checklist)
 * is a defect: it is allowed only as a dated, reasoned exception, and the exception expires.
 * Needs Node >= 20, no dependencies.
 *
 * Usage: node scripts/check-enforcement.mjs [--root <dir>] [--file <path>] [--table-only] [--today YYYY-MM-DD]
 *   --root        project root (default: cwd)
 *   --file        the table, relative to --root (default: ENFORCEMENT.md)
 *   --table-only  skip the agent-instruction-file check (for repos that keep no CLAUDE.md/AGENTS.md)
 *   --today       override the date used for expiry (tests)
 *   Exit 1 on any violation; 2 on a usage problem.
 *
 * Table format (header row required, exact column names):
 *   | Rule | Kind | Enforcer | Exception |
 *   | No raw HTML tags outside components/ui | hook | `scripts/check-design-system.ts` | - |
 *   | Prefer small PRs | review | - | 2027-01-31 no mechanical check exists yet |
 *
 * Kinds:
 *   structure, lint, hook, ci, test   mechanical — the Enforcer cell must name at least one
 *                                     backticked file path or `pnpm run <script>` that exists
 *   convention, review, audit         defect — the Exception cell must start with an expiry
 *                                     date (YYYY-MM-DD) and a reason; once the date passes the
 *                                     row fails. Each defect is listed so it stays visible.
 *
 * Also checks (unless --table-only) that CLAUDE.md or AGENTS.md exists at the root and points at
 * the table, so an agent that reads the instruction file finds the enforcers.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const argv = process.argv.slice(2);

function option(name, fallback) {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : fallback;
}

const root = resolve(option("--root", process.cwd()));
const file = option("--file", "ENFORCEMENT.md");
const tableOnly = argv.includes("--table-only");
const today = option("--today", new Date().toISOString().slice(0, 10));

const MECHANICAL = new Set(["structure", "lint", "hook", "ci", "test"]);
const DEFECT = new Set(["convention", "review", "audit"]);
const COLUMNS = ["rule", "kind", "enforcer", "exception"];

const errors = [];
const defects = [];

const tablePath = join(root, file);
if (!existsSync(tablePath)) {
  console.error(`${file}: not found — every project keeps a rule -> enforcer table`);
  process.exit(1);
}

function cells(line) {
  return line
    .trim()
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((c) => c.trim());
}

const lines = readFileSync(tablePath, "utf-8").split("\n");
const isHeader = (l) => {
  if (!l.trim().startsWith("|")) return false;
  const names = cells(l).map((c) => c.toLowerCase());
  return COLUMNS.every((c, i) => names[i] === c);
};

// every table under the header counts, so the file can group rules under headings
const rowAt = [];
lines.forEach((l, i) => {
  if (!isHeader(l)) return;
  for (let j = i + 2; j < lines.length && lines[j].trim().startsWith("|"); j++) rowAt.push(j);
});
if (rowAt.length === 0) {
  console.error(`${file}: no table with the header | Rule | Kind | Enforcer | Exception |`);
  process.exit(1);
}

const packageJson = existsSync(join(root, "package.json"))
  ? JSON.parse(readFileSync(join(root, "package.json"), "utf-8"))
  : null;

/** What an enforcer reference points at: a package.json script, a file path, or neither. */
function classify(ref) {
  const script = ref.match(/^pnpm (?:run )?([\w:.-]+)/);
  if (script) return { script: script[1] };
  const looksLikePath =
    !ref.includes(" ") && !ref.startsWith("@") && (ref.includes("/") || /\.\w{1,5}$/.test(ref));
  return looksLikePath ? { path: ref.split("#")[0] } : null;
}

/** Why `target` does not resolve, or null when it does. */
function unresolved({ script, path }) {
  if (script) {
    if (!packageJson) return null;
    return packageJson.scripts?.[script] ? null : `no "${script}" script in package.json`;
  }
  // a glob must at least have its directory: "scripts/check-*.mjs" -> "scripts"
  const target = path.includes("*") ? dirname(`${path.slice(0, path.indexOf("*"))}x`) : path;
  return existsSync(join(root, target)) ? null : `${path} does not exist`;
}

for (const i of rowAt) {
  const [rule, kindCell, enforcer = "", exception = ""] = cells(lines[i]);
  const where = `${file}:${i + 1}`;
  const kind = (kindCell ?? "").toLowerCase();

  if (!rule) errors.push(`${where}: empty rule`);

  if (MECHANICAL.has(kind)) {
    const refs = [...enforcer.matchAll(/`([^`]+)`/g)].map((m) => ({
      ref: m[1],
      target: classify(m[1]),
    }));
    const checkable = refs.filter((r) => r.target);
    if (checkable.length === 0) {
      errors.push(
        `${where}: "${rule}" — ${kind} rows must name a file path or \`pnpm run <script>\` as the enforcer`,
      );
    }
    for (const { ref, target } of checkable) {
      const reason = unresolved(target);
      if (reason) errors.push(`${where}: "${rule}" — enforcer \`${ref}\`: ${reason}`);
    }
  } else if (DEFECT.has(kind)) {
    const m = exception.match(/^(\d{4}-\d{2}-\d{2})\s+\S/);
    if (!m) {
      errors.push(
        `${where}: "${rule}" — a ${kind}-only rule is a defect; Exception must be "YYYY-MM-DD reason", or give the rule a mechanical enforcer`,
      );
    } else if (m[1] < today) {
      errors.push(
        `${where}: "${rule}" — exception expired ${m[1]}; add a mechanical enforcer or renew it with a reason`,
      );
    } else {
      defects.push(`${where}: "${rule}" — ${kind} only, until ${m[1]}`);
    }
  } else {
    errors.push(
      `${where}: "${rule}" — unknown kind "${kindCell}" (use ${[...MECHANICAL, ...DEFECT].join(", ")})`,
    );
  }
}

if (!tableOnly) {
  const instruction = ["CLAUDE.md", "AGENTS.md"].find((f) => existsSync(join(root, f)));
  if (!instruction) {
    errors.push(
      "CLAUDE.md or AGENTS.md: not found — agents need an instruction file at the project root",
    );
  } else if (!readFileSync(join(root, instruction), "utf-8").includes(file)) {
    errors.push(`${instruction}: does not reference ${file} — agents will not find the enforcers`);
  }
}

for (const d of defects) console.log(`defect: ${d}`);
if (errors.length > 0) {
  for (const e of errors) console.error(e);
  console.error(
    `\nEnforcement check failed: ${errors.length} problem(s). Fix the enforcer, not the table.`,
  );
  process.exit(1);
}
console.log(`${file}: ${rowAt.length} rule(s), ${defects.length} defect(s)`);
