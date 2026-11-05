import { render, screen } from "@testing-library/react";
import PageHeader from "./PageHeader";

describe("PageHeader", () => {
  it("renders the page title", () => {
    render(<PageHeader title="Properties" hasCta={false} />);

    const heading = screen.getByRole("heading", {
      level: 1,
      name: "Properties",
    });

    expect(heading).toBeInTheDocument();
  });

  it("renders the CTA when hasCta is true", () => {
    render(<PageHeader title="Properties" hasCta={true} />);

    const link = screen.getByRole("link", { name: /add new/i });

    expect(link).toBeInTheDocument();
  });

  it("does not render the CTA when hasCta is false", () => {
    render(<PageHeader title="Properties" hasCta={false} />);

    const link = screen.queryByRole("link", { name: /add new/i });

    expect(link).not.toBeInTheDocument();
  });

  it("renders a custom CTA text when provided", () => {
    const ctaText = "Add Property";

    render(<PageHeader title="Properties" hasCta={true} ctaText={ctaText} />);

    expect(screen.getByRole("link", { name: ctaText })).toBeInTheDocument();
  });

  it("uses the default CTA text when ctaText is not provided", () => {
    render(<PageHeader title="Properties" hasCta={true} />);

    expect(screen.getByRole("link", { name: /add new/i })).toBeInTheDocument();
  });

  it("links to the new property page", () => {
    render(<PageHeader title="Properties" hasCta={true} />);

    const link = screen.getByRole("link", { name: /add new/i });

    expect(link).toHaveAttribute("href", "/properties/new");
  });
});
