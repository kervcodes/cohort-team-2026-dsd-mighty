import {
  defaultPaymentValues,
  FORM_ERRORS,
  latestPaidOn,
  localToday,
  type PaymentFormValues,
  toPaymentPayload,
  validatePaymentForm,
} from "./payment-form";

// A local-time instant; the test's time zone decides its UTC date.
function at(year: number, month: number, day: number, hour: number) {
  return new Date(year, month - 1, day, hour);
}

const values: PaymentFormValues = {
  method: "wire",
  paidOn: "2026-11-15",
  reference: "  CONF-9  ",
  failureReason: "",
};

describe("localToday", () => {
  it("is the local calendar date, late in the evening too", () => {
    expect(localToday(at(2026, 11, 15, 23))).toBe("2026-11-15");
    expect(localToday(at(2026, 11, 15, 0))).toBe("2026-11-15");
  });
});

describe("latestPaidOn", () => {
  it("is never before the local today, so today is always allowed", () => {
    for (const hour of [0, 6, 12, 18, 23]) {
      const now = at(2026, 11, 15, hour);
      expect(latestPaidOn(now) >= localToday(now)).toBe(true);
    }
  });

  it("is never after tomorrow, locally or in UTC (the server's limit)", () => {
    for (const hour of [0, 6, 12, 18, 23]) {
      const now = at(2026, 12, 31, hour);
      const latest = latestPaidOn(now);
      expect(latest <= "2027-01-01").toBe(true);
      const utcTomorrow = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1),
      );
      expect(latest <= utcTomorrow.toISOString().slice(0, 10)).toBe(true);
    }
  });
});

describe("defaultPaymentValues", () => {
  it("starts on ACH, dated today, with nothing else filled in", () => {
    expect(defaultPaymentValues(at(2026, 11, 15, 9))).toEqual({
      method: "ach",
      paidOn: "2026-11-15",
      reference: "",
      failureReason: "",
    });
  });
});

describe("validatePaymentForm", () => {
  it("accepts a completed payment with no reference", () => {
    expect(validatePaymentForm({ ...values, reference: "" }, "completed", "2026-11-16")).toEqual(
      {},
    );
  });

  it("requires a date", () => {
    expect(validatePaymentForm({ ...values, paidOn: "" }, "completed", "2026-11-16")).toEqual({
      paidOn: FORM_ERRORS.paidOnRequired,
    });
  });

  it("refuses a date after the latest allowed one", () => {
    expect(
      validatePaymentForm({ ...values, paidOn: "2026-11-17" }, "completed", "2026-11-16"),
    ).toEqual({ paidOn: FORM_ERRORS.paidOnInFuture });
  });

  it("requires a reason for a failed attempt, not just spaces", () => {
    expect(
      validatePaymentForm({ ...values, failureReason: "   " }, "failed", "2026-11-16"),
    ).toEqual({ failureReason: FORM_ERRORS.failureReasonRequired });
  });
});

describe("toPaymentPayload", () => {
  it("sends the full bill amount, trimmed reference and no reason when completed", () => {
    expect(toPaymentPayload(values, "completed", "1250.00")).toEqual({
      amount: "1250.00",
      payment_method: "wire",
      paid_on: "2026-11-15",
      reference: "CONF-9",
      outcome: "completed",
    });
  });

  it("sends a blank reference as null and a numeric amount in cents", () => {
    expect(toPaymentPayload({ ...values, reference: " " }, "completed", 1250.5)).toMatchObject({
      amount: "1250.50",
      reference: null,
    });
  });

  it("sends the trimmed reason when failed", () => {
    expect(
      toPaymentPayload({ ...values, failureReason: " Bank returned it " }, "failed", "1250.00"),
    ).toEqual({
      amount: "1250.00",
      payment_method: "wire",
      paid_on: "2026-11-15",
      reference: "CONF-9",
      outcome: "failed",
      failure_reason: "Bank returned it",
    });
  });
});
