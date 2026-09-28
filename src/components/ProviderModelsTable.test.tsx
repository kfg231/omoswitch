import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ProviderModelsTable } from "./ProviderModelsTable";
import type { ProviderModel } from "../lib/types";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const translations: Record<string, string> = {
        "provider.models": "Models",
        "provider.addModel": "Add model",
        "provider.noModels": "No models configured",
        "provider.modelId": "Model ID",
        "provider.modelName": "Model name",
        "common.remove": "Remove",
        "provider.fetchedModels": "Select models to add",
        "provider.addSelected": "Add selected",
      };
      return translations[key] || key;
    },
  }),
}));

describe("ProviderModelsTable", () => {
  it("renders stable row keys when editing model id via ImeSafeInput blur", () => {
    const onChange = vi.fn();
    const models: ProviderModel[] = [{ id: "model-1" }, { id: "model-2" }];

    render(<ProviderModelsTable models={models} onChange={onChange} />);

    const inputs = screen.getAllByTestId("model-id-input");
    const firstInput = inputs[0] as HTMLInputElement;

    fireEvent.change(firstInput, { target: { value: "model-1-edited" } });

    const inputBeforeBlur = firstInput;
    fireEvent.blur(firstInput);

    const inputsAfterBlur = screen.getAllByTestId("model-id-input");
    const firstInputAfterBlur = inputsAfterBlur[0];

    expect(inputBeforeBlur).toBe(firstInputAfterBlur);
    expect(onChange).toHaveBeenCalledWith([{ id: "model-1-edited" }, { id: "model-2" }]);
  });

  it("merges fetched models without duplicates when adding selected", () => {
    const onChange = vi.fn();
    const models: ProviderModel[] = [{ id: "existing-1" }];
    const fetched = ["existing-1", "new-1", "new-2"];

    render(<ProviderModelsTable models={models} onChange={onChange} fetched={fetched} />);

    expect(screen.queryByTestId("fetched-model-existing-1")).toBeNull();

    const checkbox1 = screen.getByTestId("fetched-model-new-1") as HTMLInputElement;
    const checkbox2 = screen.getByTestId("fetched-model-new-2") as HTMLInputElement;

    fireEvent.click(checkbox1);
    fireEvent.click(checkbox2);

    const addButton = screen.getByTestId("fetched-add");
    fireEvent.click(addButton);

    expect(onChange).toHaveBeenCalledWith([
      { id: "existing-1" },
      { id: "new-1" },
      { id: "new-2" },
    ]);
  });

  it("calls onChange without the removed model when remove button is clicked", () => {
    const onChange = vi.fn();
    const models: ProviderModel[] = [{ id: "model-1" }, { id: "model-2" }, { id: "model-3" }];

    render(<ProviderModelsTable models={models} onChange={onChange} />);

    const removeButtons = screen.getAllByTestId("model-remove");
    fireEvent.click(removeButtons[1]);

    expect(onChange).toHaveBeenCalledWith([{ id: "model-1" }, { id: "model-3" }]);
  });

  it("adds a new empty row when add button is clicked", () => {
    const onChange = vi.fn();
    const models: ProviderModel[] = [{ id: "model-1" }];

    render(<ProviderModelsTable models={models} onChange={onChange} />);

    const addButton = screen.getByTestId("model-add");
    fireEvent.click(addButton);

    expect(onChange).toHaveBeenCalledWith([{ id: "model-1" }, { id: "" }]);
  });

  it("updates model name via ImeSafeInput", () => {
    const onChange = vi.fn();
    const models: ProviderModel[] = [{ id: "model-1", name: "Original Name" }];

    render(<ProviderModelsTable models={models} onChange={onChange} />);

    const nameInput = screen.getByTestId("model-name-input") as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: "Updated Name" } });
    fireEvent.blur(nameInput);

    expect(onChange).toHaveBeenCalledWith([{ id: "model-1", name: "Updated Name" }]);
  });

  it("shows empty state when no models", () => {
    const onChange = vi.fn();
    render(<ProviderModelsTable models={[]} onChange={onChange} />);

    expect(screen.getByText("No models configured")).toBeTruthy();
  });

  it("does not show fetched section when fetched is null", () => {
    const onChange = vi.fn();
    render(<ProviderModelsTable models={[]} onChange={onChange} fetched={null} />);

    expect(screen.queryByText("Select models to add")).toBeNull();
  });
});

function lastModels(onChange: ReturnType<typeof vi.fn>): ProviderModel[] {
  const calls = onChange.mock.calls;
  return calls[calls.length - 1]![0] as ProviderModel[];
}

function commit(element: HTMLElement, value: string): void {
  fireEvent.focus(element);
  fireEvent.change(element, { target: { value } });
  fireEvent.blur(element);
}

