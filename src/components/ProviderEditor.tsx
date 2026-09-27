import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { AppError, ProviderInfo, ProviderInput, ProviderApi, FetchedModels } from "../lib/types";
import { PROVIDER_PRESETS } from "../lib/providerCatalog";
import { Dialog } from "./Dialog";
import { Button, Field, Select } from "./primitives";
import { ImeSafeInput } from "./ImeSafeInput";
import { ProviderModelsTable } from "./ProviderModelsTable";

export interface ProviderEditorProps {
  open: boolean;
  initial: ProviderInfo | null;
  prefillId?: string;
  onClose: () => void;
  onSave: (input: ProviderInput) => Promise<void>;
  onSetKey: (id: string, key: string) => Promise<void>;
  onClearKey: (id: string) => Promise<void>;
  onFetchModels: (id: string) => Promise<FetchedModels>;
  error?: AppError | null;
}

interface Draft {
  id: string;
  name: string;
  baseUrl: string;
  api: ProviderApi;
  models: ProviderInput["models"];
  inlineKey: boolean;
}

function draftOf(initial: ProviderInfo | null, prefillId?: string): Draft {
  if (initial !== null) {
    return {
      id: initial.id,
      name: initial.name,
      baseUrl: initial.baseUrl,
      api: initial.api,
      models: initial.models,
      inlineKey: initial.inlineKey,
    };
  }
  const preset = prefillId ? PROVIDER_PRESETS.find((p) => p.id === prefillId) : null;
  if (preset) {
    return {
      id: preset.id,
      name: preset.displayName,
      baseUrl: preset.baseUrl,
      api: preset.api,
      models: preset.defaultModels.map((id) => ({ id })),
      inlineKey: false,
    };
  }
  return {
    id: "",
    name: "",
    baseUrl: "",
    api: "openai-completions",
    models: [],
    inlineKey: false,
  };
}

