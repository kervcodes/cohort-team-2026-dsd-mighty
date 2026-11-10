export type RuleInput = {
  invoice_maximum: string;
  min_approvals: string;
};

export type RuleErrors = {
  invoice_maximum?: string;
  min_approvals?: string;
};

const CURRENCY_PATTERN = /^\d+(\.\d{1,2})?$/;
const WHOLE_NUMBER_PATTERN = /^\d+$/;

export function validateRules(input: RuleInput): RuleErrors {
  const errors: RuleErrors = {};

  const max = input.invoice_maximum.trim();
  if (max === "") {
    errors.invoice_maximum = "Invoice maximum is required.";
  } else if (!CURRENCY_PATTERN.test(max)) {
    errors.invoice_maximum = "Enter a dollar amount, like 5000 or 5000.50.";
  } else if (Number(max) <= 0) {
    errors.invoice_maximum = "Invoice maximum must be greater than $0.";
  }

  const min = input.min_approvals.trim();
  if (min === "") {
    errors.min_approvals = "Minimum approvals is required.";
  } else if (!WHOLE_NUMBER_PATTERN.test(min)) {
    errors.min_approvals = "Minimum approvals must be a whole number.";
  } else if (Number(min) <= 0) {
    errors.min_approvals = "Minimum approvals must be at least 1.";
  }

  return errors;
}
