import { render, screen } from "@testing-library/react";
import PageHeader from "./PageHeader";

describe("PageHeader", () => {
  it("renders the page title as an h1 heading", () => {
    render(<PageHeader title="Properties" hasCta={false} />);

    const heading = screen.getByRole("heading", {
      level: 1,
      name: "Properties",
    });

    expect(heading).toBeInTheDocument();
  });

  it("renders the CTA when hasCta is true", () => {
    render(
      <PageHeader
        title="Properties"
        hasCta={true}
        ctaText="Add Property"
        ctaLink="/properties/new"
      />,
    );

    expect(screen.getByRole("link", { name: "Add Property" })).toBeInTheDocument();
  });

  it("does not render the CTA when hasCta is false", () => {
    render(<PageHeader title="Properties" hasCta={false} />);

    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("renders the provided CTA text", () => {
    const ctaText = "Add Property";

    render(
      <PageHeader title="Properties" hasCta={true} ctaText={ctaText} ctaLink="/properties/new" />,
    );

    expect(screen.getByRole("link", { name: ctaText })).toBeInTheDocument();
  });

  it("links to the provided CTA destination", () => {
    const ctaLink = "/properties/new";

    render(
      <PageHeader title="Properties" hasCta={true} ctaText="Add Property" ctaLink={ctaLink} />,
    );

    const link = screen.getByRole("link", {
      name: "Add Property",
    });

    expect(link).toHaveAttribute("href", ctaLink);
  });
});
