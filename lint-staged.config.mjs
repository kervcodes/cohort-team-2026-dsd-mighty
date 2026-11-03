import { spawnSync } from "node:child_process";

// Commands run from the repo root, which has no package.json, so each tool is pointed at its project.
const hasUv = spawnSync("uv", ["--version"], { stdio: "ignore" }).status === 0;

const backend = (files) => {
  if (!hasUv) {
    console.warn("pre-commit: uv not found, skipping Ruff for backend files (CI will still check them)");
    return [];
  }
  const list = files.map((f) => `"${f}"`).join(" ");
  return [
    `uv run --project backend ruff check --fix ${list}`,
    `uv run --project backend ruff format ${list}`,
  ];
};

export default {
  "frontend/**/*.{js,jsx,ts,tsx,mjs,cjs,json,jsonc,css}": (files) =>
    `sh -c 'cd frontend && ./node_modules/.bin/biome check --write --no-errors-on-unmatched "$@"' biome ${files.map((f) => `"${f}"`).join(" ")}`,
  "frontend/**/*.{ts,tsx}": (files) => {
    const list = files.map((f) => `"${f}"`).join(" ");
    return [
      `node frontend/scripts/check-no-emoji.mjs ${list}`,
      `sh -c 'cd frontend && bash scripts/tsc-staged.sh'`,
    ];
  },
  "frontend/**/*.{jsx,tsx}": (files) =>
    `sh -c 'cd frontend && DS_ALIAS_ROOT=app DS_UI_DIR=app/components/ui bun scripts/check-design-system.ts --staged-only "$@"' ds ${files.map((f) => `"${f.replace(/^.*?\/frontend\//, "")}"`).join(" ")}`,
  "frontend/app/components/ui/**": () =>
    `sh -c 'cd frontend && DS_ALIAS_ROOT=app DS_UI_DIR=app/components/ui bun scripts/check-ds-coverage.ts && DS_UI_DIR=app/components/ui bun scripts/check-ds-page.ts'`,
  "frontend/app/design-system/**": () =>
    `sh -c 'cd frontend && DS_UI_DIR=app/components/ui bun scripts/check-ds-page.ts'`,
  "backend/**/*.py": backend,
};
