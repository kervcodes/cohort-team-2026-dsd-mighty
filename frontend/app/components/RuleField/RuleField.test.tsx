import { fireEvent, render, screen } from "@testing-library/react";
import RuleField from "./RuleField";

const onChange = jest.fn();

const baseProps = {
  label: "Invoice Maximum",
  tooltip: "The largest invoice that does not need admin intervention.",
  value: "5000.00",
  onChange,
};

describe("RuleField", () => {
  beforeEach(() => {
    onChange.mockClear();
  });

  it("shows the label and value, locked until edit is clicked", () => {
    render(<RuleField {...baseProps} />);

    const input = screen.getByLabelText("Invoice Maximum");
    expect(input).toHaveValue("5000.00");
    expect(input).toBeDisabled();
  });

  it("unlocks the input when edit is clicked", () => {
    render(<RuleField {...baseProps} />);

    fireEvent.click(screen.getByRole("button", { name: "edit" }));

    expect(screen.getByLabelText("Invoice Maximum")).toBeEnabled();
    expect(screen.getByRole("button", { name: "done" })).toBeInTheDocument();
  });

  it("calls onChange when the value is edited", () => {
    render(<RuleField {...baseProps} />);

    fireEvent.click(screen.getByRole("button", { name: "edit" }));
    fireEvent.change(screen.getByLabelText("Invoice Maximum"), {
      target: { value: "7500" },
    });

    expect(onChange).toHaveBeenCalledWith("7500");
  });

  it("shows an error message and marks the input invalid", () => {
    render(<RuleField {...baseProps} error="Must be a positive number." />);

    expect(screen.getByText("Must be a positive number.")).toBeInTheDocument();
    expect(screen.getByLabelText("Invoice Maximum")).toHaveAttribute("aria-invalid", "true");
  });
});
