const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

// "1250.5" or 1250.5 -> "$1,250.50". The backend sends decimals as strings.
export function formatUsd(amount: string | number): string {
  return usd.format(Number(amount));
}

// "2026-11-15" -> "Nov 15, 2026". A date-only string, read as that calendar
// day: `new Date("2026-11-15")` is UTC midnight, the day before in America.
export function formatDay(isoDay: string): string {
  const [year, month, day] = isoDay.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
