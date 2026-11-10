export function sanitizeCurrencyInput(raw: string): string {
  const cleaned = raw.replace(/[^\d.]/g, "");
  const [whole, ...rest] = cleaned.split(".");

  if (rest.length === 0) return whole;

  const cents = rest.join("").slice(0, 2);
  return `${whole}.${cents}`;
}
