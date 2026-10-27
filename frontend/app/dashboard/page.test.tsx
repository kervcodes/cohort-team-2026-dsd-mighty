import { render, screen } from "@testing-library/react";
import DashboardPage from "./page";

jest.mock("@/components/Invoice-table/invoice-table", () => ({
  InvoiceTable: () => <div data-testid="invoice-table" />,
}));

describe("Dashboard", () => {
  it("renders the invoice table", () => {
    render(<DashboardPage />);
    expect(screen.getByTestId("invoice-table")).toBeInTheDocument();
  });
});
