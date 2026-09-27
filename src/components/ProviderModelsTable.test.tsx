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
