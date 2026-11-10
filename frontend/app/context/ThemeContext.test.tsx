import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ThemeProvider, useTheme } from "./ThemeContext";

function TestComponent() {
  const { theme, toggleTheme } = useTheme();
  return <button onClick={toggleTheme}>{theme}</button>;
}

function mockMatchMedia(prefersDark: boolean) {
  window.matchMedia = jest.fn().mockImplementation((query: string) => ({
    matches: prefersDark,
    media: query,
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
  }));
}

function renderWithProvider() {
  return render(
    <ThemeProvider>
      <TestComponent />
    </ThemeProvider>,
  );
}

describe("ThemeProvider", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.classList.remove("dark");
    mockMatchMedia(false);
  });

  it("defaults to light when there is no saved theme and the OS is light", () => {
    renderWithProvider();

    expect(screen.getByRole("button")).toHaveTextContent("light");
    expect(document.documentElement).not.toHaveClass("dark");
  });

  it("falls back to dark when the OS prefers dark", () => {
    mockMatchMedia(true);
    renderWithProvider();

    expect(screen.getByRole("button")).toHaveTextContent("dark");
    expect(document.documentElement).toHaveClass("dark");
  });

  it("toggles the theme, the dark class, and localStorage", async () => {
    const user = userEvent.setup();
    renderWithProvider();
    const button = screen.getByRole("button");

    await user.click(button);
    expect(button).toHaveTextContent("dark");
    expect(document.documentElement).toHaveClass("dark");
    expect(localStorage.getItem("theme")).toBe("dark");

    await user.click(button);
    expect(button).toHaveTextContent("light");
    expect(document.documentElement).not.toHaveClass("dark");
    expect(localStorage.getItem("theme")).toBe("light");
  });

  it("throws if useTheme is used outside a ThemeProvider", () => {
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});

    expect(() => render(<TestComponent />)).toThrow("useTheme must be used inside a ThemeProvider");

    spy.mockRestore();
  });
});
