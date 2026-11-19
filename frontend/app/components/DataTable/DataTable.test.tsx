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

  it("keeps headers on one line and adds a column's own cell classes", () => {
    renderTable({
      rows: makeRows(1),
      columns: [
        {
          header: "Long header name",
          cell: (row) => row.name,
          className: "whitespace-nowrap",
        },
      ],
    });

    expect(screen.getByRole("columnheader", { name: "Long header name" })).toHaveClass(
      "whitespace-nowrap",
    );
    expect(screen.getByRole("cell", { name: "Item 1" })).toHaveClass("whitespace-nowrap");
  });

  it("narrows the gaps between columns when compact", () => {
    renderTable({ rows: makeRows(1), compact: true });

    expect(screen.getByRole("cell", { name: "Item 1" })).toHaveClass("px-3", "first:pl-6");
    expect(screen.getByRole("columnheader", { name: "Name" })).not.toHaveClass("px-6");
  });

  it("shows the empty message when there are no rows", () => {
    renderTable();

    expect(screen.getByText("Nothing here yet.")).toBeInTheDocument();
  });

  it("shows the loading message instead of rows while loading", () => {
    renderTable({
      rows: makeRows(2),
      loading: true,
      loadingMessage: "Loading things...",
    });

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
  describe("Row links", () => {
    it("renders one edit link per row when preUrl is provided", () => {
      renderTable({
        rows: makeRows(2),
        preUrl: "/admin/things/",
      });

      const links = screen.getAllByRole("link");

      expect(links).toHaveLength(2);

      expect(links[0]).toHaveAttribute("href", "/admin/things/row-1");

      expect(links[1]).toHaveAttribute("href", "/admin/things/row-2");
    });

    it("uses the default postUrl when only preUrl is provided", () => {
      renderTable({
        rows: makeRows(1),
        preUrl: "/admin/things/",
      });

      expect(screen.getByRole("link", { name: "Item 1" })).toHaveAttribute(
        "href",
        "/admin/things/row-1",
      );
    });

    it("supports a custom postUrl", () => {
      renderTable({
        rows: makeRows(1),
        preUrl: "/admin/things/",
        postUrl: "/edit",
      });

      expect(screen.getByRole("link", { name: "Item 1" })).toHaveAttribute(
        "href",
        "/admin/things/row-1/edit",
      );
    });

    it("supports a custom URL prefix and suffix", () => {
      renderTable({
        rows: makeRows(1),
        preUrl: "/admin/users/",
        postUrl: "/settings/permissions",
      });

      expect(screen.getByRole("link", { name: "Item 1" })).toHaveAttribute(
        "href",
        "/admin/users/row-1/settings/permissions",
      );
    });

    it("does not render links when preUrl is omitted", () => {
      renderTable({ rows: makeRows(2) });

      expect(screen.queryByRole("link")).not.toBeInTheDocument();
    });

    it("applies stretched link overlay classes", () => {
      renderTable({
        rows: makeRows(1),
        preUrl: "/admin/things/",
      });

      const link = screen.getByRole("link", { name: "Item 1" });

      expect(link).toHaveClass("after:absolute", "after:inset-0", "after:content-['']");
    });

    it("makes each row the positioning context for its stretched link", () => {
      renderTable({
        rows: makeRows(1),
        preUrl: "/admin/things/",
      });

      const row = screen.getByRole("row", { name: /Item 1/ });

      expect(row).toHaveClass("group", "relative");
    });

    it("only renders the link in the first column", () => {
      renderTable({
        rows: makeRows(1),
        preUrl: "/admin/things/",
      });

      const row = screen.getByRole("row", { name: /Item 1/ });
      const cells = within(row).getAllByRole("cell");

      expect(cells).toHaveLength(2);

      expect(within(cells[0]).getByRole("link", { name: "Item 1" })).toBeInTheDocument();

      expect(within(cells[1]).queryByRole("link")).not.toBeInTheDocument();

      expect(cells[1]).toHaveTextContent("$1");
    });
  });
});
