#!/usr/bin/env node
/**
 * No-literal-text linter — component files may contain NO literal user-visible text.
 * Every string is a variable imported from a JSON content file.
 * Needs Node >= 20 and `typescript` (resolved from --root, the cwd or this script). Copy as-is.
 *
 * Usage: node scripts/lint-literals.mjs [--root <dir>] [--no-list] [files...]
 *   files     check only these files (lint-staged passes staged files); default: scan the source dir
 *   --no-list do not print the escape-hatch listing
 *   Exit 1 on any violation; 2 on a usage or setup problem.
 *
 * Flagged, in .tsx/.jsx files:
 *   - JSX text containing a letter:            <h1>Welcome</h1>
 *   - string literals as JSX children:         {"Welcome"}, {ok ? "Yes" : "No"}, {`Hi`}
 *   - strings in user-visible attributes:      placeholder, title, alt, aria-label, label, ...
 * Not flagged: numbers, punctuation, symbols (→ • ×), entities (&nbsp;), className and other
 * non-copy props, and anything inside a content directory, test, spec or stories file.
 *
 * Escape hatches (rare — every one needs a reason and is listed in the output):
 *   - same line, or the line above:   // content-ok: reason     {/* content-ok: reason *\/}
 *   - whole subtree:                  <div data-content-skip="reason"> ... </div>
 *
 * Config (optional): content-acceptance.config.json at --root:
 *   { "sourceDir": "src", "contentDir": "src/content" }   // defaults: src (or app), src/content
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const argv = process.argv.slice(2);
const rootIdx = argv.indexOf("--root");
const root = resolve(rootIdx >= 0 ? argv[rootIdx + 1] : process.cwd());
const files = argv.filter((a, i) => !a.startsWith("--") && !(rootIdx >= 0 && i === rootIdx + 1));
const listEscapes = !argv.includes("--no-list");

const cfgPath = join(root, "content-acceptance.config.json");
const cfg = existsSync(cfgPath) ? JSON.parse(readFileSync(cfgPath, "utf-8")) : {};
const sourceDir = join(root, cfg.sourceDir ?? (existsSync(join(root, "src")) ? "src" : "app"));
const contentDirs = [cfg.contentDir ?? "src/content", "content"].map((d) => join(root, d) + sep);

/** Props whose string value a visitor reads or hears. */
const COPY_ATTRS = new Set([
  "placeholder",
  "title",
  "alt",
  "label",
  "aria-label",
  "aria-description",
  "aria-placeholder",
  "aria-roledescription",
]);
const SKIP_ATTR = "data-content-skip";
const IGNORED_FILE = /\.(test|spec|stories)\.[jt]sx?$|[\\/]__tests__[\\/]/;
const IGNORED_DIR = new Set(["node_modules", ".next", "dist", "build", "coverage", ".git"]);

