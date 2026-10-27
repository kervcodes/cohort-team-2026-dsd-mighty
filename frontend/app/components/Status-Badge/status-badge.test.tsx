import { render, screen } from "@testing-library/react";
import { StatusBadge } from "./status-badge";

describe("Status-Badge", () => {
  it("renders the status text", () => {
    render(<StatusBadge status="paid" />);

    expect(screen.getByText("paid")).toBeInTheDocument();
  });
});
