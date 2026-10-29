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
  "backend/**/*.py": backend,
};
