import { formatDay, formatUsd } from "./format";

describe("formatUsd", () => {
  it.each([
    ["1250.5", "$1,250.50"],
    [1250.5, "$1,250.50"],
    ["75.00", "$75.00"],
    [0.1 + 0.2, "$0.30"],
  ])("formats %j as %j", (amount, expected) => {
    expect(formatUsd(amount)).toBe(expected);
  });
});

describe("formatDay", () => {
  it("formats a date-only string as that calendar day", () => {
    expect(formatDay("2026-11-15")).toBe("Nov 15, 2026");
  });

  it("keeps the first of the month on the first, in any time zone", () => {
    expect(formatDay("2026-01-01")).toBe("Jan 1, 2026");
  });
});
