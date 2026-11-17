import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen } from "@testing-library/react";
import { type BadgeTone, badgeTones, StatusBadge, statusTones } from "./status-badge";

// The colour tokens of one theme block in globals.css: `:root` (light) or
// `.dark`.
const css = readFileSync(join(__dirname, "../../globals.css"), "utf8");
function themeTokens(selector: ":root" | ".dark"): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  const block = css.slice(start, css.indexOf("}", start));
  return Object.fromEntries(
    [...block.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6});/gi)].map(([, name, hex]) => [name, hex]),
  );
}

// WCAG 2 relative luminance and contrast ratio.
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

// "bg-paid-bg text-paid" -> ["paid-bg", "paid"]
function tokenPair(tone: BadgeTone): [background: string, text: string] {
  const classes = badgeTones[tone].split(" ");
  const token = (prefix: string) => {
    const name = classes.find((c) => c.startsWith(prefix))?.slice(prefix.length);
    if (!name) throw new Error(`${tone} has no ${prefix}* class`);
    return name;
  };
  return [token("bg-"), token("text-")];
}

describe("Status-Badge", () => {
  it("renders the status text", () => {
    render(<StatusBadge status="paid" />);

    expect(screen.getByText("paid")).toBeInTheDocument();
  });

  it("writes underscores as spaces", () => {
    render(<StatusBadge status="pending_approval" />);

    expect(screen.getByText("pending approval")).toBeInTheDocument();
  });

  it.each(["queued", "running", "flagged"] as const)(
    "renders the %s payment run status",
    (status) => {
      render(<StatusBadge status={status} />);

      expect(screen.getByText(status)).toBeInTheDocument();
    },
  );

  it.each(Object.entries(statusTones))(
    "colours %s with its tone's theme tokens",
    (status, tone) => {
      render(<StatusBadge status={status as keyof typeof statusTones} />);

      const badge = screen.getByText(status.replaceAll("_", " "));
      for (const name of badgeTones[tone].split(" ")) {
        expect(badge).toHaveClass(name);
      }
    },
  );

  it("uses only theme colour tokens, never a fixed palette colour", () => {
    for (const classes of Object.values(badgeTones)) {
      expect(classes).not.toMatch(/-(gray|slate|red|green|blue|yellow|orange|amber)-\d+/);
    }
  });

  describe.each([
    ["light", ":root"],
    ["dark", ".dark"],
  ] as const)("in the %s theme", (_theme, selector) => {
    const tokens = themeTokens(selector);

    it.each(Object.keys(badgeTones) as BadgeTone[])(
      "the %s tone has AA contrast (4.5:1)",
      (tone) => {
        const [background, text] = tokenPair(tone);
        expect(tokens[background]).toBeDefined();
        expect(tokens[text]).toBeDefined();

        expect(contrast(tokens[text], tokens[background])).toBeGreaterThanOrEqual(4.5);
      },
    );
  });
});
