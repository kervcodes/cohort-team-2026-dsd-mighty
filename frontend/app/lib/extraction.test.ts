import { emptyInvoiceForm } from "@/lib/invoice-form-schema";
import type { AccountStatus } from "@/types/bill";
import type {
  BillExtraction,
  Confidence,
  Extracted,
  ExtractedAccountStatus,
  ExtractionIssue,
  ExtractionResult,
} from "@/types/extraction";
import { fieldLabel, normalizeValue, planFill } from "./extraction";

function read(value: string | null, confidence: Confidence = "high"): Extracted {
  return { value, evidence: value ?? "", confidence };
}

function status(
  value: AccountStatus | null,
  confidence: Confidence = "high",
): ExtractedAccountStatus {
  return { value, evidence: value ?? "", confidence };
}

function extraction(overrides: Partial<BillExtraction> = {}): BillExtraction {
  return {
    document_type: "invoice",
    vendor_name: read("City Power"),
    account_number: read("ACC-100"),
    invoice_number: read("INV-2001"),
    invoice_date: read("2026-10-01"),
    due_date: read("2026-10-31"),
    amount_due: read("$1,234.56"),
    previous_balance: read(null),
    payments_received: read("50.00"),
    current_charges: read(null),
    line_items: [],
    service_address: read("  12 Elm St  "),
    service_period_start: read(null),
    service_period_end: read(null),
    description: read("Electric service"),
    payment_website: read(" https://citypower.example/pay "),
    account_status: status("unpaid"),
    ...overrides,
  };
}

function result(overrides: Partial<ExtractionResult> = {}): ExtractionResult {
  return {
    status: "ready_for_review",
    extraction: extraction(),
    issues: [],
    failed_reason: null,
    model: "test-model",
    prompt_version: "v1",
    file_sha256: "abc",
    input_tokens: 1,
    output_tokens: 1,
    cost_usd: 0,
    latency_ms: 1,
    ...overrides,
  };
}

function issue(code: ExtractionIssue["code"], field: string): ExtractionIssue {
  return { code, field, message: `${field} backend message` };
}

