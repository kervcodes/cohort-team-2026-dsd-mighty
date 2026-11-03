#!/usr/bin/env node
/**
 * Content coverage report — how much of each page's JSON copy is wired to a
 * data-content attribute. Self-contained (Node >= 20, no dependencies). Copy as-is.
 *
 * Usage: node scripts/content-report.mjs [--json] [--root <dir>]
 * Reads the same optional content-acceptance.config.json as lint-content.mjs.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const args = process.argv.slice(2);
const jsonOutput = args.includes("--json");
const rootIdx = args.indexOf("--root");
const root = rootIdx >= 0 ? args[rootIdx + 1] : process.cwd();

const cfgPath = join(root, "content-acceptance.config.json");
const cfg = existsSync(cfgPath) ? JSON.parse(readFileSync(cfgPath, "utf-8")) : {};
const appDir = join(root, cfg.appDir ?? (existsSync(join(root, "src/app")) ? "src/app" : "app"));
const contentDir = join(root, cfg.contentDir ?? "content");
const skipRoutes = new Set(cfg.skipRoutes ?? ["/admin", "/admin/callback"]);
const routeOverrides = cfg.routes ?? {};

// Non-text JSON fields that need no data-content (links, images, SEO).
const NON_TEXT = [/\.href$/, /\.src$/, /\.alt$/, /^metadata\./, /\.ctaHref$/, /\.img$/];

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

function extractFields(obj, prefix = "") {
  if (typeof obj === "string") {
    return [{ path: prefix, isText: !NON_TEXT.some((p) => p.test(prefix)) }];
  }
  if (Array.isArray(obj)) return obj.flatMap((v, i) => extractFields(v, `${prefix}[${i}]`));
  if (obj && typeof obj === "object") {
    return Object.entries(obj).flatMap(([k, v]) => extractFields(v, prefix ? `${prefix}.${k}` : k));
  }
  return [];
}

function keyFor(route) {
  if (routeOverrides[route]) return routeOverrides[route];
  return route === "/" ? "home" : route.slice(1).replace(/\//g, "-");
}

function attrsIn(file) {
  const src = readFileSync(file, "utf-8");
  return {
    static: [...src.matchAll(/data-content="([^"]+)"/g)].map((m) => m[1]),
    dynamic: [...src.matchAll(/data-content=\{/g)].length,
    skips: [...src.matchAll(/data-content-skip="([^"]+)"/g)].map((m) => m[1]),
  };
}

if (!existsSync(appDir)) {
  console.error(`App dir not found: ${appDir}`);
  process.exit(2);
}

// Components outside page files may carry data-content too; count their static attrs per page key.
const sharedAttrs = walk(appDir)
  .filter((f) => /\.(tsx|jsx)$/.test(f) && !/[\\/]page\.(tsx|jsx)$/.test(f))
  .flatMap((f) => attrsIn(f).static);

const pages = walk(appDir)
  .filter((f) => /[\\/]page\.(tsx|jsx)$/.test(f))
  .map((file) => {
    const segs = relative(appDir, file)
      .split(/[\\/]/)
      .slice(0, -1)
      .filter((s) => !/^\(.*\)$/.test(s));
    return { route: `/${segs.join("/")}`, file };
  })
  .filter((p) => !skipRoutes.has(p.route));

const reports = pages.map(({ route, file }) => {
  const key = keyFor(route);
  const jsonPath = join(contentDir, `${key}.json`);
  const hasJson = existsSync(jsonPath);
  const fields = hasJson ? extractFields(JSON.parse(readFileSync(jsonPath, "utf-8"))) : [];
  const text = fields.filter((f) => f.isText);

  const a = attrsIn(file);
  const wired = new Set(
    [...a.static, ...sharedAttrs]
      .filter((s) => s.startsWith(`${key}.`))
      .map((s) => s.split(".").slice(1).join(".")),
  );
  const matched = text.filter((f) => wired.has(f.path));
  const missing = text.filter((f) => !wired.has(f.path)).map((f) => f.path);

  return {
    route,
    contentKey: key,
    hasJson,
    textFields: text.length,
    totalFields: fields.length,
    dataContentAttrs: a.static.length + a.dynamic,
    dynamicAttrs: a.dynamic,
    matched: matched.length,
    skipReasons: a.skips,
    missing,
    coverage:
      text.length > 0 ? Math.round((matched.length / text.length) * 100) : hasJson ? 100 : 0,
  };
});

const totals = {
  pagesInSystem: reports.filter((r) => r.hasJson).length,
  totalPages: reports.length,
  totalTextFields: reports.reduce((s, r) => s + r.textFields, 0),
  coveredFields: reports.reduce((s, r) => s + r.matched, 0),
  skippedSections: reports.reduce((s, r) => s + r.skipReasons.length, 0),
};

if (jsonOutput) {
  console.log(JSON.stringify({ pages: reports, summary: totals }, null, 2));
} else {
  console.log("Content Coverage Report\n=======================\n");
  for (const r of reports) {
    console.log(`${r.hasJson ? "✓" : "✗"}  ${r.route}  →  ${r.contentKey}`);
    if (!r.hasJson) console.log("   JSON: MISSING");
    else {
      console.log(`   JSON: ${r.textFields} text fields / ${r.totalFields} total`);
      console.log(
        `   data-content attrs: ${r.dataContentAttrs}${r.dynamicAttrs ? ` (${r.dynamicAttrs} dynamic)` : ""}`,
      );
      console.log(`   Coverage: ${r.coverage}%  (${r.matched}/${r.textFields} matched statically)`);
      if (r.missing.length > 0) {
        console.log("   Missing data-content for:");
        for (const f of r.missing.slice(0, 10)) console.log(`     - ${f}`);
        if (r.missing.length > 10) console.log(`     ... and ${r.missing.length - 10} more`);
      }
    }
    if (r.skipReasons.length > 0) console.log(`   Skipped sections: ${r.skipReasons.join(", ")}`);
    console.log();
  }
  const pct =
    totals.totalTextFields > 0
      ? Math.round((totals.coveredFields / totals.totalTextFields) * 100)
      : 100;
  console.log("SUMMARY\n-------");
  console.log(`  Pages in content system: ${totals.pagesInSystem}/${totals.totalPages}`);
  console.log(
    `  Text fields with data-content: ${totals.coveredFields}/${totals.totalTextFields} (${pct}%)`,
  );
  console.log(`  Intentionally skipped sections: ${totals.skippedSections}\n`);
}
