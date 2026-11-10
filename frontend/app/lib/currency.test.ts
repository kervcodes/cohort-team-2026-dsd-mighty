import { sanitizeCurrencyInput } from "./currency";

describe("sanitizeCurrencyInput", () => {
  describe("removes disallowed characters", () => {
    it.each([
      ["abc", ""],
      ["12abc3", "123"],
      ["$1,234", "1234"],
      ["-50", "50"],
      ["1e5", "15"],
      ["  42  ", "42"],
      ["5000 USD", "5000"],
    ])("turns %j into %j", (input, expected) => {
      expect(sanitizeCurrencyInput(input)).toBe(expected);
    });
  });
  describe("decimal handling", () => {
    it("limits cents to two decimal places", () => {
      expect(sanitizeCurrencyInput("10.999")).toBe("10.99");
    });
    it("allows a leading decimal point", () => {
      expect(sanitizeCurrencyInput(".5")).toBe(".5");
    });

    it("merges extra decimal points into the cents", () => {
      expect(sanitizeCurrencyInput("1.2.3")).toBe("1.23");
    });
  });
});
