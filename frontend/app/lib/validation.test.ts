import { validateRules } from "./validation";

const valid = { invoice_maximum: "5000", min_approvals: "1" };

describe("validateRules", () => {
  it("returns no errors for valid input", () => {
    const input = {
      invoice_maximum: "5000.00",
      min_approvals: "1",
    };
    const errors = validateRules(input);
    expect(errors).toEqual({});
  });

  it.each(["5000", "5000.5", "5000.50", "0.01", "1234567.89"])(
    "accepts %s as an invoice maximum",
    (invoice_maximum) => {
      expect(validateRules({ ...valid, invoice_maximum })).toEqual({});
    },
  );

  it.each(["1", "2", "10"])("accepts %s as minimum approvals", (min_approvals) => {
    expect(validateRules({ ...valid, min_approvals })).toEqual({});
  });
  it("does not add an error to min approvals", () => {
    const errors = validateRules({ ...valid, invoice_maximum: "abc" });
    expect(errors.min_approvals).toBeUndefined();
  });
});
