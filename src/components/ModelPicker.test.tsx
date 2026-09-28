import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { initI18n } from "../i18n";
import { seedModels } from "../lib/mockData";
import type { ModelInfo } from "../lib/types";
import { MODEL_PICKER_LIMIT, ModelPicker } from "./ModelPicker";

beforeAll(() => {
  initI18n();
});

function renderPicker(value: string, models: readonly ModelInfo[] = seedModels()) {
  const onChange = vi.fn();
  const onRefresh = vi.fn().mockResolvedValue(undefined);
  render(
    <ModelPicker
      id="picker"
      value={value}
      models={models}
      providers={[]}
      omoAvailable
      onChange={onChange}
      onRefresh={onRefresh}
    />,
  );
  const input = screen.getByRole("combobox");
  return { input, onChange, onRefresh };
}

describe("ModelPicker", () => {
  it("shows every option on open even when a value is already set", () => {
    const { input } = renderPicker("openai/gpt-6-mini");

    act(() => input.focus());

    const options = within(screen.getByRole("listbox")).getAllByRole("option");
    expect(options).toHaveLength(30);
    const selected = options.filter((option) => option.getAttribute("aria-selected") === "true");
    expect(selected.map((option) => option.textContent)).toEqual([expect.stringContaining("openai/gpt-6-mini")]);
    expect(input.getAttribute("aria-activedescendant")).toBe(selected[0]?.id);
  });

  it("filters by what the user types after opening", () => {
    const { input } = renderPicker("openai/gpt-6-mini");
    act(() => input.focus());

    fireEvent.input(input, { target: { value: "claude-opus" } });

    const options = within(screen.getByRole("listbox")).getAllByRole("option");
    expect(options).toHaveLength(6);
    for (const option of options) expect(option.textContent).toContain("claude-opus");
  });

  it("caps the list and reports the total when truncated", () => {
    const many: ModelInfo[] = Array.from({ length: MODEL_PICKER_LIMIT + 50 }, (_, index) => ({
      id: `acme/model-${index}`,
      provider: "acme",
      model: `model-${index}`,
      context: null,
      maxOut: null,
      thinking: false,
      images: false,
    }));
    const { input } = renderPicker("", many);

    act(() => input.focus());

    expect(within(screen.getByRole("listbox")).getAllByRole("option")).toHaveLength(MODEL_PICKER_LIMIT);
    expect(screen.getByTestId("model-picker-count").textContent).toContain(String(MODEL_PICKER_LIMIT + 50));
  });

  it("marks the refresh button busy until the refresh settles", async () => {
    let settle: () => void = () => undefined;
    const onRefresh = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          settle = resolve;
        }),
    );
    render(
      <ModelPicker
        id="picker"
        value=""
        models={seedModels()}
        providers={[]}
        omoAvailable
        onChange={vi.fn()}
        onRefresh={onRefresh}
      />,
    );
    const button = screen.getByRole("button", { name: "一覧を再取得" });

    fireEvent.click(button);

    const busy = screen.getByRole("button", { name: "取得中…" });
    expect(busy).toHaveProperty("disabled", true);
    expect(busy.getAttribute("aria-busy")).toBe("true");
    await act(async () => settle());
    expect(screen.getByRole("button", { name: "一覧を再取得" })).toHaveProperty("disabled", false);
  });
});
