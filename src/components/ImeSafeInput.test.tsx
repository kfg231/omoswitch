import { act, render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ImeSafeInput } from "./ImeSafeInput";

describe("ImeSafeInput", () => {
  it("does not commit during composition", async () => {
    const onCommit = vi.fn();
    render(<ImeSafeInput value="" onCommit={onCommit} aria-label="test-input" />);
    const input = screen.getByLabelText("test-input") as HTMLInputElement;

    fireEvent.compositionStart(input);
    fireEvent.change(input, { target: { value: "あ" } });
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("commits exactly once after compositionend and blur", async () => {
    const onCommit = vi.fn();
    render(<ImeSafeInput value="" onCommit={onCommit} aria-label="test-input" />);
    const input = screen.getByLabelText("test-input") as HTMLInputElement;

    fireEvent.compositionStart(input);
    fireEvent.change(input, { target: { value: "テスト" } });
    fireEvent.compositionEnd(input);
    fireEvent.blur(input);

    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith("テスト");
  });

  it("does not commit on Enter during composition", async () => {
    const onCommit = vi.fn();
    render(<ImeSafeInput value="" onCommit={onCommit} aria-label="test-input" />);
    const input = screen.getByLabelText("test-input") as HTMLInputElement;

    fireEvent.compositionStart(input);
    fireEvent.change(input, { target: { value: "あ" } });
    fireEvent.keyDown(input, { key: "Enter", code: "Enter", isComposing: true });

    expect(onCommit).not.toHaveBeenCalled();
  });

  it("retains focus across parent re-render", async () => {
    const onCommit = vi.fn();
    const { rerender } = render(<ImeSafeInput value="" onCommit={onCommit} aria-label="test-input" />);
    const input = screen.getByLabelText("test-input") as HTMLInputElement;

    // fireEvent.focus does not move document.activeElement in jsdom; focus() does.
    act(() => input.focus());
    expect(document.activeElement).toBe(input);

    rerender(<ImeSafeInput value="" onCommit={onCommit} aria-label="test-input" className="changed" />);
    expect(document.activeElement).toBe(input);
  });

  it("does not clobber draft on external value change while focused", async () => {
    const onCommit = vi.fn();
    const { rerender } = render(<ImeSafeInput value="" onCommit={onCommit} aria-label="test-input" />);
    const input = screen.getByLabelText("test-input") as HTMLInputElement;

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "draft" } });
    expect(input.value).toBe("draft");

    rerender(<ImeSafeInput value="external" onCommit={onCommit} aria-label="test-input" />);
    expect(input.value).toBe("draft");

    fireEvent.blur(input);
    expect(onCommit).toHaveBeenCalledWith("draft");
  });
});
