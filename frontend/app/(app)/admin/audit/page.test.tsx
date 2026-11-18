import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useAuth } from "@/auth/AuthProvider";
import { getBillHistory, listAuditChanges } from "@/lib/api/audit";
import { listUsers } from "@/lib/api/users";
import type { AuditChange, BillHistory } from "@/types/audit";
import { formatWhen } from "./format";
import AuditPage from "./page";

// A tiny router: replace() rewrites the query string and re-renders readers.
const mockUrl = { params: new URLSearchParams(), listeners: new Set<() => void>() };
const mockReplace = jest.fn((url: string) => {
  mockUrl.params = new URLSearchParams(url.split("?")[1] ?? "");
  for (const listener of mockUrl.listeners) listener();
});

jest.mock("next/navigation", () => {
  const { useSyncExternalStore } = jest.requireActual("react");
  return {
    useRouter: () => ({ replace: mockReplace }),
    useSearchParams: () =>
      useSyncExternalStore(
        (listener: () => void) => {
          mockUrl.listeners.add(listener);
          return () => mockUrl.listeners.delete(listener);
        },
        () => mockUrl.params,
      ),
  };
});

jest.mock("@/auth/AuthProvider", () => ({ useAuth: jest.fn() }));
jest.mock("@/lib/api/audit", () => ({ listAuditChanges: jest.fn(), getBillHistory: jest.fn() }));
jest.mock("@/lib/api/users", () => ({ listUsers: jest.fn() }));

const mockUseAuth = useAuth as jest.Mock;
const mockListChanges = listAuditChanges as jest.Mock;
const mockGetBillHistory = getBillHistory as jest.Mock;
const mockListUsers = listUsers as jest.Mock;

function change(overrides: Partial<AuditChange> = {}): AuditChange {
  return {
    id: 10,
    occurred_at: "2026-11-17T21:08:03.123Z",
    table: "bills",
    action: "changed",
    record_id: "6ab38f2c-1111-2222-3333-444455556666",
    bill_id: "6ab38f2c-1111-2222-3333-444455556666",
    actor: { id: "user-1", name: "Try Approver", role: "authenticated" },
    changed_fields: ["status"],
    before: { status: "draft", amount: "10.00" },
    after: { status: "pending_approval", amount: "10.00" },
    ...overrides,
  };
}

function history(overrides: Partial<BillHistory> = {}): BillHistory {
  return {
    bill_id: "6ab38f2c-1111-2222-3333-444455556666",
    events: [
      {
        at: "2026-11-17T21:07:35Z",
        kind: "bill_created",
        summary: "Created as a draft",
        detail: null,
        actor: { id: "user-2", name: "Ana Analyst" },
        change_id: 1,
        run_id: null,
      },
      {
        at: "2026-11-17T21:09:00Z",
        kind: "bill_approved",
        summary: "Approved",
        detail: "Looks good",
        actor: null,
        change_id: 2,
        run_id: null,
      },
    ],
    ...overrides,
  };
}

function signInAs(
  role: "admin" | "analyst" | "approver" | null,
  status: "active" | "inactive" = "active",
  loading = false,
) {
  mockUseAuth.mockReturnValue({ profile: role ? { role, status } : null, loading });
}

function openAt(query = "") {
  mockUrl.params = new URLSearchParams(query);
  return render(<AuditPage />);
}

const lastRequest = () => mockListChanges.mock.calls.at(-1)?.[0];