describe("ProviderModelsTable model details", () => {
  it("writes contextWindow as a number and removes the key when cleared", () => {
    const onChange = vi.fn();
    render(<ProviderModelsTable models={[{ id: "m", maxTokens: 8192 }]} onChange={onChange} />);
    const context = screen.getByTestId("model-context-input");

    commit(context, "1000000");
    expect(lastModels(onChange)).toEqual([{ id: "m", maxTokens: 8192, contextWindow: 1000000 }]);

    commit(context, "");
    expect(lastModels(onChange)).toEqual([{ id: "m", maxTokens: 8192 }]);
    expect("contextWindow" in lastModels(onChange)[0]!).toBe(false);
  });

  it("blocks save with an inline error for a non-positive or non-integer number", () => {
    const onChange = vi.fn();
    const onValidityChange = vi.fn();
    render(
      <ProviderModelsTable
        models={[{ id: "m", contextWindow: 64000 }]}
        onChange={onChange}
        onValidityChange={onValidityChange}
      />,
    );
    const maxTokens = screen.getByTestId("model-max-tokens-input");

    commit(maxTokens, "1.5");
    expect(onChange).not.toHaveBeenCalled();
    expect(onValidityChange).toHaveBeenLastCalledWith(false);
    expect(screen.getByRole("alert").textContent).toBe("provider.countInvalid");
    expect((maxTokens as HTMLInputElement).value).toBe("1.5");

    commit(maxTokens, "0");
    expect(onValidityChange).toHaveBeenLastCalledWith(false);

    commit(maxTokens, "32000");
    expect(onValidityChange).toHaveBeenLastCalledWith(true);
    expect(lastModels(onChange)).toEqual([{ id: "m", contextWindow: 64000, maxTokens: 32000 }]);
  });

  it("disables level chips until reasoning is on", () => {
    render(<ProviderModelsTable models={[{ id: "m" }]} onChange={vi.fn()} />);
    expect((screen.getByTestId("model-effort-low") as HTMLInputElement).disabled).toBe(true);
  });

  it("writes thinkingLevelMap: null hides standard levels, strings enable xhigh/max, reset removes the map", () => {
    const onChange = vi.fn();
    render(<ProviderModelsTable models={[{ id: "m", reasoning: true }]} onChange={onChange} />);

    fireEvent.click(screen.getByTestId("model-effort-minimal"));
    expect(lastModels(onChange)).toEqual([{ id: "m", reasoning: true, thinkingLevelMap: { minimal: null } }]);

    fireEvent.click(screen.getByTestId("model-effort-max"));
    expect(lastModels(onChange)[0]!.thinkingLevelMap).toEqual({ minimal: null, max: "max" });

    fireEvent.click(screen.getByTestId("model-effort-minimal"));
    expect(lastModels(onChange)[0]!.thinkingLevelMap).toEqual({ max: "max" });

    fireEvent.click(screen.getByTestId("model-levels-reset"));
    expect(lastModels(onChange)).toEqual([{ id: "m", reasoning: true }]);
  });

  it("toggles input modalities in order and omits input when empty", () => {
    const onChange = vi.fn();
    render(<ProviderModelsTable models={[{ id: "m" }]} onChange={onChange} />);

    fireEvent.click(screen.getByTestId("model-input-image"));
    fireEvent.click(screen.getByTestId("model-input-text"));
    expect(lastModels(onChange)).toEqual([{ id: "m", input: ["text", "image"] }]);

    fireEvent.click(screen.getByTestId("model-input-text"));
    fireEvent.click(screen.getByTestId("model-input-image"));
    expect(lastModels(onChange)).toEqual([{ id: "m" }]);
  });

  it("adds and removes a custom field, parsing JSON values", () => {
    const onChange = vi.fn();
    render(<ProviderModelsTable models={[{ id: "m" }]} onChange={onChange} />);

    commit(screen.getByTestId("model-extra-new-key"), "cost");
    commit(screen.getByTestId("model-extra-new-value"), '{"input": 0.5}');
    fireEvent.click(screen.getByTestId("model-extra-add"));
    expect(lastModels(onChange)).toEqual([{ id: "m", cost: { input: 0.5 } }]);
    expect((screen.getByTestId("model-extra-value") as HTMLInputElement).value).toBe('{"input":0.5}');

    commit(screen.getByTestId("model-extra-value"), "plain text");
    expect(lastModels(onChange)).toEqual([{ id: "m", cost: "plain text" }]);

    fireEvent.click(screen.getByTestId("model-extra-remove"));
    expect(lastModels(onChange)).toEqual([{ id: "m" }]);
  });

  it("rejects managed keys and malformed JSON-looking values", () => {
    const onChange = vi.fn();
    render(<ProviderModelsTable models={[{ id: "m" }]} onChange={onChange} />);

    commit(screen.getByTestId("model-extra-new-key"), "contextWindow");
    commit(screen.getByTestId("model-extra-new-value"), "1");
    fireEvent.click(screen.getByTestId("model-extra-add"));
    expect(screen.getByRole("alert").textContent).toBe("provider.customKeyManaged");

    commit(screen.getByTestId("model-extra-new-key"), "compat");
    commit(screen.getByTestId("model-extra-new-value"), "{broken");
    fireEvent.click(screen.getByTestId("model-extra-add"));
    expect(screen.getByRole("alert").textContent).toBe("provider.customValueInvalid");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("preserves unknown extras untouched when editing other fields", () => {
    const onChange = vi.fn();
    const headers = { Authorization: "<redacted>" };
    const cost = { input: 0.27, output: 1.1 };
    render(<ProviderModelsTable models={[{ id: "m", cost, headers }]} onChange={onChange} />);

    commit(screen.getByTestId("model-context-input"), "128000");
    const [model] = lastModels(onChange);
    expect(model).toEqual({ id: "m", cost, headers, contextWindow: 128000 });
    expect(model!["cost"]).toBe(cost);
    expect(model!["headers"]).toBe(headers);
  });

  it("starts merged fetched models with no details", () => {
    const onChange = vi.fn();
    render(
      <ProviderModelsTable
        models={[{ id: "a", contextWindow: 1000, input: ["text"] }]}
        onChange={onChange}
        fetched={["a", "b"]}
      />,
    );
    fireEvent.click(screen.getByTestId("fetched-model-b"));
    fireEvent.click(screen.getByTestId("fetched-add"));
    expect(lastModels(onChange)).toEqual([{ id: "a", contextWindow: 1000, input: ["text"] }, { id: "b" }]);
  });
});