function loadTypescript() {
  const here = fileURLToPath(import.meta.url);
  for (const base of [join(root, "package.json"), join(process.cwd(), "package.json"), here]) {
    try {
      return createRequire(base)("typescript");
    } catch {}
  }
  console.error(
    "lint-literals: cannot find the `typescript` package (install it as a devDependency).",
  );
  process.exit(2);
}
const ts = loadTypescript();

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    if (IGNORED_DIR.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

const hasLetter = (s) => /\p{L}/u.test(s.replace(/&(?:#\d+|#x[\da-f]+|\w+);/gi, ""));

/** Letter-bearing string literals reachable through ternaries, &&, ||, ??, parens and casts. */
function literalsIn(node, out = []) {
  if (ts.isStringLiteralLike(node)) {
    if (hasLetter(node.text)) out.push(node);
  } else if (ts.isTemplateExpression(node)) {
    const parts = [node.head.text, ...node.templateSpans.map((s) => s.literal.text)];
    if (parts.some(hasLetter)) out.push(node);
  } else if (ts.isConditionalExpression(node)) {
    literalsIn(node.whenTrue, out);
    literalsIn(node.whenFalse, out);
  } else if (ts.isBinaryExpression(node)) {
    literalsIn(node.right, out);
    if (!(node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken))
      literalsIn(node.left, out);
  } else if (
    ts.isParenthesizedExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isSatisfiesExpression(node) ||
    ts.isNonNullExpression(node)
  ) {
    literalsIn(node.expression, out);
  }
  return out;
}

function scan(file) {
  const text = readFileSync(file, "utf-8");
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const lines = text.split("\n");
  const violations = [];
  const escapes = [];
  const lineOf = (pos) => sf.getLineAndCharacterOfPosition(pos).line;

  /** Look for `content-ok` on the node's first line or the line above. */
  function escapeFor(pos) {
    const l = lineOf(pos);
    for (const i of [l, l - 1]) {
      if (i !== l && !/^\s*(?:\{\s*)?(?:\/\/|\/\*)/.test(lines[i] ?? "")) continue;
      const m = lines[i]?.match(/content-ok(?::[ \t]*(\S[^*]*?))?[ \t]*(?:\*\/|$)/);
      if (m) return { line: i + 1, reason: m[1]?.trim() };
    }
    return null;
  }

  function report(node, what, shown) {
    const start = node.getStart(sf);
    const line = lineOf(start) + 1;
    const esc = escapeFor(start);
    if (esc?.reason) {
      escapes.push({ file, line: esc.line, kind: "content-ok", reason: esc.reason });
    } else if (esc) {
      violations.push({
        file,
        line: esc.line,
        what: "content-ok needs a reason",
        shown: "// content-ok: <why>",
      });
    } else {
      violations.push({ file, line, what, shown: shown.replace(/\s+/g, " ").trim().slice(0, 60) });
    }
  }

  function visit(node) {
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
      const attrs = (ts.isJsxElement(node) ? node.openingElement : node).attributes.properties;
      const skip = attrs.find((a) => ts.isJsxAttribute(a) && a.name.getText(sf) === SKIP_ATTR);
      if (skip) {
        const v = skip.initializer;
        const reason = v && ts.isStringLiteral(v) ? v.text.trim() : "";
        if (reason) {
          escapes.push({ file, line: lineOf(skip.getStart(sf)) + 1, kind: SKIP_ATTR, reason });
          return;
        }
        violations.push({
          file,
          line: lineOf(skip.getStart(sf)) + 1,
          what: `${SKIP_ATTR} needs a reason`,
          shown: `${SKIP_ATTR}="<why>"`,
        });
      }
    }
    if (ts.isJsxText(node)) {
      if (hasLetter(node.text)) report(node, "literal JSX text", node.text);
    } else if (ts.isJsxExpression(node) && node.expression && !ts.isJsxAttribute(node.parent)) {
      for (const lit of literalsIn(node.expression)) {
        report(lit, "string literal rendered as JSX child", lit.getText(sf));
      }
    } else if (
      ts.isJsxAttribute(node) &&
      COPY_ATTRS.has(node.name.getText(sf)) &&
      node.initializer
    ) {
      const init = node.initializer;
      const lits =
        ts.isJsxExpression(init) && init.expression
          ? literalsIn(init.expression)
          : literalsIn(init);
      for (const lit of lits) {
        report(lit, `literal text in \`${node.name.getText(sf)}\``, lit.getText(sf));
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);
  return { violations, escapes };
}

const candidates = files.length
  ? files.map((f) => resolve(root, f))
  : existsSync(sourceDir)
    ? walk(sourceDir)
    : null;
if (!candidates) {
  console.error(`lint-literals: source dir not found: ${sourceDir}`);
  process.exit(2);
}

const targets = candidates.filter(
  (f) =>
    /\.[jt]sx$/.test(f) &&
    existsSync(f) &&
    !IGNORED_FILE.test(f) &&
    !contentDirs.some((d) => f.startsWith(d)),
);

const violations = [];
const escapes = [];
for (const f of targets) {
  const r = scan(f);
  violations.push(...r.violations);
  escapes.push(...r.escapes);
}

const rel = (f) => relative(root, f);
if (violations.length) {
  console.log("Literal text in components — move it to a JSON content file:\n");
  for (const v of violations) console.log(`  ${rel(v.file)}:${v.line}  ${v.what}: ${v.shown}`);
  console.log(`\n${violations.length} violation(s).`);
} else {
  console.log(`✓ No literal text in ${targets.length} component file(s).`);
}
if (listEscapes && escapes.length) {
  console.log(`\nEscape hatches in use (${escapes.length}):`);
  for (const e of escapes) console.log(`  ${rel(e.file)}:${e.line}  ${e.kind}: ${e.reason}`);
}
process.exit(violations.length ? 1 : 0);
