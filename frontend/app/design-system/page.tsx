/* ds-ignore-file */
// biome-ignore-all lint/style/noJsxLiterals: scaffold documentation page, copy is edited in place
import Button from "@/components/ui/button";
import { DS_RULES } from "@/components/ui/manifest";

export const metadata = { title: "Design System" };

/**
 * The /design-system page has eight required sections. Their ids are checked by
 * scripts/check-ds-page.ts. Replace each TODO with the project's real content; add a live demo
 * of every manifest component under Components.
 */
const OPT_OUTS = [
  {
    directive: "// ds-ignore",
    scope: "Nearby lines",
    effect: "Skips design-system rule findings within 3 lines",
  },
  {
    directive: "{/* ds-ignore */}",
    scope: "Nearby lines (JSX)",
    effect: "Same, usable inside JSX",
  },
  {
    directive: "/* ds-ignore-file */",
    scope: "Whole file",
    effect: "Skips all design-system rules for the file",
  },
];

export default function DesignSystemPage() {
  return (
    <main
      className="mx-auto max-w-4xl space-y-12 p-8"
      data-content-skip="design-system documentation page"
    >
      <header>
        <h1 className="text-3xl font-bold">Design System</h1>
        <p className="mt-2 text-sm opacity-70">
          Every component below replaces a raw HTML element. The pre-commit hook, pre-push hook, CI
          and the Claude Code hook reject the raw form outside <code>components/ui</code>.
        </p>
      </header>

      <section id="ds-principles" aria-labelledby="ds-principles-title">
        <h2 id="ds-principles-title" className="text-2xl font-bold">
          Principles
        </h2>
        <p className="mt-2 text-sm opacity-70">
          TODO: the few rules that settle design arguments — what this product values and what it
          refuses to do.
        </p>
      </section>

      <section id="ds-foundations" aria-labelledby="ds-foundations-title">
        <h2 id="ds-foundations-title" className="text-2xl font-bold">
          Foundations
        </h2>
        <ul className="mt-2 list-disc pl-6 text-sm">
          <li>Color — palette and usage</li>
          <li>Type scale — families, sizes, weights, line heights</li>
          <li>Spacing and grid — spacing scale, breakpoints, layout grid</li>
          <li>Radius</li>
          <li>Elevation — shadows and layering</li>
          <li>Motion — durations, easing, reduced-motion behavior</li>
          <li>Iconography — icon set, sizes, usage</li>
        </ul>
        <p className="mt-2 text-sm opacity-70">TODO: show a swatch or specimen for each.</p>
      </section>

      <section id="ds-tokens" aria-labelledby="ds-tokens-title">
        <h2 id="ds-tokens-title" className="text-2xl font-bold">
          Tokens
        </h2>
        <p className="mt-2 text-sm opacity-70">
          TODO: list semantic token names (for example <code>--color-surface</code>,{" "}
          <code>--color-text-muted</code>) with their light and dark values, rendered from the theme
          in <code>globals.css</code>.
        </p>
      </section>

      <section id="ds-components" aria-labelledby="ds-components-title">
        <h2 id="ds-components-title" className="text-2xl font-bold">
          Components
        </h2>
        <article className="mt-4 space-y-3" aria-labelledby="ds-button-title">
          <h3 id="ds-button-title" className="text-lg font-semibold">
            Button
          </h3>
          <p className="text-sm opacity-70">
            Replaces the raw button element. Props: label, variant (primary, secondary), size (md,
            sm), plus any native button attribute. Import from <code>@/components/ui/button</code>.
          </p>
          <div className="flex gap-2">
            <Button label="Primary" />
            <Button label="Secondary" variant="secondary" />
            <Button label="Small" variant="secondary" size="sm" />
            <Button label="Disabled" disabled />
          </div>
        </article>
      </section>

      <section id="ds-patterns" aria-labelledby="ds-patterns-title">
        <h2 id="ds-patterns-title" className="text-2xl font-bold">
          Patterns
        </h2>
        <p className="mt-2 text-sm opacity-70">
          TODO: page layouts and multi-component flows (forms, navigation, empty states) built from
          the components above.
        </p>
      </section>

      <section id="ds-content" aria-labelledby="ds-content-title">
        <h2 id="ds-content-title" className="text-2xl font-bold">
          Content guidelines
        </h2>
        <p className="mt-2 text-sm opacity-70">
          TODO: voice, tone and microcopy rules — button labels, error messages, empty states.
        </p>
      </section>

      <section id="ds-accessibility" aria-labelledby="ds-accessibility-title">
        <h2 id="ds-accessibility-title" className="text-2xl font-bold">
          Accessibility
        </h2>
        <p className="mt-2 text-sm opacity-70">
          TODO: contrast requirements, focus treatment, and motion preferences (
          <code>prefers-reduced-motion</code>).
        </p>
      </section>

      <section id="ds-governance" aria-labelledby="ds-governance-title">
        <h2 id="ds-governance-title" className="text-2xl font-bold">
          Governance
        </h2>
        <p className="mt-2 text-sm opacity-70">
          Owner: TODO. To add or change a component: build it in <code>components/ui</code>,
          register it in <code>manifest.config.ts</code>, add its entry above, then migrate call
          sites.
        </p>

        <h3 className="mt-6 text-lg font-semibold">Enforcement rules</h3>
        {DS_RULES.length === 0 ? (
          <p className="mt-2 text-sm opacity-70">
            No rules enabled yet. Enable presets in <code>components/ui/manifest.config.ts</code> as
            you add components.
          </p>
        ) : (
          <table className="mt-4 w-full text-left text-sm">
            <thead>
              <tr>
                <th className="py-2 pr-4">Instead of</th>
                <th className="py-2 pr-4">Use</th>
                <th className="py-2 pr-4">Import from</th>
                <th className="py-2">Notes</th>
              </tr>
            </thead>
            <tbody>
              {DS_RULES.map((rule) => (
                <tr key={rule.name} className="border-t">
                  <td className="py-2 pr-4 font-mono">{rule.rawPattern}</td>
                  <td className="py-2 pr-4 font-mono">{rule.component}</td>
                  <td className="py-2 pr-4 font-mono">{rule.importPath}</td>
                  <td className="py-2">{rule.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <h3 className="mt-6 text-lg font-semibold">Opt-out directives</h3>
        <table className="mt-4 w-full text-left text-sm">
          <thead>
            <tr>
              <th className="py-2 pr-4">Directive</th>
              <th className="py-2 pr-4">Scope</th>
              <th className="py-2">Effect</th>
            </tr>
          </thead>
          <tbody>
            {OPT_OUTS.map((optOut) => (
              <tr key={optOut.directive} className="border-t">
                <td className="py-2 pr-4 font-mono">{optOut.directive}</td>
                <td className="py-2 pr-4">{optOut.scope}</td>
                <td className="py-2">{optOut.effect}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}
