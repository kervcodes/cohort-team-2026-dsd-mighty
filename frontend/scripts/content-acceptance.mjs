#!/usr/bin/env node
/**
 * Sidecar acceptance for static sites (no database). Self-contained (Node >= 20,
 * no dependencies). Copy as-is.
 *
 * Content lives in <contentDir>/<page>.json; acceptance records live in a
 * committed sidecar file <contentDir>/.accepted.json:
 *   { "page.section.field": { "hash": "<sha256-12>", "by": ["email"], "at": "<iso>" } }
 *
 * Usage:
 *   node scripts/content-acceptance.mjs status [--json]
 *   node scripts/content-acceptance.mjs accept <page.section.field> | --page <page> | --all
 *   node scripts/content-acceptance.mjs unaccept <page.section.field>
 *   node scripts/content-acceptance.mjs prune        # drop records for removed/changed fields
 *   node scripts/content-acceptance.mjs gate [--hard]
 *
 * gate: warns and exits 0 by default; exits 1 when --hard or CONTENT_ACCEPTANCE_GATE=hard.
 * Options: --root <dir>, --content-dir <dir> (default "content").
 *
 * Agents may never accept: `accept` refuses without an interactive terminal and
 * refuses when CI / CLAUDECODE / AGENT is set. Accepting is a human act.
 */
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const opt = (n, d) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : d);
const cmd = argv[0];
const root = opt("--root", process.cwd());
const contentDir = join(root, opt("--content-dir", "content"));
const sidecarPath = join(contentDir, ".accepted.json");

// Keys that are not copywriting (links, images, SEO). Extend per project.
const STRUCTURAL_KEYS = new Set([
  "type",
  "rows",
  "href",
  "src",
  "alt",
  "img",
  "metadata",
  "id",
  "importance",
  "importanceReason",
  "signals",
]);

const fieldHash = (v) => createHash("sha256").update(v).digest("hex").slice(0, 12);

function collect(value, prefix, out) {
  if (typeof value === "string") out[prefix] = value;
  else if (Array.isArray(value))
    value.forEach((v, i) => {
      collect(v, `${prefix}[${i}]`, out);
    });
  else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      if (!STRUCTURAL_KEYS.has(k)) collect(v, prefix ? `${prefix}.${k}` : k, out);
    }
  }
}

function currentFields() {
  const out = {};
  for (const f of readdirSync(contentDir)) {
    if (!f.endsWith(".json") || f.startsWith(".")) continue;
    collect(JSON.parse(readFileSync(join(contentDir, f), "utf-8")), f.replace(/\.json$/, ""), out);
  }
  return out;
}

const readSidecar = () =>
  existsSync(sidecarPath) ? JSON.parse(readFileSync(sidecarPath, "utf-8")) : {};
const writeSidecar = (d) => {
  const sorted = Object.fromEntries(Object.entries(d).sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(sidecarPath, `${JSON.stringify(sorted, null, 2)}\n`);
};

function unaccepted(fields, accepted) {
  return Object.keys(fields).filter((p) => accepted[p]?.hash !== fieldHash(fields[p]));
}

function assertHuman() {
  if (process.env.CI || process.env.CLAUDECODE || process.env.AGENT || !process.stdin.isTTY) {
    console.error(
      "Refusing to accept: acceptance is a human act (needs an interactive terminal, no CI/agent env).",
    );
    process.exit(3);
  }
  try {
    return execSync("git config user.email", { cwd: root }).toString().trim() || "unknown";
  } catch {
    return "unknown";
  }
}

function acceptPaths(paths, fields, accepted, email) {
  const at = new Date().toISOString();
  for (const p of paths) {
    const hash = fieldHash(fields[p]);
    const prev = accepted[p];
    accepted[p] = {
      hash,
      by: prev?.hash === hash ? [...new Set([...prev.by, email])] : [email],
      at,
    };
  }
}

if (!cmd || !existsSync(contentDir)) {
  console.error(
    `Usage: content-acceptance.mjs <status|accept|unaccept|prune|gate> (content dir: ${contentDir})`,
  );
  process.exit(2);
}

const fields = currentFields();
const accepted = readSidecar();
const pending = unaccepted(fields, accepted);

if (cmd === "status") {
  if (flag("--json")) {
    console.log(
      JSON.stringify(
        {
          total: Object.keys(fields).length,
          totalUnaccepted: pending.length,
          unaccepted_fields: pending,
        },
        null,
        2,
      ),
    );
  } else {
    console.log(`${pending.length} of ${Object.keys(fields).length} fields unaccepted`);
    for (const p of pending) console.log(`  - ${p}`);
  }
} else if (cmd === "accept") {
  const email = assertHuman();
  const target = argv[1];
  const paths = flag("--all")
    ? pending
    : flag("--page")
      ? pending.filter((p) => p.startsWith(`${opt("--page")}.`))
      : [target];
  const bad = paths.filter((p) => !(p in fields));
  if (bad.length || paths.length === 0 || paths[0] === undefined) {
    console.error(
      bad.length
        ? `Unknown field: ${bad.join(", ")}`
        : "Nothing to accept (give a path, --page <page>, or --all).",
    );
    process.exit(2);
  }
  acceptPaths(paths, fields, accepted, email);
  writeSidecar(accepted);
  console.log(`Accepted ${paths.length} field(s) as ${email}.`);
} else if (cmd === "unaccept") {
  const p = argv[1];
  if (!p || !(p in accepted)) {
    console.log("Not accepted; nothing to do.");
  } else {
    delete accepted[p];
    writeSidecar(accepted);
    console.log(`Unaccepted ${p}.`);
  }
} else if (cmd === "prune") {
  let n = 0;
  for (const p of Object.keys(accepted)) {
    if (!(p in fields) || accepted[p].hash !== fieldHash(fields[p])) {
      delete accepted[p];
      n++;
    }
  }
  writeSidecar(accepted);
  console.log(`Pruned ${n} stale record(s).`);
} else if (cmd === "gate") {
  const hard = flag("--hard") || process.env.CONTENT_ACCEPTANCE_GATE === "hard";
  if (pending.length === 0) {
    console.log("✓ All content accepted.");
  } else {
    console.log(`${hard ? "✗" : "⚠"} ${pending.length} unaccepted field(s):`);
    for (const p of pending) console.log(`  - ${p}`);
    if (hard) process.exit(1);
  }
} else {
  console.error(`Unknown command: ${cmd}`);
  process.exit(2);
}
