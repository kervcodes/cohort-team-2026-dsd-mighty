#!/usr/bin/env node
/**
 * Content model linter — warns about pages and text not in the content system.
 * Self-contained (Node >= 20, no dependencies). Copy as-is.
 *
 * Usage: node scripts/lint-content.mjs [--strict] [--root <dir>]
 *   --strict  exit 1 if any warnings are found
 *
 * Config (optional): content-acceptance.config.json at --root:
 *   {
 *     "appDir": "src/app",            // where page.tsx files live (auto: src/app, app)
 *     "contentDir": "content",        // one <key>.json per page
 *     "skipRoutes": ["/admin"],       // infrastructure routes, never linted
 *     "routes": { "/pricing": "plans" } // route -> content key overrides
 *   }
 * Default key: "/" -> "home", "/a/b" -> "a-b". Route groups "(x)" are ignored.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const args = process.argv.slice(2);
const strict = args.includes("--strict");
const rootIdx = args.indexOf("--root");
const root = rootIdx >= 0 ? args[rootIdx + 1] : process.cwd();

const cfgPath = join(root, "content-acceptance.config.json");
const cfg = existsSync(cfgPath) ? JSON.parse(readFileSync(cfgPath, "utf-8")) : {};
const appDir = join(root, cfg.appDir ?? (existsSync(join(root, "src/app")) ? "src/app" : "app"));
const contentDir = join(root, cfg.contentDir ?? "content");
const skipRoutes = new Set(cfg.skipRoutes ?? ["/admin", "/admin/callback"]);
const routeOverrides = cfg.routes ?? {};

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

function discoverPages() {
  return walk(appDir)
    .filter((f) => /[\\/]page\.(tsx|jsx)$/.test(f))
    .map((file) => {
      const segs = relative(appDir, file)
        .split(/[\\/]/)
        .slice(0, -1)
        .filter((s) => !/^\(.*\)$/.test(s));
      return { route: `/${segs.join("/")}`, file };
    });
}

function keyFor(route) {
  if (routeOverrides[route]) return routeOverrides[route];
  return route === "/" ? "home" : route.slice(1).replace(/\//g, "-");
}

/** JSX text between > and <, outside data-content / data-content-skip regions. */
function scanBareText(file) {
  const lines = readFileSync(file, "utf-8").split("\n");
  const found = [];
  let inMetadata = false;
  let skipDepth = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/export\s+const\s+metadata/.test(line)) inMetadata = true;
    if (inMetadata) {
      if (line.includes("}")) inMetadata = false;
      continue;
    }
    if (line.includes("data-content-skip")) skipDepth++;
    if (skipDepth > 0) continue;
    if (line.includes("data-content=")) continue;
    for (const m of line.matchAll(/>([^<>{]+)</g)) {
      const text = m[1].trim();
      if (text.length <= 2) continue;
      if (/^[→←↑↓▾▸•·×&\\]/.test(text)) continue;
      if (/^&\w+;$/.test(text)) continue;
      found.push({ line: i + 1, text: text.slice(0, 60) });
    }
  }
  return found;
}

let warnings = 0;
console.log("Content Lint\n============\n");

if (!existsSync(appDir)) {
  console.error(`App dir not found: ${appDir}`);
  process.exit(2);
}

for (const { route, file } of discoverPages()) {
  if (skipRoutes.has(route)) continue;
  const key = keyFor(route);
  const rel = relative(root, file);

  if (!existsSync(join(contentDir, `${key}.json`))) {
    console.log(
      `⚠  ${route} → content key "${key}"\n   Missing ${relative(root, contentDir)}/${key}.json\n`,
    );
    warnings++;
  }

  const bare = scanBareText(file);
  if (bare.length > 0) {
    console.log(
      `⚠  ${route} (${rel})\n   ${bare.length} bare text string(s) not in content system:`,
    );
    for (const b of bare) console.log(`     line ${b.line}: "${b.text}"`);
    console.log();
    warnings++;
  }
}

console.log(
  warnings === 0 ? "✓  All pages follow the content model.\n" : `${warnings} warning(s) found.\n`,
);
if (strict && warnings > 0) process.exit(1);
