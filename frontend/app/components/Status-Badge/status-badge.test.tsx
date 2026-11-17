import { render, screen } from "@testing-library/react";
import { StatusBadge } from "./status-badge";

describe("Status-Badge", () => {
  it("renders the status text", () => {
    render(<StatusBadge status="paid" />);

    expect(screen.getByText("paid")).toBeInTheDocument();
  });

  it.each(["queued", "running", "flagged"] as const)(
    "renders the %s payment run status",
    (status) => {
      render(<StatusBadge status={status} />);

      expect(screen.getByText(status)).toBeInTheDocument();
    },
  );
});