export function ProviderEditor({
  open,
  initial,
  prefillId,
  onClose,
  onSave,
  onSetKey,
  onClearKey,
  onFetchModels,
  error,
}: ProviderEditorProps) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<Draft>(() => draftOf(initial, prefillId));
  const [keyInput, setKeyInput] = useState("");
  const [fetched, setFetched] = useState<string[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [keyOperating, setKeyOperating] = useState(false);

  useEffect(() => {
    if (open) {
      setDraft(draftOf(initial, prefillId));
      setKeyInput("");
      setFetched(null);
    }
  }, [open, initial, prefillId]);

  function mutate(next: Partial<Draft>): void {
    setDraft((current) => ({ ...current, ...next }));
  }

  function selectPreset(presetId: string): void {
    if (initial !== null) return;
    const preset = PROVIDER_PRESETS.find((p) => p.id === presetId);
    if (!preset) return;
    mutate({
      id: preset.id,
      name: preset.displayName,
      baseUrl: preset.baseUrl,
      api: preset.api,
      models: preset.defaultModels.map((id) => ({ id })),
    });
  }

  async function handleSave(): Promise<void> {
    setSaving(true);
    try {
      await onSave({
        id: draft.id,
        name: draft.name,
        baseUrl: draft.baseUrl,
        api: draft.api,
        models: draft.models,
        inlineKey: draft.inlineKey,
      });
    } finally {
      setSaving(false);
    }
  }

  async function handleSetKey(): Promise<void> {
    if (!initial || keyInput.trim() === "") return;
    setKeyOperating(true);
    try {
      await onSetKey(initial.id, keyInput.trim());
      setKeyInput("");
    } finally {
      setKeyOperating(false);
    }
  }

  async function handleClearKey(): Promise<void> {
    if (!initial) return;
    setKeyOperating(true);
    try {
      await onClearKey(initial.id);
    } finally {
      setKeyOperating(false);
    }
  }

  async function handleFetchModels(): Promise<void> {
    if (!initial) return;
    try {
      const result = await onFetchModels(initial.id);
      setFetched(result.ids);
    } catch {
      setFetched([]);
    }
  }

  if (!open) return null;

  const providerExists = initial !== null;
  const hasKeySet = initial?.hasKey ?? false;

  return (
    <Dialog
      title={initial ? t("provider.edit") : t("provider.add")}
      onClose={onClose}
      wide
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            variant="primary"
            onClick={handleSave}
            disabled={saving || draft.id.trim() === "" || draft.baseUrl.trim() === ""}
            data-testid="provider-save"
          >
            {t("common.save")}
          </Button>
        </>
      }
    >
      <div data-testid="provider-editor" className="flex flex-col gap-4">
        {error && (
          <div role="alert" className="rounded-md bg-bad-500/15 px-3 py-2 text-sm text-bad-500">
            {error.message}
          </div>
        )}

        {!providerExists && (
          <Field label={t("provider.preset")}>
            {(field) => (
              <Select
                {...field}
                value=""
                onChange={(e) => selectPreset(e.target.value)}
                data-testid="provider-preset"
              >
                <option value="">{t("provider.presetCustom")}</option>
                {PROVIDER_PRESETS.map((preset) => (
                  <option key={preset.id} value={preset.id}>
                    {preset.displayName}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("provider.id")}>
            {(field) => (
              <ImeSafeInput
                {...field}
                value={draft.id}
                onCommit={(value) => mutate({ id: value })}
                disabled={providerExists}
                className="font-mono text-xs"
                data-testid="provider-id"
              />
            )}
          </Field>
          <Field label={t("provider.name")}>
            {(field) => (
              <ImeSafeInput
                {...field}
                value={draft.name}
                onCommit={(value) => mutate({ name: value })}
                data-testid="provider-name"
              />
            )}
          </Field>
        </div>

        <Field label={t("provider.baseUrl")}>
          {(field) => (
            <ImeSafeInput
              {...field}
              value={draft.baseUrl}
              onCommit={(value) => mutate({ baseUrl: value })}
              className="font-mono text-xs"
              data-testid="provider-baseurl"
            />
          )}
        </Field>

        <Field label={t("provider.api")}>
          {(field) => (
            <Select
              {...field}
              value={draft.api}
              onChange={(e) => mutate({ api: e.target.value as ProviderApi })}
              data-testid="provider-api"
            >
              <option value="openai-completions">openai-completions</option>
              <option value="openai-responses">openai-responses</option>
              <option value="anthropic-messages">anthropic-messages</option>
            </Select>
          )}
        </Field>

        <label className="flex items-center gap-2 text-sm text-ink-800 dark:text-ink-100">
          <input
            type="checkbox"
            checked={draft.inlineKey}
            onChange={(e) => mutate({ inlineKey: e.target.checked })}
            className="size-4 rounded border-ink-300 text-accent-500 focus:ring-2 focus:ring-accent-500 dark:border-ink-700 dark:focus:ring-accent-400"
            data-testid="provider-inline-key"
          />
          <span>{t("provider.inlineKey")}</span>
        </label>
        {draft.inlineKey && (
          <p className="text-xs text-warn-500">{t("provider.inlineKeyWarning")}</p>
        )}

        <div className="rounded-md border border-ink-200 p-3 dark:border-ink-800">
          <Field label={t("provider.key")}>
            {(field) => (
              <input
                {...field}
                type="password"
                autoComplete="off"
                value={keyInput}
                onChange={(e) => setKeyInput(e.target.value)}
                placeholder={t("provider.keyPlaceholder")}
                disabled={!providerExists || keyOperating}
                className="w-full rounded-md bg-ink-50 px-2.5 py-1.5 text-sm text-ink-800 ring-1 ring-ink-200 transition-colors duration-150 ease-ui placeholder:text-ink-400 hover:ring-ink-300 focus:outline-none focus:ring-2 focus:ring-accent-500 disabled:opacity-60 dark:bg-ink-900 dark:text-ink-100 dark:ring-ink-700 dark:placeholder:text-ink-500 dark:hover:ring-ink-600 dark:focus:ring-accent-400"
                data-testid="provider-key-input"
              />
            )}
          </Field>
          {hasKeySet && (
            <p className="mt-1 text-xs text-ink-500 dark:text-ink-400">
              {t("provider.keySet")}
            </p>
          )}
          <div className="mt-2 flex gap-2">
            <Button
              size="sm"
              onClick={handleSetKey}
              disabled={!providerExists || keyInput.trim() === "" || keyOperating}
              data-testid="provider-key-save"
            >
              {t("provider.saveKey")}
            </Button>
            <Button
              size="sm"
              variant="danger"
              onClick={handleClearKey}
              disabled={!providerExists || !hasKeySet || keyOperating}
              data-testid="provider-key-clear"
            >
              {t("provider.clearKey")}
            </Button>
          </div>
        </div>

        <div>
          <div className="mb-2 flex items-center gap-2">
            <Button
              size="sm"
              onClick={handleFetchModels}
              disabled={!providerExists}
              data-testid="provider-fetch-models"
            >
              {t("provider.fetchModels")}
            </Button>
          </div>
          <ProviderModelsTable
            models={draft.models}
            onChange={(models) => mutate({ models })}
            fetched={fetched}
          />
        </div>
      </div>
    </Dialog>
  );
}
