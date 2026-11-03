/**
 * @jest-environment node
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const PROJECT = process.cwd();
const FIXTURE_DIR = join(PROJECT, "app", "__ds_fixture__");
const FIXTURE = join(FIXTURE_DIR, "fixture.tsx");

function check(source: string) {
  mkdirSync(FIXTURE_DIR, { recursive: true });
  writeFileSync(FIXTURE, source);
  const result = spawnSync("bun", ["scripts/check-design-system.ts", FIXTURE], {
    cwd: PROJECT,
    encoding: "utf8",
    env: { ...process.env, DS_UI_DIR: "app/components/ui" },
  });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

afterAll(() => rmSync(FIXTURE_DIR, { recursive: true, force: true }));

describe("design-system enforcement", () => {
  it("rejects a raw button outside components/ui", () => {
    const { status, output } = check('export const X = () => <button type="button">x</button>;\n');
    expect(status).toBe(1);
    expect(output).toContain("raw-button");
  });

  it("accepts the design-system Button", () => {
    const { status } = check(
      "import Button from '@/components/ui/button';\nexport const X = () => <Button label=\"x\" />;\n",
    );
    expect(status).toBe(0);
  });
});
