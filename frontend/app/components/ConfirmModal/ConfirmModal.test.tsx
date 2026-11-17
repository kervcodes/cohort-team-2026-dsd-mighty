import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import ConfirmModal from "./ConfirmModal";

const BODY_TEXT = "Body text";

const onConfirm = jest.fn();
const onCancel = jest.fn();

function renderModal(props: Partial<ComponentProps<typeof ConfirmModal>> = {}) {
  return render(
    <ConfirmModal
      open
      title="Save approval rules?"
      onConfirm={onConfirm}
      onCancel={onCancel}
      {...props}
    >
      <p>{BODY_TEXT}</p>
    </ConfirmModal>,
  );
}

describe("ConfirmModal", () => {
  beforeEach(() => {
    onConfirm.mockClear();
    onCancel.mockClear();
  });

  describe("rendering", () => {
    it("renders nothing when closed", () => {
      renderModal({ open: false });
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    it("renders an accessible dialog with title and children when open", () => {
      renderModal();
      expect(screen.getByRole("dialog", { name: "Save approval rules?" })).toBeInTheDocument();
      expect(screen.getByText(BODY_TEXT)).toBeInTheDocument();
    });

    it("uses 'Confirm' as the default confirm label", () => {
      renderModal();
      expect(screen.getByRole("button", { name: "Confirm" })).toBeInTheDocument();
    });

    it("uses a custom confirm label", () => {
      renderModal({ confirmLabel: "Save changes" });
      expect(screen.getByRole("button", { name: "Save changes" })).toBeInTheDocument();
    });
  });

  describe("actions", () => {
    it("calls onConfirm when the confirm button is clicked", async () => {
      renderModal();
      await userEvent.click(screen.getByRole("button", { name: "Confirm" }));
      expect(onConfirm).toHaveBeenCalledTimes(1);
      expect(onCancel).not.toHaveBeenCalled();
    });

    it("calls onCancel when Cancel is clicked", async () => {
      renderModal();
      await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
      expect(onCancel).toHaveBeenCalledTimes(1);
      expect(onConfirm).not.toHaveBeenCalled();
    });

    it("calls onCancel when the backdrop is clicked", async () => {
      renderModal();
      await userEvent.click(screen.getByLabelText("Close dialog"));
      expect(onCancel).toHaveBeenCalledTimes(1);
    });
  });

  describe("keyboard", () => {
    it("calls onCancel when Escape is pressed", async () => {
      renderModal();
      await userEvent.keyboard("{Escape}");
      expect(onCancel).toHaveBeenCalledTimes(1);
    });

    it("does not listen for Escape while closed", async () => {
      renderModal({ open: false });
      await userEvent.keyboard("{Escape}");
      expect(onCancel).not.toHaveBeenCalled();
    });
  });
});
