import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import type { AppError, ProviderInfo, ProviderInput, ProviderApi, FetchedModels, ProviderJson } from "../lib/types";
import { PROVIDER_PRESETS } from "../lib/providerCatalog";
import { Dialog } from "./Dialog";
import { Button, Field, Select, TextArea } from "./primitives";
import { ImeSafeInput } from "./ImeSafeInput";
import { ProviderModelsTable } from "./ProviderModelsTable";

export interface ProviderEditorProps {
  open: boolean;
  initial: ProviderInfo | null;
  prefillId?: string;
  saved?: boolean;
  onClose: () => void;
  /** `key` is only passed for a provider that is not saved yet; it is stored right after the provider. */
  onSave: (input: ProviderInput, key?: string) => Promise<void>;
  onSetKey: (id: string, key: string) => Promise<void>;
  onClearKey: (id: string) => Promise<void>;
  onFetchModels: (id: string) => Promise<FetchedModels>;
  onGetJson: (id: string) => Promise<ProviderJson>;
  onSaveJson: (id: string, json: string) => Promise<void>;
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

type EditorTab = "form" | "json";
const TABS: readonly EditorTab[] = ["form", "json"];
type PendingAction = { kind: "tab"; tab: EditorTab } | { kind: "reload" };

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

export function previewJson(saved: string, draft: Draft): string {
  const parsed: unknown = JSON.parse(saved);
  const base = typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed : {};
  const next = { ...base, name: draft.name, baseUrl: draft.baseUrl, api: draft.api, models: draft.models };
  return JSON.stringify(next, null, 2);
}

export function ProviderEditor({
  open,
  initial,
  prefillId,
  saved = true,
  onClose,
  onSave,
  onSetKey,
  onClearKey,
  onFetchModels,
  onGetJson,
  onSaveJson,
  error,
}: ProviderEditorProps) {
  const { t } = useTranslation();
  const baseId = useId();
  const [draft, setDraft] = useState<Draft>(() => draftOf(initial, prefillId));
  const [keyInput, setKeyInput] = useState("");
  const [fetched, setFetched] = useState<string[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [keyOperating, setKeyOperating] = useState(false);
  const [modelsValid, setModelsValid] = useState(true);
  const [tab, setTab] = useState<EditorTab>("form");
  const [jsonText, setJsonText] = useState("");
  const [jsonBase, setJsonBase] = useState("");
  const [jsonBusy, setJsonBusy] = useState(false);
  const [jsonNotice, setJsonNotice] = useState(false);
  const [jsonParseError, setJsonParseError] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const composingRef = useRef(false);
  const tabRefs = useRef<Record<EditorTab, HTMLButtonElement | null>>({ form: null, json: null });

  useEffect(() => {
    if (open) {
      setDraft(draftOf(initial, prefillId));
      setKeyInput("");
      setFetched(null);
    }
  }, [open, initial, prefillId]);

  useEffect(() => {
    if (open) {
      setTab("form");
      setJsonText("");
      setJsonBase("");
      setJsonNotice(false);
      setJsonParseError(null);
      setPending(null);
    }
  }, [open]);

  function mutate(next: Partial<Draft>): void {
    setDraft((current) => ({ ...current, ...next }));
  }

  function syncDraftFromJson(json: string): void {
    const parsed: unknown = JSON.parse(json);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return;
    const value = parsed as Record<string, unknown>;
    const next: Partial<Draft> = {};
    if (typeof value["name"] === "string") next.name = value["name"];
    if (typeof value["baseUrl"] === "string") next.baseUrl = value["baseUrl"];
    if (value["api"] === "openai-completions" || value["api"] === "openai-responses" || value["api"] === "anthropic-messages") {
      next.api = value["api"];
    }
    if (Array.isArray(value["models"])) next.models = value["models"] as ProviderInput["models"];
    mutate(next);
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
    const pendingKey = keyInput.trim();
    try {
      await onSave(
        {
          id: draft.id,
          name: draft.name,
          baseUrl: draft.baseUrl,
          api: draft.api,
          models: draft.models,
          inlineKey: draft.inlineKey,
        },
        !persisted && pendingKey !== "" ? pendingKey : undefined,
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleSetKey(): Promise<void> {
    if (!initial || !persisted || keyInput.trim() === "") return;
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

  // A provider that exists in models.json. New providers and dead-reference placeholders do not,
  // so their key is collected here and stored together with the provider on save.
  const persisted = initial !== null && saved;
  const jsonAvailable = persisted;
  const jsonDirty = jsonText !== jsonBase;

  async function loadJson(): Promise<void> {
    if (initial === null) return;
    setJsonBusy(true);
    setJsonParseError(null);
    try {
      const result = await onGetJson(initial.id);
      const preview = previewJson(result.json, draft);
      setJsonText(preview);
      setJsonBase(preview);
    } catch {
      setJsonText("");
      setJsonBase("");
    } finally {
      setJsonBusy(false);
    }
  }

  function applyTab(next: EditorTab, focus: boolean): void {
    setTab(next);
    setJsonNotice(false);
    setJsonParseError(null);
    if (next === "json") void loadJson();
    if (focus) tabRefs.current[next]?.focus();
  }

  function requestTab(next: EditorTab, focus = false): void {
    if (next === tab) {
      if (focus) tabRefs.current[next]?.focus();
      return;
    }
    if (next === "json" && !jsonAvailable) return;
    if (tab === "json" && jsonDirty) {
      setPending({ kind: "tab", tab: next });
      return;
    }
    applyTab(next, focus);
  }

  function onTabKeyDown(event: KeyboardEvent<HTMLButtonElement>): void {
    const enabled = TABS.filter((item) => item === "form" || jsonAvailable);
    const focused = TABS.find((item) => tabRefs.current[item] === event.currentTarget) ?? tab;
    const index = Math.max(0, enabled.indexOf(focused));
    let next: EditorTab | undefined;
    if (event.key === "ArrowRight") next = enabled[(index + 1) % enabled.length];
    else if (event.key === "ArrowLeft") next = enabled[(index - 1 + enabled.length) % enabled.length];
    else if (event.key === "Home") next = enabled[0];
    else if (event.key === "End") next = enabled[enabled.length - 1];
    if (next === undefined) return;
    event.preventDefault();
    requestTab(next, true);
  }

  function requestReload(): void {
    if (jsonDirty) {
      setPending({ kind: "reload" });
      return;
    }
    setJsonNotice(false);
    void loadJson();
  }

  function confirmDiscard(): void {
    const action = pending;
    setPending(null);
    if (action === null) return;
    setJsonText(jsonBase);
    if (action.kind === "tab") {
      applyTab(action.tab, false);
    } else {
      setJsonNotice(false);
      void loadJson();
    }
  }

  function formatJson(): void {
    try {
      setJsonText(JSON.stringify(JSON.parse(jsonText), null, 2));
      setJsonParseError(null);
    } catch (cause) {
      setJsonParseError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  async function saveJson(): Promise<void> {
    if (initial === null) return;
    try {
      JSON.parse(jsonText);
    } catch (cause) {
      setJsonParseError(cause instanceof Error ? cause.message : String(cause));
      setJsonNotice(false);
      return;
    }
    setJsonBusy(true);
    setJsonParseError(null);
    try {
      await onSaveJson(initial.id, jsonText);
      const result = await onGetJson(initial.id);
      setJsonText(result.json);
      setJsonBase(result.json);
      syncDraftFromJson(result.json);
      setJsonNotice(true);
    } catch {
      setJsonNotice(false);
    } finally {
      setJsonBusy(false);
    }
  }

  if (!open) return null;

  const providerExists = initial !== null;
  const hasKeySet = initial?.hasKey ?? false;
  const unavailableId = `${baseId}-json-unavailable`;

  const tabClass = (item: EditorTab): string =>
    `rounded-md px-3 py-1 text-xs font-medium transition-colors duration-150 ease-ui focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 dark:focus-visible:ring-accent-400 aria-disabled:cursor-not-allowed aria-disabled:opacity-50 ${
      tab === item
        ? "bg-ink-50 text-ink-900 shadow-sm ring-1 ring-ink-200 dark:bg-ink-800 dark:text-ink-50 dark:ring-ink-700"
        : "text-ink-600 hover:bg-ink-200/70 dark:text-ink-300 dark:hover:bg-ink-800/60"
    }`;

  return (
    <Dialog
      title={initial ? t("provider.edit") : t("provider.add")}
      onClose={pending === null ? onClose : () => setPending(null)}
      wide
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          {tab === "form" ? (
            <Button
              variant="primary"
              onClick={handleSave}
              disabled={saving || !modelsValid || draft.id.trim() === "" || draft.baseUrl.trim() === ""}
              data-testid="provider-save"
            >
              {t("common.save")}
            </Button>
          ) : null}
        </>
      }
    >
      <div data-testid="provider-editor" className="flex flex-col gap-4">
        {error && (
          <div role="alert" className="rounded-md bg-bad-500/15 px-3 py-2 text-sm">
            <p className="text-bad-500">
              {t(`error.${error.kind}`, {
                line: error.line ?? 0,
                col: error.col ?? 0,
                key: error.key ?? "",
                field: error.field ?? "",
              })}
            </p>
            <p className="mt-0.5 font-mono text-micro break-all text-ink-500 dark:text-ink-400">{error.message}</p>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <div
            role="tablist"
            aria-label={t("provider.tabsLabel")}
            className="flex w-fit gap-1 rounded-lg bg-ink-100 p-1 ring-1 ring-ink-200 dark:bg-ink-950/60 dark:ring-ink-800"
          >
            {TABS.map((item) => {
              const disabled = item === "json" && !jsonAvailable;
              return (
                <button
                  key={item}
                  ref={(node) => {
                    tabRefs.current[item] = node;
                  }}
                  type="button"
                  role="tab"
                  id={`${baseId}-tab-${item}`}
                  aria-selected={tab === item}
                  aria-controls={`${baseId}-panel-${item}`}
                  aria-disabled={disabled || undefined}
                  aria-describedby={disabled ? unavailableId : undefined}
                  title={disabled ? t("provider.jsonUnavailable") : undefined}
                  tabIndex={tab === item ? 0 : -1}
                  data-testid={`provider-tab-${item}`}
                  onClick={() => requestTab(item)}
                  onKeyDown={onTabKeyDown}
                  className={tabClass(item)}
                >
                  {item === "form" ? t("provider.tabForm") : t("provider.tabJson")}
                </button>
              );
            })}
          </div>
          {!jsonAvailable ? (
            <span id={unavailableId} className="text-micro text-ink-500 dark:text-ink-400">
              {t("provider.jsonUnavailable")}
            </span>
          ) : null}
        </div>

        <div
          role="tabpanel"
          id={`${baseId}-panel-form`}
          aria-labelledby={`${baseId}-tab-form`}
          hidden={tab !== "form"}
          className="flex flex-col gap-4"
        >
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
          {draft.inlineKey && <p className="text-xs text-warn-500">{t("provider.inlineKeyWarning")}</p>}

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
                  disabled={keyOperating}
                  className="w-full rounded-md bg-ink-50 px-2.5 py-1.5 text-sm text-ink-800 ring-1 ring-ink-200 transition-colors duration-150 ease-ui placeholder:text-ink-400 hover:ring-ink-300 focus:outline-none focus:ring-2 focus:ring-accent-500 disabled:opacity-60 dark:bg-ink-900 dark:text-ink-100 dark:ring-ink-700 dark:placeholder:text-ink-500 dark:hover:ring-ink-600 dark:focus:ring-accent-400"
                  data-testid="provider-key-input"
                />
              )}
            </Field>
            {hasKeySet && <p className="mt-1 text-xs text-ink-500 dark:text-ink-400">{t("provider.keySet")}</p>}
            {!persisted && (
              <p className="mt-1 text-xs text-ink-500 dark:text-ink-400" data-testid="provider-key-on-save">
                {t("provider.keySavedWithProvider")}
              </p>
            )}
            <div className="mt-2 flex gap-2">
              <Button
                size="sm"
                onClick={handleSetKey}
                disabled={!persisted || keyInput.trim() === "" || keyOperating}
                data-testid="provider-key-save"
              >
                {t("provider.saveKey")}
              </Button>
              <Button
                size="sm"
                variant="danger"
                onClick={handleClearKey}
                disabled={!persisted || !hasKeySet || keyOperating}
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
            {!modelsValid ? (
              <p role="alert" className="mb-2 text-xs text-bad-500" data-testid="models-invalid">
                {t("provider.modelsInvalid")}
              </p>
            ) : null}
            <ProviderModelsTable
              models={draft.models}
              onChange={(models) => mutate({ models })}
              onValidityChange={setModelsValid}
              fetched={fetched}
            />
          </div>
        </div>

        {jsonAvailable ? (
          <div
            role="tabpanel"
            id={`${baseId}-panel-json`}
            aria-labelledby={`${baseId}-tab-json`}
            hidden={tab !== "json"}
            className="flex flex-col gap-3"
          >
            <p className="text-xs text-ink-500 dark:text-ink-400">{t("provider.jsonNote")}</p>
            <Field
              label={t("provider.jsonLabel")}
              error={
                jsonParseError === null ? undefined : t("provider.jsonParseError", { message: jsonParseError })
              }
            >
              {(field) => (
                <TextArea
                  {...field}
                  value={jsonText}
                  onChange={(e) => {
                    setJsonText(e.target.value);
                    setJsonNotice(false);
                  }}
                  onCompositionStart={() => {
                    composingRef.current = true;
                  }}
                  onCompositionEnd={() => {
                    composingRef.current = false;
                  }}
                  onKeyDown={(e) => {
                    if (
                      e.key === "Enter" &&
                      (e.ctrlKey || e.metaKey) &&
                      !e.nativeEvent.isComposing &&
                      !composingRef.current
                    ) {
                      e.preventDefault();
                      void saveJson();
                    }
                  }}
                  spellCheck={false}
                  rows={18}
                  aria-busy={jsonBusy}
                  className="min-h-72 resize-y leading-relaxed focus:outline-none focus:ring-2 focus:ring-accent-500 dark:focus:ring-accent-400"
                  data-testid="provider-json"
                />
              )}
            </Field>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="primary"
                size="sm"
                onClick={() => void saveJson()}
                disabled={jsonBusy}
                data-testid="provider-json-save"
              >
                {t("provider.jsonSave")}
              </Button>
              <Button size="sm" onClick={requestReload} disabled={jsonBusy} data-testid="provider-json-reload">
                {t("provider.jsonReload")}
              </Button>
              <Button size="sm" variant="ghost" onClick={formatJson} disabled={jsonBusy} data-testid="provider-json-format">
                {t("provider.jsonFormat")}
              </Button>
              <span aria-live="polite" className="text-xs text-good-500" data-testid="provider-json-status">
                {jsonNotice ? t("provider.jsonSaved") : ""}
              </span>
            </div>
          </div>
        ) : null}
      </div>

      {pending !== null ? (
        <Dialog
          title={t("provider.discardTitle")}
          onClose={() => setPending(null)}
          footer={
            <>
              <Button variant="ghost" onClick={() => setPending(null)}>
                {t("common.cancel")}
              </Button>
              <Button variant="danger" onClick={confirmDiscard} data-testid="provider-json-discard">
                {t("provider.discardConfirm")}
              </Button>
            </>
          }
        >
          <p className="text-sm text-ink-700 dark:text-ink-200">{t("provider.discardBody")}</p>
        </Dialog>
      ) : null}
    </Dialog>
  );
}
