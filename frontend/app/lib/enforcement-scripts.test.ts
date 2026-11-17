/**
 * @jest-environment node
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// The design-system scripts are TypeScript run by plain Node (no bun needed).
const NODE_TS_FLAGS = [
  "--experimental-strip-types",
  "--disable-warning=ExperimentalWarning",
  "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",
];
const PROJECT = process.cwd();
const REAL_UI_DIR = "app/components/ui";

// Inside a git hook GIT_DIR / GIT_INDEX_FILE point at the real repo; strip them so child git calls use their own.
function cleanEnv(extra: Record<string, string> = {}) {
  const env = { ...process.env, ...extra };
  for (const key of Object.keys(env)) if (key.startsWith("GIT_")) delete env[key];
  return env;
}

function run(args: string[], env: Record<string, string>, cwd = PROJECT) {
  const result = spawnSync(process.execPath, args, { cwd, encoding: "utf8", env: cleanEnv(env) });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

const script = (name: string) => join(PROJECT, "scripts", name);
const tsScript = (name: string, args: string[] = []) => [...NODE_TS_FLAGS, script(name), ...args];

const tmpDirs: string[] = [];
function tmp(prefix: string) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}
afterAll(() => {
  for (const dir of tmpDirs) rmSync(dir, { recursive: true, force: true });
});

// A throwaway components/ui dir: one primitive plus a manifest holding the given rules.
function fakeUiDir(rules: string) {
  const root = tmp("ds-ui-");
  const ui = join(root, "ui");
  mkdirSync(ui);
  writeFileSync(join(ui, "button.tsx"), "export default function Button() { return null; }\n");
  writeFileSync(join(ui, "manifest.ts"), `export const DS_RULES = ${rules};\n`);
  return { root, ui };
}

describe("check-ds-coverage", () => {
  it("accepts the repo: every primitive has a manifest entry", () => {
    const { status, output } = run(tsScript("check-ds-coverage.ts"), {
      DS_ALIAS_ROOT: "app",
      DS_UI_DIR: REAL_UI_DIR,
    });
    expect(status).toBe(0);
    expect(output).toContain("OK");
  });

  it("rejects a primitive with no manifest entry", () => {
    const { root, ui } = fakeUiDir("[]");
    const { status, output } = run(tsScript("check-ds-coverage.ts"), {
      DS_ALIAS_ROOT: root,
      DS_UI_DIR: ui,
    });
    expect(status).toBe(1);
    expect(output).toContain("@/ui/button");
  });

  it("accepts a primitive once the manifest names it", () => {
    const { root, ui } = fakeUiDir('[{ importPath: "@/ui/button" }]');
    const { status } = run(tsScript("check-ds-coverage.ts"), {
      DS_ALIAS_ROOT: root,
      DS_UI_DIR: ui,
    });
    expect(status).toBe(0);
  });

  it("exits 2 when the ui dir has no manifest", () => {
    const { status } = run(tsScript("check-ds-coverage.ts"), { DS_UI_DIR: tmp("ds-empty-") });
    expect(status).toBe(2);
  });
});

describe("check-ds-page", () => {
  it("accepts the repo: /design-system documents every manifest component", () => {
    const { status } = run(tsScript("check-ds-page.ts"), { DS_UI_DIR: REAL_UI_DIR });
    expect(status).toBe(0);
  });

  it("rejects a manifest component the page does not show", () => {
    const { ui } = fakeUiDir('[{ name: "raw-zzz", component: "<ZzzMissingWidget>" }]');
    const { status, output } = run(tsScript("check-ds-page.ts"), { DS_UI_DIR: ui });
    expect(status).toBe(1);
    expect(output).toContain("ZzzMissingWidget");
  });
});

describe("check-design-system --all", () => {
  it("exits 0 when no rules are enabled", () => {
    const { ui } = fakeUiDir("[]");
    const { status } = run(tsScript("check-design-system.ts", ["--all"]), { DS_UI_DIR: ui });
    expect(status).toBe(0);
  });

  it("accepts the repo: no raw button outside components/ui", () => {
    const { status, output } = run(tsScript("check-design-system.ts", ["--all"]), {
      DS_ALIAS_ROOT: "app",
      DS_UI_DIR: REAL_UI_DIR,
    });
    expect({ status, output: status === 0 ? "" : output }).toEqual({ status: 0, output: "" });
  });
});

describe("check-no-emoji", () => {
  // The script reads `git diff --cached`, so run it inside a throwaway repo.
  function stagedRepo(source: string) {
    const repo = tmp("emoji-repo-");
    const git = (...args: string[]) =>
      spawnSync("git", args, { cwd: repo, encoding: "utf8", env: cleanEnv() });
    git("init", "-q");
    writeFileSync(join(repo, "a.ts"), source);
    git("add", "a.ts");
    return repo;
  }

  it("rejects an added line containing an emoji", () => {
    const repo = stagedRepo('export const label = "done \u{1F680}";\n');
    const { status, output } = run([script("check-no-emoji.mjs"), "a.ts"], {}, repo);
    expect(status).toBe(1);
    expect(output).toContain("raw emoji");
  });

  it("accepts plain text", () => {
    const repo = stagedRepo('export const label = "done";\n');
    const { status } = run([script("check-no-emoji.mjs"), "a.ts"], {}, repo);
    expect(status).toBe(0);
  });
});
