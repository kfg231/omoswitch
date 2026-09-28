import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ProviderEditor } from "./ProviderEditor";
import type { ProviderInfo } from "../lib/types";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const translations: Record<string, string> = {
        "provider.edit": "Edit provider",
        "provider.add": "Add provider",
        "common.cancel": "Cancel",
        "common.save": "Save",
        "provider.preset": "Preset",
        "provider.presetCustom": "Custom",
        "provider.id": "ID",
        "provider.name": "Name",
        "provider.baseUrl": "Base URL",
        "provider.api": "API",
        "provider.inlineKey": "Store key inline in models.json",
        "provider.inlineKeyWarning": "API key will be stored in plaintext in models.json.",
        "provider.key": "API key",
        "provider.keyPlaceholder": "Enter API key (it will not be shown again)",
        "provider.keySet": "Key set",
        "provider.saveKey": "Save key",
        "provider.clearKey": "Clear key",
        "provider.fetchModels": "Fetch model list",
      };
      return translations[key] || key;
    },
  }),
}));

describe("ProviderEditor", () => {
  it("uses type=password for key input and never exposes key in textContent", async () => {
    const onClose = vi.fn();
    const onSave = vi.fn();
    const onSetKey = vi.fn().mockResolvedValue(undefined);
    const onClearKey = vi.fn();
    const onFetchModels = vi.fn();

    const provider: ProviderInfo = {
      id: "test-provider",
      name: "Test Provider",
      baseUrl: "https://api.test.com",
      api: "openai-completions",
      models: [],
      enabled: true,
      hasKey: false,
      keySource: "none",
      inlineKey: false,
      knownToOmo: false,
    };

    const { container } = render(
      <ProviderEditor
        open={true}
        initial={provider}
        onClose={onClose}
        onSave={onSave}
        onSetKey={onSetKey}
        onClearKey={onClearKey}
        onFetchModels={onFetchModels}
        onGetJson={vi.fn()}
        onSaveJson={vi.fn()}
      />
    );

    const keyInput = screen.getByTestId("provider-key-input") as HTMLInputElement;
    expect(keyInput.type).toBe("password");

    fireEvent.change(keyInput, { target: { value: "TEST-NOT-A-REAL-KEY" } });
    expect(keyInput.value).toBe("TEST-NOT-A-REAL-KEY");

    const saveKeyButton = screen.getByTestId("provider-key-save");
    fireEvent.click(saveKeyButton);

    await vi.waitFor(() => {
      expect(keyInput.value).toBe("");
    });

    expect(container.textContent).not.toContain("TEST-NOT-A-REAL-KEY");
  });

  it("disables key operations when provider does not exist (initial is null)", () => {
    const onClose = vi.fn();
    const onSave = vi.fn();
    const onSetKey = vi.fn();
    const onClearKey = vi.fn();
    const onFetchModels = vi.fn();

    render(
      <ProviderEditor
        open={true}
        initial={null}
        onClose={onClose}
        onSave={onSave}
        onSetKey={onSetKey}
        onClearKey={onClearKey}
        onFetchModels={onFetchModels}
        onGetJson={vi.fn()}
        onSaveJson={vi.fn()}
      />
    );

    const keyInput = screen.getByTestId("provider-key-input") as HTMLInputElement;
    const saveKeyButton = screen.getByTestId("provider-key-save") as HTMLButtonElement;
    const clearKeyButton = screen.getByTestId("provider-key-clear") as HTMLButtonElement;
    const fetchModelsButton = screen.getByTestId("provider-fetch-models") as HTMLButtonElement;

    expect(keyInput.disabled).toBe(true);
    expect(saveKeyButton.disabled).toBe(true);
    expect(clearKeyButton.disabled).toBe(true);
    expect(fetchModelsButton.disabled).toBe(true);
  });
});
