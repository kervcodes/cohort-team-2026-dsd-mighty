import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DataTable, type DataTableColumn } from "./DataTable";

type Row = { id: string; name: string; amount: number };

const columns: DataTableColumn<Row>[] = [
  { header: "Name", cell: (row) => row.name },
  { header: "Amount", cell: (row) => `$${row.amount}`, align: "right" },
];

function makeRows(count: number): Row[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `row-${i + 1}`,
    name: `Item ${i + 1}`,
    amount: i + 1,
  }));
}

function renderTable(props: Partial<React.ComponentProps<typeof DataTable<Row>>> = {}) {
  return render(
    <DataTable<Row>
      label="Things"
      columns={columns}
      rows={[]}
      getRowKey={(row) => row.id}
      emptyMessage="Nothing here yet."
      {...props}
    />,
  );
}

describe("DataTable", () => {
  it("renders a header and one cell per column for each row", () => {
    renderTable({ rows: makeRows(2) });

    const table = screen.getByRole("table", { name: "Things" });
    expect(within(table).getByRole("columnheader", { name: "Name" })).toBeInTheDocument();
    expect(within(table).getByRole("columnheader", { name: "Amount" })).toBeInTheDocument();
    expect(within(table).getAllByRole("row")).toHaveLength(3);
    expect(screen.getByRole("cell", { name: "Item 2" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "$2" })).toHaveClass("text-right");
  });

  it("shows the empty message when there are no rows", () => {
    renderTable();

    expect(screen.getByText("Nothing here yet.")).toBeInTheDocument();
  });

  it("shows the loading message instead of rows while loading", () => {
    renderTable({ rows: makeRows(2), loading: true, loadingMessage: "Loading things..." });

    expect(screen.getByRole("status")).toHaveTextContent("Loading things...");
    expect(screen.getByRole("table")).toHaveAttribute("aria-busy", "true");
    expect(screen.queryByText("Item 1")).not.toBeInTheDocument();
  });

  it("shows the error and retries when asked", async () => {
    const onRetry = jest.fn();
    renderTable({ rows: makeRows(2), error: "Server is down.", onRetry });

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Server is down.");
    expect(screen.queryByText("Item 1")).not.toBeInTheDocument();

    await userEvent.click(within(alert).getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("shows no retry button without onRetry", () => {
    renderTable({ error: "Server is down." });

    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
  });

  it("has no pagination for a single page", () => {
    renderTable({ rows: makeRows(10) });

    expect(screen.queryByRole("button", { name: "Next" })).not.toBeInTheDocument();
  });

  it("pages through rows", async () => {
    renderTable({ rows: makeRows(12), pageSize: 5 });

    expect(screen.getByText("Page 1 of 3")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
    expect(screen.getByText("Item 5")).toBeInTheDocument();
    expect(screen.queryByText("Item 6")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    await userEvent.click(screen.getByRole("button", { name: "Next" }));

    expect(screen.getByText("Page 3 of 3")).toBeInTheDocument();
    expect(screen.getByText("Item 12")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
  });
});