describe("planFill", () => {
  it("maps every extraction field to its form field", () => {
    const plan = planFill(result(), emptyInvoiceForm);

    expect(plan.values).toEqual({
      companyName: "City Power",
      accountNumber: "ACC-100",
      statementId: "INV-2001",
      issueDate: "2026-10-01",
      dueDate: "2026-10-31",
      currentDue: "1234.56",
      previousPayments: "50.00",
      propertyAddress: "12 Elm St",
      description: "Electric service",
      websiteName: "https://citypower.example/pay",
      accountStatus: "unpaid",
    });
    expect(plan.notes).toEqual({});
    expect(plan.banner).toEqual({
      tone: "success",
      message: "Filled 11 fields from the invoice. Check them before you create the bill.",
      details: [],
    });
  });

  it("never fills a field that already has a value", () => {
    const plan = planFill(result({ issues: [issue("LOW_CONFIDENCE", "account_number")] }), {
      ...emptyInvoiceForm,
      accountNumber: "TYPED-1",
      currentDue: "10.00",
    });

    expect(plan.values.accountNumber).toBeUndefined();
    expect(plan.values.currentDue).toBeUndefined();
    // The kept value is the person's, so the reader's doubts about its own
    // reading are not shown on it.
    expect(plan.notes.accountNumber).toBeUndefined();
    expect(plan.banner.message).toBe(
      "Filled 9 fields from the invoice. Check them before you create the bill.",
    );
  });

  it("says nothing was filled when every field already had a value", () => {
    const full = {
      ...emptyInvoiceForm,
      companyName: "a",
      accountNumber: "a",
      statementId: "a",
      issueDate: "2026-01-01",
      dueDate: "2026-01-02",
      currentDue: "1",
      previousPayments: "1",
      propertyAddress: "a",
      description: "a",
      websiteName: "https://a.example",
      accountStatus: "paid" as const,
    };

    const plan = planFill(result(), full);

    expect(plan.values).toEqual({});
    expect(plan.banner.message).toBe("Nothing was filled because the fields already had values.");
  });

  it("skips values the bill does not show, with no note", () => {
    const plan = planFill(
      result({
        extraction: extraction({ payments_received: read(null), service_address: read("   ") }),
      }),
      emptyInvoiceForm,
    );

    expect(plan.values).not.toHaveProperty("previousPayments");
    expect(plan.values).not.toHaveProperty("propertyAddress");
    expect(plan.notes).toEqual({});
  });

  it("does not fill an unusable date or amount but says what was read", () => {
    const plan = planFill(
      result({
        status: "needs_attention",
        extraction: extraction({
          invoice_date: read("10/01/2026"),
          due_date: read("2026-02-30"),
          amount_due: read("1,18"),
          payments_received: read("-50.00"),
        }),
        issues: [issue("BAD_DATE", "invoice_date"), issue("BAD_AMOUNT", "amount_due")],
      }),
      emptyInvoiceForm,
    );

    expect(plan.values).not.toHaveProperty("issueDate");
    expect(plan.values).not.toHaveProperty("dueDate");
    expect(plan.values).not.toHaveProperty("currentDue");
    expect(plan.values).not.toHaveProperty("previousPayments");
    expect(plan.notes).toEqual({
      issueDate: 'Check this: read "10/01/2026", which isn\'t a valid date',
      dueDate: 'Check this: read "2026-02-30", which isn\'t a valid date',
      currentDue: 'Check this: read "1,18", which isn\'t a valid amount',
      previousPayments: 'Check this: read "-50.00", which isn\'t a valid amount',
    });
    expect(plan.banner).toEqual({
      tone: "warning",
      message:
        "Filled 7 fields from the invoice. Some values need checking - see the marked fields.",
      details: [],
    });
  });

  it("does not fill a current due of 0, which the form rejects", () => {
    const plan = planFill(
      result({ extraction: extraction({ amount_due: read("$0.00") }) }),
      emptyInvoiceForm,
    );

    expect(plan.values).not.toHaveProperty("currentDue");
    expect(plan.notes.currentDue).toBe(
      'Check this: read "$0.00", but the amount must be more than 0',
    );
  });

  it.each(["www.citypower.example", "ftp://citypower.example", "pay online"])(
    "does not fill the website %p but says what was read",
    (website) => {
      const plan = planFill(
        result({
          status: "needs_attention",
          extraction: extraction({ payment_website: read(website) }),
          issues: [issue("BAD_URL", "payment_website")],
        }),
        emptyInvoiceForm,
      );

      expect(plan.values).not.toHaveProperty("websiteName");
      // BAD_URL says the same as the note, so it is not repeated.
      expect(plan.notes).toEqual({
        websiteName: `Check this: read "${website}", which isn't a valid web address`,
      });
    },
  );

  it("fills a website the form accepts but notes the reader's doubt about it", () => {
    // The backend also rejects whitespace inside a URL; the form's rule does not.
    const plan = planFill(
      result({
        status: "needs_attention",
        extraction: extraction({ payment_website: read("https://citypower.example/pay now") }),
        issues: [issue("BAD_URL", "payment_website")],
      }),
      emptyInvoiceForm,
    );

    expect(plan.values.websiteName).toBe("https://citypower.example/pay now");
    expect(plan.notes).toEqual({ websiteName: "Check this: not a valid web address" });
  });

  it.each(["overdue", "Paid"])("does not fill the account status %p", (printed) => {
    const plan = planFill(
      result({
        extraction: extraction({ account_status: read(printed) as ExtractedAccountStatus }),
      }),
      emptyInvoiceForm,
    );

    expect(plan.values).not.toHaveProperty("accountStatus");
    expect(plan.notes).toEqual({
      accountStatus: `Check this: read "${printed}", which isn't paid, unpaid or outstanding`,
    });
  });

  it("marks a low-confidence value it filled", () => {
    const plan = planFill(
      result({ extraction: extraction({ service_address: read("12 Elm St", "low") }) }),
      emptyInvoiceForm,
    );

    expect(plan.values.propertyAddress).toBe("12 Elm St");
    expect(plan.notes).toEqual({ propertyAddress: "Check this: the reader wasn't sure" });
  });

  it("marks a filled field that an issue names, once per reason", () => {
    const plan = planFill(
      result({
        status: "needs_attention",
        extraction: extraction({ vendor_name: read("City Power", "low") }),
        issues: [
          issue("LOW_CONFIDENCE", "vendor_name"),
          issue("MODELS_DISAGREE", "vendor_name"),
          issue("DUE_BEFORE_INVOICE", "due_date"),
        ],
      }),
      emptyInvoiceForm,
    );

    expect(plan.values.companyName).toBe("City Power");
    expect(plan.notes).toEqual({
      companyName:
        "Check this: the reader wasn't sure; two reads of the bill gave different values",
      dueDate: "Check this: the due date is before the invoice date",
    });
  });

  it("notes a required field the bill was missing", () => {
    const plan = planFill(
      result({
        status: "needs_attention",
        extraction: extraction({ invoice_number: read(null) }),
        issues: [issue("MISSING_REQUIRED", "invoice_number")],
      }),
      emptyInvoiceForm,
    );

    expect(plan.notes).toEqual({ statementId: "Check this: not found on the bill" });
  });

  it("lists issues on fields the form does not have in the banner", () => {
    const plan = planFill(
      result({
        status: "needs_attention",
        issues: [
          issue("LINE_ITEMS_MISMATCH", "current_charges"),
          issue("LINE_ITEMS_MISMATCH", "line_items[0].amount"),
          issue("EVIDENCE_NOT_FOUND", "previous_balance"),
        ],
      }),
      emptyInvoiceForm,
    );

    expect(plan.notes).toEqual({});
    expect(plan.banner).toEqual({
      tone: "warning",
      message: "Filled 11 fields from the invoice. Some values need checking.",
      details: [
        "Current charges: the line items don't add up to it",
        "Line item 1 amount: no usable amount",
        "Previous balance: couldn't find it in the PDF's text",
      ],
    });
  });

  it("lists at most five other issues", () => {
    const issues = Array.from({ length: 8 }, (_, i) =>
      issue("EVIDENCE_NOT_FOUND", `line_items[${i}].description`),
    );

    const plan = planFill(result({ status: "needs_attention", issues }), emptyInvoiceForm);

    expect(plan.banner.details).toHaveLength(6);
    expect(plan.banner.details[5]).toBe("...and 3 more");
  });

  it("falls back to the backend message for an unknown issue code", () => {
    const unknown = {
      code: "NEW_CHECK",
      field: "vendor_name",
      message: "a new check failed",
    } as unknown as ExtractionIssue;

    const plan = planFill(
      result({ status: "needs_attention", issues: [unknown] }),
      emptyInvoiceForm,
    );

    expect(plan.notes.companyName).toBe("Check this: a new check failed");
  });

  it("reads like ready when every issue was on a field the person had filled", () => {
    const plan = planFill(
      result({ status: "needs_attention", issues: [issue("LOW_CONFIDENCE", "account_number")] }),
      { ...emptyInvoiceForm, accountNumber: "TYPED-1" },
    );

    expect(plan.banner.tone).toBe("success");
  });

  it("fills nothing when the file is not a bill", () => {
    const plan = planFill(result({ status: "not_an_invoice" }), emptyInvoiceForm);

    expect(plan.values).toEqual({});
    expect(plan.notes).toEqual({});
    expect(plan.banner).toEqual({
      tone: "warning",
      message: "This file doesn't look like a bill. Fill in the form yourself.",
      details: [],
    });
  });

  it("fills nothing when reading failed, and gives the reason", () => {
    const plan = planFill(
      result({ status: "failed", extraction: null, failed_reason: "The PDF is encrypted." }),
      emptyInvoiceForm,
    );

    expect(plan.values).toEqual({});
    expect(plan.banner).toEqual({
      tone: "error",
      message: "Couldn't read this invoice. Fill in the form yourself.",
      details: ["The PDF is encrypted."],
    });
  });

  it("gives no reason when a failed read has none", () => {
    const plan = planFill(result({ status: "failed", extraction: null }), emptyInvoiceForm);

    expect(plan.banner.details).toEqual([]);
  });

  describe("after an earlier read", () => {
    // The form after the read of an earlier bill: the person typed the
    // account number, everything else is what that read filled.
    const earlier = {
      ...emptyInvoiceForm,
      companyName: "Old Power",
      accountNumber: "TYPED-1",
      statementId: "OLD-1",
      issueDate: "2026-09-01",
      dueDate: "2026-09-30",
      currentDue: "10.00",
      previousPayments: "5.00",
      propertyAddress: "1 Old Rd",
      description: "Old service",
      websiteName: "https://old.example",
      accountStatus: "paid" as const,
    };
    const replaceable = new Set([
      "companyName",
      "statementId",
      "issueDate",
      "dueDate",
      "currentDue",
      "previousPayments",
      "propertyAddress",
      "description",
      "websiteName",
      "accountStatus",
    ] as const);

    it("replaces what the earlier read filled, but never the person's value", () => {
      const plan = planFill(result(), earlier, replaceable);

      expect(plan.values).toEqual({
        companyName: "City Power",
        statementId: "INV-2001",
        issueDate: "2026-10-01",
        dueDate: "2026-10-31",
        currentDue: "1234.56",
        previousPayments: "50.00",
        propertyAddress: "12 Elm St",
        description: "Electric service",
        websiteName: "https://citypower.example/pay",
        accountStatus: "unpaid",
      });
      expect(plan.banner.message).toBe(
        "Filled 10 fields from the invoice. Check them before you create the bill.",
      );
    });

    it("clears an earlier value the new read has nothing usable for", () => {
      const plan = planFill(
        result({
          status: "needs_attention",
          extraction: extraction({
            payments_received: read(null),
            due_date: read("31/10/2026"),
            description: read(null),
            payment_website: read("citypower.example"),
            account_status: status(null),
          }),
          issues: [issue("BAD_DATE", "due_date"), issue("BAD_URL", "payment_website")],
        }),
        earlier,
        replaceable,
      );

      expect(plan.values.previousPayments).toBe("");
      expect(plan.values.dueDate).toBe("");
      expect(plan.values.description).toBe("");
      expect(plan.values.websiteName).toBe("");
      expect(plan.values.accountStatus).toBe("");
      expect(plan.notes.dueDate).toBe('Check this: read "31/10/2026", which isn\'t a valid date');
      expect(plan.notes.websiteName).toBe(
        'Check this: read "citypower.example", which isn\'t a valid web address',
      );
      // Clearing a field is not filling it.
      expect(plan.banner.message).toBe(
        "Filled 5 fields from the invoice. Some values need checking - see the marked fields.",
      );
    });

    it("clears every earlier value when the new file is not a bill or can't be read", () => {
      const cleared = {
        companyName: "",
        statementId: "",
        issueDate: "",
        dueDate: "",
        currentDue: "",
        previousPayments: "",
        propertyAddress: "",
        description: "",
        websiteName: "",
        accountStatus: "",
      };

      expect(planFill(result({ status: "not_an_invoice" }), earlier, replaceable).values).toEqual(
        cleared,
      );
      expect(
        planFill(result({ status: "failed", extraction: null }), earlier, replaceable).values,
      ).toEqual(cleared);
    });
  });

  it("does not blame filled fields when the bill gave nothing to fill", () => {
    const nothing = read(null);
    const plan = planFill(
      result({
        extraction: extraction({
          vendor_name: nothing,
          account_number: nothing,
          invoice_number: nothing,
          invoice_date: nothing,
          due_date: nothing,
          amount_due: nothing,
          payments_received: nothing,
          service_address: nothing,
          description: nothing,
          payment_website: nothing,
          account_status: status(null),
        }),
      }),
      emptyInvoiceForm,
    );

    expect(plan.values).toEqual({});
    expect(plan.banner.message).toBe(
      "Nothing on the invoice could be filled in. Fill in the form yourself.",
    );
  });
});