describe("AuditPage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUrl.params = new URLSearchParams();
    signInAs("admin");
    mockListChanges.mockResolvedValue({ items: [change()], next_before_id: null });
    mockGetBillHistory.mockResolvedValue(history());
    mockListUsers.mockResolvedValue([
      {
        user_id: "user-1",
        full_name: "Try Approver",
        email: "a@x.test",
        role: "approver",
        status: "active",
      },
      {
        user_id: "user-2",
        full_name: "Ana Analyst",
        email: "b@x.test",
        role: "analyst",
        status: "active",
      },
    ]);
  });

  describe("Access control", () => {
    it.each(["analyst", "approver"] as const)("shows an access message for the %s role", (role) => {
      signInAs(role);
      openAt();

      expect(screen.getByText("Your role does not have access")).toBeInTheDocument();
      expect(mockListChanges).not.toHaveBeenCalled();
      expect(mockListUsers).not.toHaveBeenCalled();
    });

    it("shows an access message without a profile", () => {
      signInAs(null);
      openAt();

      expect(screen.getByText("Your role does not have access")).toBeInTheDocument();
      expect(mockListChanges).not.toHaveBeenCalled();
    });

    it("shows an access message for an inactive admin", () => {
      signInAs("admin", "inactive");
      openAt();

      expect(screen.getByText("Your role does not have access")).toBeInTheDocument();
      expect(mockListChanges).not.toHaveBeenCalled();
    });

    it("waits while permissions load", () => {
      signInAs(null, "active", true);
      openAt();

      expect(screen.getByText("loading permissions...")).toBeInTheDocument();
      expect(mockListChanges).not.toHaveBeenCalled();
    });

    it("loads the changes for an active admin", async () => {
      openAt();

      expect(await screen.findByRole("table", { name: "Changes" })).toBeInTheDocument();
      expect(mockListChanges).toHaveBeenCalledTimes(1);
      expect(lastRequest()).toEqual({
        table: undefined,
        actor_id: undefined,
        bill_id: undefined,
        from: undefined,
        to: undefined,
      });
    });
  });

  describe("Changes list", () => {
    it("shows when, who, table, action, record and changed fields", async () => {
      openAt();

      const row = (await screen.findByText("Try Approver", { selector: "td" })).closest("tr");
      expect(row).not.toBeNull();
      const cells = within(row as HTMLElement);
      expect(cells.getByText(formatWhen("2026-11-17T21:08:03.123Z"))).toBeInTheDocument();
      expect(cells.getByText("Bills")).toBeInTheDocument();
      expect(cells.getByText("Changed")).toBeInTheDocument();
      expect(cells.getByText("6ab38f2c")).toBeInTheDocument();
      expect(cells.getByText("status")).toBeInTheDocument();
    });

    it("names a table it does not know and shows no record for a settings row", async () => {
      mockListChanges.mockResolvedValue({
        items: [change({ table: "autopay_settings", record_id: null, bill_id: null })],
        next_before_id: null,
      });
      openAt();

      const row = (await screen.findByText("Try Approver", { selector: "td" })).closest("tr");
      const cells = within(row as HTMLElement);
      expect(cells.getByText("Autopay settings")).toBeInTheDocument();
      expect(cells.queryByText("True")).not.toBeInTheDocument();
    });

    it("shows System when there is no actor", async () => {
      mockListChanges.mockResolvedValue({
        items: [change({ actor: { id: null, name: null, role: "service_role" } })],
        next_before_id: null,
      });
      openAt();

      expect(await screen.findByText("System")).toBeInTheDocument();
    });

    it("shows a loading state, then the empty message", async () => {
      mockListChanges.mockResolvedValue({ items: [], next_before_id: null });
      openAt();

      expect(screen.getByRole("status")).toHaveTextContent("Loading changes...");
      expect(await screen.findByText("No changes match these filters.")).toBeInTheDocument();
    });

    it("shows the error and loads again on Try again", async () => {
      mockListChanges.mockRejectedValueOnce(new Error("Boom."));
      openAt();

      expect(await screen.findByRole("alert")).toHaveTextContent("Boom.");

      await userEvent.click(screen.getByRole("button", { name: "Try again" }));

      expect(await screen.findByText("Try Approver", { selector: "td" })).toBeInTheDocument();
      expect(mockListChanges).toHaveBeenCalledTimes(2);
    });
  });

  describe("Expanding a row", () => {
    it("shows only the changed fields, before and after, for a change", async () => {
      openAt();

      await userEvent.click(
        await screen.findByRole("button", { name: "Show details for change 10" }),
      );

      const details = within(screen.getAllByRole("table")[1]);
      expect(details.getByText("draft")).toBeInTheDocument();
      expect(details.getByText("pending_approval")).toBeInTheDocument();
      expect(details.queryByText("amount")).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Hide details for change 10" })).toHaveAttribute(
        "aria-expanded",
        "true",
      );

      await userEvent.click(screen.getByRole("button", { name: "Hide details for change 10" }));
      expect(screen.queryByText("pending_approval")).not.toBeInTheDocument();
    });

    it("shows every field, after values only, for a created record", async () => {
      mockListChanges.mockResolvedValue({
        items: [
          change({
            action: "created",
            changed_fields: [],
            before: null,
            after: { status: "draft", amount: "10.00" },
          }),
        ],
        next_before_id: null,
      });
      openAt();

      await userEvent.click(await screen.findByRole("button", { name: /Show details/ }));

      expect(screen.getByText("amount")).toBeInTheDocument();
      expect(screen.getByText("10.00")).toBeInTheDocument();
      expect(screen.queryByRole("columnheader", { name: "Before" })).not.toBeInTheDocument();
      expect(screen.getByRole("columnheader", { name: "After" })).toBeInTheDocument();
    });

    it("shows every field, before values only, for a deleted record", async () => {
      mockListChanges.mockResolvedValue({
        items: [
          change({
            action: "deleted",
            changed_fields: [],
            before: { status: "draft", amount: "10.00" },
            after: null,
          }),
        ],
        next_before_id: null,
      });
      openAt();

      await userEvent.click(await screen.findByRole("button", { name: /Show details/ }));

      expect(screen.getByText("amount")).toBeInTheDocument();
      expect(screen.getByText("draft")).toBeInTheDocument();
      expect(screen.getByRole("columnheader", { name: "Before" })).toBeInTheDocument();
      expect(screen.queryByRole("columnheader", { name: "After" })).not.toBeInTheDocument();
    });

    it("shows masked values exactly as given", async () => {
      mockListChanges.mockResolvedValue({
        items: [
          change({
            table: "vendor_accounts",
            changed_fields: ["account_number"],
            before: { account_number: "****0456" },
            after: { account_number: "****0789" },
          }),
        ],
        next_before_id: null,
      });
      openAt();

      await userEvent.click(await screen.findByRole("button", { name: /Show details/ }));

      expect(screen.getByText("****0456")).toBeInTheDocument();
      expect(screen.getByText("****0789")).toBeInTheDocument();
    });
  });

  describe("Filters", () => {
    it("starts from the filters in the URL", async () => {
      openAt("table=payments&actor_id=user-2&from=2026-11-01&to=2026-11-17");

      await screen.findByRole("table", { name: "Changes" });

      expect(lastRequest()).toMatchObject({
        table: "payments",
        actor_id: "user-2",
        from: "2026-11-01",
        to: "2026-11-17",
      });
      expect(screen.getByLabelText("Table")).toHaveValue("payments");
      expect(screen.getByLabelText("From")).toHaveValue("2026-11-01");
      expect(screen.getByLabelText("To")).toHaveValue("2026-11-17");
      await waitFor(() => expect(screen.getByLabelText("User")).toHaveValue("user-2"));
    });

    it("offers every table", async () => {
      openAt();
      await screen.findByRole("table", { name: "Changes" });

      const options = within(screen.getByLabelText("Table"))
        .getAllByRole("option")
        .map((option) => option.textContent);
      expect(options).toEqual([
        "All",
        "Bills",
        "Approvals",
        "Payments",
        "Vendors",
        "Vendor accounts",
        "Properties",
        "Users",
      ]);
    });

    it("lists the users from the users API", async () => {
      openAt();

      expect(await screen.findByRole("option", { name: "Ana Analyst" })).toBeInTheDocument();
      expect(screen.getByRole("option", { name: "All users" })).toBeInTheDocument();
    });

    it("the table filter updates the URL and the request", async () => {
      openAt();
      await screen.findByRole("table", { name: "Changes" });

      await userEvent.selectOptions(screen.getByLabelText("Table"), "vendor_accounts");

      expect(mockReplace).toHaveBeenLastCalledWith("/admin/audit?table=vendor_accounts", {
        scroll: false,
      });
      await waitFor(() => expect(lastRequest()).toMatchObject({ table: "vendor_accounts" }));
    });

    it("the user filter updates the URL and the request", async () => {
      openAt();
      await screen.findByRole("option", { name: "Ana Analyst" });

      await userEvent.selectOptions(screen.getByLabelText("User"), "user-2");

      expect(mockReplace).toHaveBeenLastCalledWith("/admin/audit?actor_id=user-2", {
        scroll: false,
      });
      await waitFor(() => expect(lastRequest()).toMatchObject({ actor_id: "user-2" }));
    });

    it("the from and to dates update the URL and the request", async () => {
      openAt();
      await screen.findByRole("table", { name: "Changes" });

      await userEvent.type(screen.getByLabelText("From"), "2026-11-01");
      await waitFor(() => expect(lastRequest()).toMatchObject({ from: "2026-11-01" }));

      await userEvent.type(screen.getByLabelText("To"), "2026-11-17");
      await waitFor(() =>
        expect(lastRequest()).toMatchObject({ from: "2026-11-01", to: "2026-11-17" }),
      );
      expect(mockReplace).toHaveBeenLastCalledWith("/admin/audit?from=2026-11-01&to=2026-11-17", {
        scroll: false,
      });
    });

    it("choosing All removes the filter", async () => {
      openAt("table=payments");
      await screen.findByRole("table", { name: "Changes" });

      await userEvent.selectOptions(screen.getByLabelText("Table"), "All");

      expect(mockReplace).toHaveBeenLastCalledWith("/admin/audit", { scroll: false });
      await waitFor(() => expect(lastRequest().table).toBeUndefined());
    });

    it("ignores an unknown table in the URL", async () => {
      openAt("table=secrets");
      await screen.findByRole("table", { name: "Changes" });

      expect(lastRequest().table).toBeUndefined();
    });
  });

  describe("Load more", () => {
    it("fetches the next page with before_id and appends it", async () => {
      mockListChanges
        .mockResolvedValueOnce({ items: [change({ id: 10 })], next_before_id: 9 })
        .mockResolvedValueOnce({
          items: [
            change({ id: 9, actor: { id: "user-2", name: "Ana Analyst", role: "authenticated" } }),
          ],
          next_before_id: null,
        });
      openAt("table=bills");

      await userEvent.click(await screen.findByRole("button", { name: "Load more" }));

      expect(await screen.findByText("Ana Analyst", { selector: "td" })).toBeInTheDocument();
      expect(screen.getByText("Try Approver", { selector: "td" })).toBeInTheDocument();
      expect(lastRequest()).toMatchObject({ table: "bills", before_id: 9 });
      expect(screen.queryByRole("button", { name: "Load more" })).not.toBeInTheDocument();
    });

    it("has no Load more button on the last page", async () => {
      openAt();
      await screen.findByRole("table", { name: "Changes" });

      expect(screen.queryByRole("button", { name: "Load more" })).not.toBeInTheDocument();
    });

    it("keeps the list and shows the error when a page fails, and retries", async () => {
      mockListChanges
        .mockResolvedValueOnce({ items: [change({ id: 10 })], next_before_id: 9 })
        .mockRejectedValueOnce(new Error("Page failed."))
        .mockResolvedValueOnce({ items: [change({ id: 9 })], next_before_id: null });
      openAt();

      await userEvent.click(await screen.findByRole("button", { name: "Load more" }));

      expect(await screen.findByRole("alert")).toHaveTextContent("Page failed.");
      expect(screen.getAllByRole("button", { name: /Show details/ })).toHaveLength(1);

      await userEvent.click(screen.getByRole("button", { name: "Load more" }));

      await waitFor(() =>
        expect(screen.getAllByRole("button", { name: /Show details/ })).toHaveLength(2),
      );
    });
  });

  describe("Bill filter and history", () => {
    it("shows no chip and no history without bill_id", async () => {
      openAt();
      await screen.findByRole("table", { name: "Changes" });

      expect(screen.queryByRole("button", { name: "Clear bill filter" })).not.toBeInTheDocument();
      expect(screen.queryByRole("heading", { name: "Bill history" })).not.toBeInTheDocument();
      expect(mockGetBillHistory).not.toHaveBeenCalled();
    });

    it("filters the changes by the bill and shows a chip", async () => {
      openAt("bill_id=6ab38f2c-1111-2222-3333-444455556666");

      expect(await screen.findByText("Bill 6ab38f2c")).toBeInTheDocument();
      await waitFor(() =>
        expect(lastRequest()).toMatchObject({ bill_id: "6ab38f2c-1111-2222-3333-444455556666" }),
      );
    });

    it("shows the bill history timeline with time, summary, detail and who", async () => {
      openAt("bill_id=6ab38f2c-1111-2222-3333-444455556666");

      const section = (await screen.findByRole("heading", { name: "Bill history" })).closest(
        "section",
      ) as HTMLElement;
      expect(mockGetBillHistory).toHaveBeenCalledWith("6ab38f2c-1111-2222-3333-444455556666");

      const items = await within(section).findAllByRole("listitem");
      expect(items).toHaveLength(2);
      expect(within(items[0]).getByText("Created as a draft")).toBeInTheDocument();
      expect(within(items[0]).getByText(/Ana Analyst/)).toBeInTheDocument();
      expect(within(items[0]).getByText(formatWhen("2026-11-17T21:07:35Z"))).toBeInTheDocument();
      expect(within(items[1]).getByText("Approved")).toBeInTheDocument();
      expect(within(items[1]).getByText("Looks good")).toBeInTheDocument();
      expect(within(items[1]).getByText(/System/)).toBeInTheDocument();
    });

    it("shows an empty history message", async () => {
      mockGetBillHistory.mockResolvedValue(history({ events: [] }));
      openAt("bill_id=b1");

      expect(await screen.findByText("No history for this bill yet.")).toBeInTheDocument();
    });

    it("shows a history error and retries", async () => {
      mockGetBillHistory.mockRejectedValueOnce(new Error("Bill not found."));
      openAt("bill_id=b1");

      const alert = await screen.findByText("Bill not found.");
      await userEvent.click(
        within(alert.closest("[role=alert]") as HTMLElement).getByRole("button", {
          name: "Try again",
        }),
      );

      expect(await screen.findByText("Created as a draft")).toBeInTheDocument();
      expect(mockGetBillHistory).toHaveBeenCalledTimes(2);
    });

    it("clearing the chip removes only the bill filter", async () => {
      openAt("bill_id=b1&table=bills");
      await screen.findByText("Bill b1");

      await act(async () => {
        await userEvent.click(screen.getByRole("button", { name: "Clear bill filter" }));
      });

      expect(mockReplace).toHaveBeenLastCalledWith("/admin/audit?table=bills", { scroll: false });
      await waitFor(() => expect(lastRequest().bill_id).toBeUndefined());
      expect(screen.queryByRole("heading", { name: "Bill history" })).not.toBeInTheDocument();
      expect(screen.queryByText("Bill b1")).not.toBeInTheDocument();
    });
  });
});
