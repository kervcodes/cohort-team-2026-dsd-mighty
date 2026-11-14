import { render, screen } from "@testing-library/react";
import { usePathname } from "next/navigation";
import AdminLayoutContent from "./AdminLayoutContent";

jest.mock("next/navigation", () => ({
  usePathname: jest.fn(),
}));

const mockUsePathname = usePathname as jest.Mock;

describe("AdminLayoutContent", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("Layout", () => {
    it("renders the Admin heading", () => {
      mockUsePathname.mockReturnValue("/admin");

      render(
        <AdminLayoutContent>
          <p>{"Page content"}</p>
        </AdminLayoutContent>,
      );

      expect(
        screen.getByRole("heading", {
          level: 1,
          name: "Admin",
        }),
      ).toBeInTheDocument();
    });

    it("renders its children", () => {
      mockUsePathname.mockReturnValue("/admin");

      render(
        <AdminLayoutContent>
          <p>{"Page content"}</p>
        </AdminLayoutContent>,
      );

      expect(screen.getByText("Page content")).toBeInTheDocument();
    });
  });

  describe("Navigation", () => {
    it("renders Rules and Users navigation links", () => {
      mockUsePathname.mockReturnValue("/admin");

      render(
        <AdminLayoutContent>
          <p>{"Content"}</p>
        </AdminLayoutContent>,
      );

      expect(screen.getByRole("link", { name: "Rules" })).toHaveAttribute("href", "/admin");

      expect(screen.getByRole("link", { name: "Users" })).toHaveAttribute("href", "/admin/users");
    });

    it.each([
      ["/admin", "Rules"],
      ["/admin/users", "Users"],
    ])("highlights %s with the %s tab active", (pathname, activeTab) => {
      mockUsePathname.mockReturnValue(pathname);

      render(
        <AdminLayoutContent>
          <p>{"Content"}</p>
        </AdminLayoutContent>,
      );

      expect(screen.getByRole("link", { name: activeTab })).toHaveAttribute("aria-current", "page");
    });

    it("does not mark inactive tabs as current", () => {
      mockUsePathname.mockReturnValue("/admin");

      render(
        <AdminLayoutContent>
          <p>{"Content"}</p>
        </AdminLayoutContent>,
      );

      expect(screen.getByRole("link", { name: "Users" })).not.toHaveAttribute("aria-current");
    });
  });

  describe("Edit navigation", () => {
    it("shows the Edit label on user edit pages", () => {
      mockUsePathname.mockReturnValue("/admin/users/123/edit");

      render(
        <AdminLayoutContent>
          <p>{"Edit user content"}</p>
        </AdminLayoutContent>,
      );

      expect(screen.getByText("Edit")).toBeInTheDocument();
    });

    it("does not show the Edit label on other pages", () => {
      mockUsePathname.mockReturnValue("/admin/users");

      render(
        <AdminLayoutContent>
          <p>Users content</p>
        </AdminLayoutContent>,
      );

      expect(screen.queryByText("Edit")).not.toBeInTheDocument();
    });

    it("renders Edit as text rather than a navigation link", () => {
      mockUsePathname.mockReturnValue("/admin/users/123/edit");

      render(
        <AdminLayoutContent>
          <p>{"Edit user content"}</p>
        </AdminLayoutContent>,
      );

      expect(screen.queryByRole("link", { name: "Edit" })).not.toBeInTheDocument();

      expect(screen.getByText("Edit")).toBeInTheDocument();
    });
  });
  it("highlights Edit on user edit pages", () => {
    mockUsePathname.mockReturnValue("/admin/users/123/edit");

    render(
      <AdminLayoutContent>
        <p>{"Content"}</p>
      </AdminLayoutContent>,
    );

    expect(screen.getByText("Edit")).toHaveAttribute("aria-current", "page");

    expect(screen.getByRole("link", { name: "Users" })).not.toHaveAttribute("aria-current");

    expect(screen.getByRole("link", { name: "Rules" })).not.toHaveAttribute("aria-current");
  });
});