describe("normalizeValue", () => {
  it.each([
    ["$1,234.56", "1234.56"],
    [" $ 1 234.56 ", "1234.56"],
    ["1234.5", "1234.5"],
    ["1,234,567", "1234567"],
    ["0", "0"],
  ])("reads the amount %p as %p", (raw, expected) => {
    expect(normalizeValue("amount", raw)).toEqual({ ok: true, value: expected });
  });

  it.each(["1,18", "12.345", "-5", "abc", "$", "12345678901", "1e3"])(
    "rejects the amount %p",
    (raw) => {
      expect(normalizeValue("amount", raw)).toMatchObject({ ok: false });
    },
  );

  it("accepts only real YYYY-MM-DD dates", () => {
    expect(normalizeValue("date", " 2026-02-28 ")).toEqual({ ok: true, value: "2026-02-28" });
    expect(normalizeValue("date", "2026-02-29")).toMatchObject({ ok: false });
    expect(normalizeValue("date", "Oct 1, 2026")).toMatchObject({ ok: false });
  });

  it("trims text and treats blank as missing", () => {
    expect(normalizeValue("text", "  City Power ")).toEqual({ ok: true, value: "City Power" });
    expect(normalizeValue("text", "  ")).toBeNull();
    expect(normalizeValue("text", null)).toBeNull();
  });
});

describe("fieldLabel", () => {
  it("turns extraction field names into words", () => {
    expect(fieldLabel("current_charges")).toBe("Current charges");
    expect(fieldLabel("line_items[2].amount")).toBe("Line item 3 amount");
    expect(fieldLabel("line_items")).toBe("Line items");
  });
});
