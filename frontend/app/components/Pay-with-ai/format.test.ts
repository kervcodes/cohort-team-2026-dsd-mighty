import { formatDateTime, formatDay, formatMoney, formatTime } from "./format";

describe("formatMoney", () => {
  it("shows a decimal string as dollars and cents", () => {
    expect(formatMoney("1234.5")).toBe("$1,234.50");
  });

  it.each([null, undefined, "", "abc"])("shows %p as -", (value) => {
    expect(formatMoney(value)).toBe("-");
  });
});

describe("formatDay", () => {
  it("shows a calendar date without shifting it a day", () => {
    expect(formatDay("2026-11-01")).toBe("Nov 1, 2026");
  });

  it.each([null, "", "not a date"])("shows %p as -", (value) => {
    expect(formatDay(value)).toBe("-");
  });
});

describe("formatTime and formatDateTime", () => {
  it("show - for a missing or bad timestamp", () => {
    expect(formatTime(null)).toBe("-");
    expect(formatDateTime("nope")).toBe("-");
  });

  it("keep a date-time on one line with no-break spaces", () => {
    const shown = formatDateTime("2026-11-15T15:04:00Z");
    expect(shown).toMatch(/^Nov \d{1,2}, \d{1,2}:04 [AP]M$/);
  });
});
