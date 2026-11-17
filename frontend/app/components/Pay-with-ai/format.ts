// Formatting for the payment run panel. Kept here, next to its only user.

export const EMPTY_VALUE = "-";

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

// "1234.5" -> "$1,234.50". Anything that isn't a number shows as "-".
export function formatMoney(amount: string | null | undefined): string {
  if (amount == null || amount.trim() === "") return EMPTY_VALUE;
  const value = Number(amount);
  return Number.isFinite(value) ? money.format(value) : EMPTY_VALUE;
}

// A calendar date with no time ("2026-11-15") -> "Nov 15, 2026". Read as
// UTC so the date never shifts a day in timezones west of UTC.
export function formatDay(isoDate: string | null | undefined): string {
  if (!isoDate) return EMPTY_VALUE;
  const date = new Date(`${isoDate.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return EMPTY_VALUE;
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function parse(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

// A timestamp -> "3:04:05 PM" in the viewer's timezone.
export function formatTime(iso: string | null | undefined): string {
  const date = parse(iso);
  return date
    ? date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit" })
    : EMPTY_VALUE;
}

// A timestamp -> "Nov 15, 3:04 PM" in the viewer's timezone, with no-break
// spaces so a narrow screen never wraps it in the middle.
export function formatDateTime(iso: string | null | undefined): string {
  const date = parse(iso);
  return date
    ? date
        .toLocaleString("en-US", {
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
        })
        .replace(/\s/g, "\u00a0")
    : EMPTY_VALUE;
}
