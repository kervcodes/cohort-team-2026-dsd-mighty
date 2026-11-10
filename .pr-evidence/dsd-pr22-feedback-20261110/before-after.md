# PR 22 review feedback: before -> after

```mermaid
flowchart LR
  subgraph Before
    A1[git commit / git push] --> B1{bun on PATH?}
    B1 -- no --> C1[pre-push hard-fails<br/>pre-commit lint-staged fails]
    B1 -- yes --> D1[bun scripts/check-*.ts]
    T1[Checker scripts: 1 test, bun-only]
  end
  subgraph After
    A2[git commit / git push] --> D2[node --experimental-strip-types<br/>scripts/check-*.ts]
    D2 --> E2[Node 22 only; CI no longer installs bun]
    T2[enforcement-scripts.test.ts:<br/>accept + reject for all 4 checkers]
  end
```

| Review item | Change |
|---|---|
| 1. bun hard-fail | Checkers run on Node 22 (type stripping); bun dropped from package.json, lint-staged, pre-push, CI, CLAUDE.md. pre-push now only warns+skips if pnpm is missing. |
| 2. Checker tests | New `frontend/app/lib/enforcement-scripts.test.ts` (accept/reject for coverage, page, sweep, emoji); existing sweep test moved off bun and gains a ds-ignore case. |
| Merge | origin/main merged in; 4 conflicts resolved; 9 raw `<button>` added on main converted to `<Button>`; stale `@/components/Button` imports repointed to `ui/button`. |
