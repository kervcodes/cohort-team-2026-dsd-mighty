/* ds-ignore-file */
/**
 * Design-system manifest — the single source of truth for which raw HTML
 * elements are banned outside `components/ui/` and which design-system
 * component replaces each one.
 *
 * Consumed by:
 *   - scripts/check-design-system.ts  (per-file enforcement + Claude Code hook)
 *   - scripts/check-ds-coverage.ts    (every primitive in components/ui has an entry)
 *   - scripts/check-ds-page.ts        (every entry appears on /design-system)
 *   - the /design-system catalogue page (renders the rules table)
 *
 * This file is generic and identical in every project. Project decisions live
 * in `./manifest.config.ts`: which presets are enabled, per-preset overrides,
 * and project-specific custom rules.
 */
import { CUSTOM_RULES, ENABLED_RULES, PRESET_OVERRIDES } from "./manifest.config";

export interface DsRulePattern {
  /** Matched against a line of JSX source, e.g. /<button\b/ */
  jsx?: RegExp;
  /** Matched against a line, intended for className strings */
  className?: RegExp;
  /** Both must match the same line: an element and a styling signal */
  jsxStyle?: { element: RegExp; styling: RegExp };
}

export type DsRuleCategory = "interactive" | "layout" | "typography" | "display" | "navigation";

export interface DsRule {
  /** Rule id, e.g. "raw-button" */
  name: string;
  /** Display name of the replacement, e.g. "<Button>". Names here must appear on /design-system. */
  component: string;
  /** Alias import path of the replacement, e.g. "@/components/ui/button" */
  importPath: string;
  category: DsRuleCategory;
  /** Overrides the default "use <component> from <importPath>" message */
  hint?: string;
  /** When true, `// ds-ignore` and `/* ds-ignore-file *\/` do not silence this rule */
  noEscapeHatch?: boolean;
  /** Empty patterns register a component for coverage without enforcing anything */
  patterns: DsRulePattern[];
  /** One sentence for the catalogue page: what the component is for */
  description: string;
  /** Human-readable form of the banned markup, shown on the catalogue page */
  rawPattern: string;
}

type DsPresetDef = Omit<DsRule, "name">;

const PRESET_DEFS = {
  "raw-input": {
    component: "<Input>",
    importPath: "@/components/ui/input",
    category: "interactive",
    patterns: [{ jsx: /<input\b/ }],
    rawPattern: "<input …>",
    description: "Labeled input with error state and themed focus ring",
  },
  "raw-textarea": {
    component: "<Textarea>",
    importPath: "@/components/ui/textarea",
    category: "interactive",
    patterns: [{ jsx: /<textarea\b/ }],
    rawPattern: "<textarea …>",
    description: "Labeled textarea with error state and themed focus ring",
  },
  "raw-select": {
    component: "<Select>",
    importPath: "@/components/ui/select",
    category: "interactive",
    patterns: [{ jsx: /<select\b/ }],
    rawPattern: "<select …>",
    description: "Themed select with label, error state and consistent focus ring",
  },
  "raw-button": {
    component: "<Button>",
    importPath: "@/components/ui/button",
    category: "interactive",
    patterns: [{ jsx: /<button\b/ }],
    rawPattern: "<button …>",
    description: "Themed button with variant and size props",
  },
  "raw-label": {
    component: "<Label>",
    importPath: "@/components/ui/label",
    category: "typography",
    patterns: [{ jsx: /<label\b/ }],
    rawPattern: "<label …>",
    description: "Form label styled to the type scale",
  },
  "raw-heading": {
    component: "<Heading>",
    importPath: "@/components/ui/heading",
    category: "typography",
    patterns: [{ jsx: /<h[1-6]\b/ }],
    rawPattern: "<h1> … <h6>",
    description: "Semantic heading — the visual size follows the component, not the tag",
  },
  "raw-p": {
    component: "<Text>",
    importPath: "@/components/ui/text",
    category: "typography",
    patterns: [{ jsx: /<p\b/ }],
    rawPattern: "<p …>",
    description: "Paragraph text on the design-system type scale",
  },
  "raw-span": {
    component: "<Text>",
    importPath: "@/components/ui/text",
    category: "typography",
    patterns: [{ jsx: /<span\b[^>]*className=/ }],
    rawPattern: "<span className={…}>",
    description: "Styled inline text — raw styled spans bypass the type scale",
  },
  "raw-code": {
    component: "<Code>",
    importPath: "@/components/ui/code",
    category: "display",
    patterns: [{ jsx: /<code\b/ }],
    rawPattern: "<code …>",
    description: "Inline or block code with monospace styling",
  },
  "raw-anchor": {
    component: "<Link>",
    importPath: "@/components/ui/link",
    category: "navigation",
    patterns: [{ jsx: /<a\b[^>]*(?:href|className)=/ }],
    rawPattern: "<a href={…}>",
    description: "Navigation link — a bare <a> bypasses Next.js routing and prefetching",
  },
  "raw-div": {
    component: "<Box> or <Stack>",
    importPath: "@/components/ui/box",
    category: "layout",
    patterns: [{ jsx: /<div\b/ }],
    rawPattern: "<div …>",
    description: "Generic container (Box) or flex layout wrapper (Stack)",
  },
  "raw-stack": {
    component: "<Stack>",
    importPath: "@/components/ui/stack",
    category: "layout",
    patterns: [
      {
        jsx: /<div\b[^>]*\b(?<!inline-)(?<!sm:)(?<!md:)(?<!lg:)(?<!xl:)(?:flex(?!-)|flex-(?:row|col|wrap|nowrap|wrap-reverse|row-reverse|col-reverse))\b/,
      },
    ],
    rawPattern: '<div className="flex …">',
    description: "Flex row or column layout with gap, align and justify props",
  },
} satisfies Record<string, DsPresetDef>;

export type DsPresetName = keyof typeof PRESET_DEFS;
export type DsPresetOverride = Partial<Omit<DsRule, "name">>;

export const DS_PRESET_NAMES = Object.keys(PRESET_DEFS) as DsPresetName[];

function resolvePreset(name: DsPresetName): DsRule {
  const def = PRESET_DEFS[name] as DsPresetDef | undefined;
  if (!def) {
    throw new Error(
      `manifest: unknown preset "${name}" in ENABLED_RULES — valid: ${DS_PRESET_NAMES.join(", ")}`,
    );
  }
  return { name, ...def, ...PRESET_OVERRIDES[name] };
}

export const DS_RULES: DsRule[] = [...ENABLED_RULES.map(resolvePreset), ...CUSTOM_RULES];
