import { render, screen } from "@testing-library/react";
import Button from "./Button";

describe("Button", () => {
  it("renders the button with the correct label", () => {
    const label = "Click Me";
    render(<Button label={label} />);
    const buttonElement = screen.getByRole("button", { name: label });
    expect(buttonElement).toBeInTheDocument();
  });
});
