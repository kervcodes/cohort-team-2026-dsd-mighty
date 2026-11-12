import { render, screen } from "@testing-library/react";
import { FormField } from "./form-field";

describe("formfield", () => {
  it("renders its children", () => {
    render(
      <FormField label="Name" htmlFor="Name">
        <input id="name" data-testid="child-input" />
      </FormField>,
    );
  });

  it("renders Error message when none is provided", () => {
    render(
      <FormField label="email" htmlFor="email" error="invalid email">
        <input id="email" />
      </FormField>,
    );
    expect(screen.getByText("invalid email")).toBeInTheDocument();
  });
});

describe("FormField note", () => {
  it("shows the note and describes the control with it", () => {
    render(
      <FormField label="Amount" htmlFor="amount" note="Check this: the reader wasn't sure">
        {(field) => <input {...field} />}
      </FormField>,
    );

    expect(screen.getByLabelText("Amount")).toHaveAccessibleDescription(
      "Check this: the reader wasn't sure",
    );
  });

  it("describes the control with both the note and the error", () => {
    render(
      <FormField label="Amount" htmlFor="amount" note="Check this" error="Required">
        {(field) => <input {...field} />}
      </FormField>,
    );

    expect(screen.getByLabelText("Amount")).toHaveAttribute(
      "aria-describedby",
      "amount-note amount-error",
    );
  });

  it("renders no note and no description without one", () => {
    render(
      <FormField label="Amount" htmlFor="amount">
        {(field) => <input {...field} />}
      </FormField>,
    );

    expect(screen.getByLabelText("Amount")).not.toHaveAttribute("aria-describedby");
  });
});
