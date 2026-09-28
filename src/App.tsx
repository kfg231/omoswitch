import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { api, type ImportSource } from "./lib/api";
import { BUILTIN_CATALOG } from "./lib/catalog";
import { getPreset } from "./lib/providerCatalog";
import type {
  AppError,
  BackupInfo,
  FetchedModels,
  ImportResult,
  ModelInfo,
  NativeCatalog,
  ProbeResult,
  Profile,
  ProfileInput,
  ProviderInfo,
  ProviderInput,
  ProviderJson,
  ProvidersResult,
  Status,
  SwitchPreview as SwitchPreviewData,
} from "./lib/types";
import { setLanguage, type Lang } from "./i18n";
import { BackupsDialog } from "./components/BackupsDialog";
import { ErrorBanner, isAppError } from "./components/ErrorBanner";
import { ImportDialog } from "./components/ImportDialog";
import { ProfileEditor, type ApplyState } from "./components/ProfileEditor";
import { ProfileList } from "./components/ProfileList";
import { ProviderEditor } from "./components/ProviderEditor";
import { ProviderList } from "./components/ProviderList";
import { StatusBar } from "./components/StatusBar";
import { SwitchPreview } from "./components/SwitchPreview";
import { Panel, SectionHeading } from "./components/primitives";

const POLL_MS = 3000;
const NOTICE_MS = 6000;

type View = "profiles" | "providers";
const VIEWS: readonly View[] = ["profiles", "providers"];

interface Notice {
  key: string;
  params?: Record<string, string>;
}

interface EditorState {
  initial: ProviderInfo | null;
  prefillId?: string;
  isNew: boolean;
}

function toAppError(cause: unknown): AppError {
  if (isAppError(cause)) return cause;
  return { kind: "io", message: cause instanceof Error ? cause.message : String(cause) };
}

function placeholderProvider(id: string): ProviderInfo {
  return {
    id,
    name: id,
    baseUrl: "",
    api: "openai-completions",
    models: [],
    enabled: true,
    hasKey: false,
    keySource: "none",
    inlineKey: false,
    knownToOmo: false,
  };
}

export default function App() {
  const { t, i18n } = useTranslation();
  const [view, setView] = useState<View>("profiles");
  const [status, setStatus] = useState<Status | null>(null);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [catalog, setCatalog] = useState<NativeCatalog>(BUILTIN_CATALOG);
  const [latestOmoVersion, setLatestOmoVersion] = useState<string | null>(null);
  const [providersResult, setProvidersResult] = useState<ProvidersResult | null>(null);
  const [probes, setProbes] = useState<Record<string, ProbeResult | "pending" | undefined>>({});
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [editorError, setEditorError] = useState<AppError | null>(null);
  const [backups, setBackups] = useState<BackupInfo[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [preview, setPreview] = useState<SwitchPreviewData | null>(null);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [dialog, setDialog] = useState<"none" | "import" | "backups">("none");
  const [error, setError] = useState<AppError | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState(false);
  const [pendingApplyId, setPendingApplyId] = useState<string | null>(null);
  const tabRefs = useRef<Record<View, HTMLButtonElement | null>>({ profiles: null, providers: null });

  const providers = providersResult?.providers ?? [];

  const report = useCallback((cause: unknown): void => {
    setError(toAppError(cause));
  }, []);

  const refreshStatus = useCallback(async (): Promise<void> => {
    try {
      setStatus(await api.getStatus());
    } catch (cause) {
      report(cause);
    }
  }, [report]);

  const refreshProviders = useCallback(async (): Promise<void> => {
    try {
      setProvidersResult(await api.listProviders());
    } catch (cause) {
      report(cause);
    }
  }, [report]);

  const refreshProfiles = useCallback(async (): Promise<Profile[]> => {
    const list = await api.listProfiles();
    setProfiles(list);
    return list;
  }, []);

  const loadModels = useCallback(
    async (refresh: boolean): Promise<void> => {
      try {
        setModels(await api.listModels(refresh));
      } catch (cause) {
        report(cause);
      }
    },
    [report],
  );

  // knownToOmo is derived from the omo model cache, so it must be re-queried after provider edits.
  const refreshModelsAfterProviderChange = useCallback(async (): Promise<void> => {
    await loadModels(true);
    await refreshProviders();
  }, [loadModels, refreshProviders]);

  const loadCatalog = useCallback(
    async (refresh: boolean): Promise<NativeCatalog | null> => {
      try {
        const next = await api.getNativeCatalog(refresh);
        setCatalog(next);
        return next;
      } catch (cause) {
        report(cause);
        return null;
      }
    },
    [report],
  );

  useEffect(() => {
    void (async () => {
      try {
        const list = await refreshProfiles();
        setSelectedId(list[0]?.id ?? null);
      } catch (cause) {
        report(cause);
      }
      await refreshStatus();
      await refreshProviders();
      await loadCatalog(false);
      await loadModels(false);
      setLatestOmoVersion(await api.latestOmoVersion().catch(() => null));
    })();
  }, [loadCatalog, loadModels, refreshProfiles, refreshProviders, refreshStatus, report]);

  useEffect(() => {
    const tick = (): void => {
      void refreshStatus();
      void refreshProviders();
    };
    const timer = window.setInterval(tick, POLL_MS);
    window.addEventListener("focus", tick);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", tick);
    };
  }, [refreshProviders, refreshStatus]);

  useEffect(() => {
    if (status !== null && status.drift !== "drifted") setPendingApplyId(null);
  }, [status]);

  useEffect(() => {
    if (notice === null) return;
    const timer = window.setTimeout(() => setNotice(null), NOTICE_MS);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const openPreview = useCallback(
    async (id: string): Promise<void> => {
      setSelectedId(id);
      try {
        setPreview(await api.previewSwitch(id));
        setError(null);
      } catch (cause) {
        report(cause);
      }
    },
    [report],
  );

  async function confirmApply(): Promise<void> {
    if (preview === null) return;
    setBusy(true);
    try {
      const result = await api.applyProfile(preview.profileId, preview.baseHash);
      setPreview(null);
      setNotice(
        result.changed
          ? result.backupPath === null
            ? { key: "preview.applied" }
            : { key: "preview.appliedWithBackup", params: { path: result.backupPath } }
          : { key: "preview.appliedNoChange" },
      );
      setError(null);
      await refreshStatus();
    } catch (cause) {
      report(cause);
    } finally {
      setBusy(false);
    }
  }

  async function run(action: () => Promise<void>): Promise<void> {
    setBusy(true);
    try {
      await action();
      setError(null);
    } catch (cause) {
      report(cause);
    } finally {
      setBusy(false);
    }
  }

  function changeLang(lang: Lang): void {
    setLanguage(lang);
  }

  function selectView(next: View, focus = false): void {
    setView(next);
    if (focus) tabRefs.current[next]?.focus();
  }

  function onTabKeyDown(event: KeyboardEvent<HTMLButtonElement>): void {
    const focused = VIEWS.find((tab) => tabRefs.current[tab] === event.currentTarget) ?? view;
    const index = VIEWS.indexOf(focused);
    let next: View | undefined;
    if (event.key === "ArrowRight") next = VIEWS[(index + 1) % VIEWS.length];
    else if (event.key === "ArrowLeft") next = VIEWS[(index - 1 + VIEWS.length) % VIEWS.length];
    else if (event.key === "Home") next = VIEWS[0];
    else if (event.key === "End") next = VIEWS[VIEWS.length - 1];
    if (next === undefined) return;
    event.preventDefault();
    selectView(next, true);
  }

  function openEditor(state: EditorState): void {
    setEditorError(null);
    setEditor(state);
  }

  function configureProvider(providerId: string): void {
    setView("providers");
    const existing = providers.find((provider) => provider.id === providerId);
    if (existing !== undefined) {
      openEditor({ initial: existing, isNew: false });
    } else if (getPreset(providerId) !== undefined) {
      openEditor({ initial: null, prefillId: providerId, isNew: true });
    } else {
      openEditor({ initial: placeholderProvider(providerId), isNew: true });
    }
  }

  function replaceEditorInitial(info: ProviderInfo): void {
    setEditor((current) => (current === null ? current : { ...current, initial: info }));
  }

  async function saveProvider(input: ProviderInput, key?: string): Promise<void> {
    try {
      let saved = await api.saveProvider(input);
      // A key typed before the provider existed is stored once the provider is saved.
      if (key !== undefined) {
        try {
          saved = await api.setProviderKey(saved.id, key);
        } catch (keyCause) {
          // The provider itself was saved: switch to edit mode so the key can be retried there.
          await refreshProviders();
          setEditor({ initial: saved, isNew: false });
          setEditorError(toAppError(keyCause));
          return;
        }
      }
      await refreshProviders();
      void refreshModelsAfterProviderChange();
      setEditorError(null);
      setError(null);
      if (editor?.isNew === true) {
        setEditor({ initial: saved, isNew: false });
      } else {
        setEditor(null);
      }
    } catch (cause) {
      setEditorError(toAppError(cause));
    }
  }

  async function setProviderKey(id: string, key: string): Promise<void> {
    try {
      replaceEditorInitial(await api.setProviderKey(id, key));
      setEditorError(null);
      await refreshProviders();
      void refreshModelsAfterProviderChange();
    } catch (cause) {
      setEditorError(toAppError(cause));
    }
  }

  async function clearProviderKey(id: string): Promise<void> {
    try {
      replaceEditorInitial(await api.clearProviderKey(id));
      setEditorError(null);
      await refreshProviders();
      void refreshModelsAfterProviderChange();
    } catch (cause) {
      setEditorError(toAppError(cause));
    }
  }

  async function fetchProviderModels(id: string): Promise<FetchedModels> {
    try {
      const result = await api.fetchProviderModels(id);
      setEditorError(null);
      return result;
    } catch (cause) {
      setEditorError(toAppError(cause));
      throw cause;
    }
  }

  async function getProviderJson(id: string): Promise<ProviderJson> {
    try {
      const result = await api.getProviderJson(id);
      setEditorError(null);
      return result;
    } catch (cause) {
      setEditorError(toAppError(cause));
      throw cause;
    }
  }

  async function saveProviderJson(id: string, json: string): Promise<void> {
    try {
      replaceEditorInitial(await api.saveProviderJson(id, json));
      setEditorError(null);
      await refreshProviders();
      void refreshModelsAfterProviderChange();
    } catch (cause) {
      setEditorError(toAppError(cause));
      throw cause;
    }
  }

  async function testProvider(id: string): Promise<void> {
    setProbes((current) => ({ ...current, [id]: "pending" }));
    try {
      const result = await api.testProvider(id);
      setProbes((current) => ({ ...current, [id]: result }));
    } catch (cause) {
      setProbes((current) => ({ ...current, [id]: undefined }));
      report(cause);
    }
  }

  const activeProfile =
    profiles.find((profile) => profile.id === status?.activeProfileId) ?? null;
  const selected = profiles.find((profile) => profile.id === selectedId) ?? null;
  const pending =
    status?.drift === "drifted" &&
    status.activeProfileId !== null &&
    pendingApplyId === status.activeProfileId;

  function applyStateOf(profile: Profile | null): ApplyState {
    if (profile === null) return "new";
    if (status === null || profile.id !== status.activeProfileId) return "inactive";
    if (status.drift === "inSync") return "synced";
    if (pending) return "pending";
    return "drifted";
  }

  const tabClass = (tab: View): string =>
    `rounded-md px-3.5 py-1.5 text-sm font-medium transition-colors duration-150 ease-ui ${
      view === tab
        ? "bg-ink-50 text-ink-900 shadow-sm ring-1 ring-ink-200 dark:bg-ink-800 dark:text-ink-50 dark:ring-ink-700"
        : "text-ink-600 hover:bg-ink-200/70 dark:text-ink-300 dark:hover:bg-ink-800/60"
    }`;

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-3">
      <StatusBar
        status={status}
        activeProfile={activeProfile}
        pending={pending}
        lang={(i18n.resolvedLanguage === "en" ? "en" : "ja") satisfies Lang}
        onLangChange={changeLang}
        onReapply={() => {
          if (status?.activeProfileId !== null && status?.activeProfileId !== undefined) {
            void openPreview(status.activeProfileId);
          }
        }}
        onCapture={() =>
          void run(async () => {
            const captured = await api.captureActiveFromConfig();
            await refreshProfiles();
            setSelectedId(captured.id);
            await refreshStatus();
            setNotice({ key: "editor.saved" });
          })
        }
      />

      <div
        role="tablist"
        aria-orientation="horizontal"
        className="flex w-fit gap-1 rounded-lg bg-ink-100 p-1 ring-1 ring-ink-200 dark:bg-ink-950/60 dark:ring-ink-800"
      >
        {VIEWS.map((tab) => (
          <button
            key={tab}
            ref={(node) => {
              tabRefs.current[tab] = node;
            }}
            type="button"
            role="tab"
            id={`view-tab-${tab}`}
            aria-selected={view === tab}
            aria-controls={`view-panel-${tab}`}
            tabIndex={view === tab ? 0 : -1}
            data-testid={`view-tab-${tab}`}
            onClick={() => selectView(tab)}
            onKeyDown={onTabKeyDown}
            className={tabClass(tab)}
          >
            {tab === "profiles" ? t("profileList.title") : t("provider.title")}
            {tab === "providers" && providersResult !== null ? (
              <span className="ml-1.5 text-micro text-ink-500 tabular-nums dark:text-ink-400">
                {providers.length}
              </span>
            ) : null}
          </button>
        ))}
      </div>

      {error !== null ? (
        <ErrorBanner
          error={error}
          onDismiss={() => setError(null)}
          onReloadPreview={
            selectedId === null
              ? undefined
              : () => {
                  setError(null);
                  void openPreview(selectedId);
                }
          }
        />
      ) : null}

      <div aria-live="polite" className="pointer-events-none fixed right-4 bottom-4 z-40 max-w-md">
        {notice !== null ? (
          <p className="pointer-events-auto flex items-start gap-2 rounded-lg bg-ink-900 px-4 py-3 text-sm text-ink-50 shadow-lg ring-1 ring-ink-800 dark:bg-ink-50 dark:text-ink-900 dark:ring-ink-200">
            <span aria-hidden="true" className="font-semibold text-good-300 dark:text-good-700">
              ✓
            </span>
            <span className="min-w-0 break-all">{t(notice.key, notice.params)}</span>
          </p>
        ) : null}
      </div>

      <div
        role="tabpanel"
        id="view-panel-profiles"
        aria-labelledby="view-tab-profiles"
        hidden={view !== "profiles"}
        className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[22rem_1fr]"
      >
        <ProfileList
          profiles={profiles}
          selectedId={selectedId}
          activeProfileId={status?.activeProfileId ?? null}
          drift={status?.drift ?? null}
          onSelect={setSelectedId}
          onApply={(id) => void openPreview(id)}
          onNew={() => setSelectedId(null)}
          onImport={() => {
            setImportResult(null);
            setDialog("import");
          }}
          onBackups={() =>
            void run(async () => {
              setBackups(await api.listBackups());
              setDialog("backups");
            })
          }
          onDuplicate={(profile) =>
            void run(async () => {
              const copy = await api.duplicateProfile(
                profile.id,
                t("profileList.duplicateName", { name: profile.name }),
              );
              await refreshProfiles();
              setSelectedId(copy.id);
            })
          }
          onDelete={(profile) => {
            if (!window.confirm(t("profileList.deleteConfirm", { name: profile.name }))) return;
            void run(async () => {
              await api.deleteProfile(profile.id);
              const list = await refreshProfiles();
              setSelectedId(list[0]?.id ?? null);
              await refreshStatus();
            });
          }}
        />

        {selected === null && profiles.length > 0 && selectedId !== null ? (
          <p className="text-xs text-ink-500 dark:text-ink-400">{t("editor.emptySelection")}</p>
        ) : (
          <ProfileEditor
            key={selected?.id ?? "new"}
            profile={selected}
            applyState={applyStateOf(selected)}
            onApply={selected === null ? undefined : () => void openPreview(selected.id)}
            profiles={profiles}
            models={models}
            providers={providers}
            omoAvailable={status?.omoAvailable ?? true}
            catalog={catalog}
            latestOmoVersion={latestOmoVersion}
            onRefreshModels={() => loadModels(true)}
            onFetchCatalog={() => loadCatalog(true)}
            onConfigureProvider={configureProvider}
            onSave={(input: ProfileInput) =>
              void run(async () => {
                const saved = await api.saveProfile(input);
                if (saved.id === status?.activeProfileId) setPendingApplyId(saved.id);
                await refreshProfiles();
                setSelectedId(saved.id);
                setNotice({ key: "editor.saved" });
                await refreshStatus();
              })
            }
          />
        )}
      </div>

      <div
        role="tabpanel"
        id="view-panel-providers"
        aria-labelledby="view-tab-providers"
        hidden={view !== "providers"}
        className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[1fr_22rem]"
      >
        <ProviderList
          providers={providers}
          probes={probes}
          onToggle={(id, enabled) =>
            void run(async () => {
              await api.setProviderEnabled(id, enabled);
              await refreshProviders();
              void refreshModelsAfterProviderChange();
            })
          }
          onTest={(id) => void testProvider(id)}
          onEdit={(id) => {
            const target = providers.find((provider) => provider.id === id);
            if (target !== undefined) openEditor({ initial: target, isNew: false });
          }}
          onDelete={(id) => {
            if (!window.confirm(t("provider.deleteConfirm", { id }))) return;
            void run(async () => {
              await api.deleteProvider(id);
              setProbes((current) => ({ ...current, [id]: undefined }));
              await refreshProviders();
              void refreshModelsAfterProviderChange();
            });
          }}
          onAdd={() => openEditor({ initial: null, isNew: true })}
          onImport={() =>
            void run(async () => {
              const result = await api.importProvidersFromOpencode();
              await refreshProviders();
              void refreshModelsAfterProviderChange();
              setNotice({
                key: "provider.importResult",
                params: {
                  imported: String(result.imported.length),
                  updated: String(result.updated.length),
                  skipped: String(result.skipped.length),
                },
              });
            })
          }
        />

        <Panel className="flex flex-col gap-3 px-4 py-3">
          <SectionHeading>{t("provider.count", { count: providers.length })}</SectionHeading>
          <dl className="flex flex-col gap-2 text-xs">
            <div className="flex flex-col gap-0.5">
              <dt className="text-micro font-medium tracking-wide text-ink-500 uppercase dark:text-ink-400">
                {t("provider.agentDir")}
              </dt>
              <dd className="font-mono break-all text-ink-800 dark:text-ink-100">
                {providersResult?.agentDir ?? t("common.loading")}
              </dd>
            </div>
            <div className="flex flex-col gap-0.5">
              <dt className="text-micro font-medium tracking-wide text-ink-500 uppercase dark:text-ink-400">
                {t("provider.modelsJsonPath")}
              </dt>
              <dd className="font-mono break-all text-ink-800 dark:text-ink-100">
                {providersResult?.modelsJsonPath ?? t("common.loading")}
              </dd>
            </div>
          </dl>
        </Panel>
      </div>

      <ProviderEditor
        open={editor !== null}
        initial={editor?.initial ?? null}
        prefillId={editor?.prefillId}
        saved={editor !== null && !editor.isNew}
        error={editorError}
        onClose={() => {
          setEditor(null);
          setEditorError(null);
        }}
        onSave={saveProvider}
        onSetKey={setProviderKey}
        onClearKey={clearProviderKey}
        onFetchModels={fetchProviderModels}
        onGetJson={getProviderJson}
        onSaveJson={saveProviderJson}
      />

      {preview !== null ? (
        <SwitchPreview
          preview={preview}
          profile={profiles.find((profile) => profile.id === preview.profileId) ?? null}
          busy={busy}
          onConfirm={() => void confirmApply()}
          onReload={() => void openPreview(preview.profileId)}
          onClose={() => setPreview(null)}
        />
      ) : null}

      {dialog === "import" ? (
        <ImportDialog
          result={importResult}
          busy={busy}
          onClose={() => setDialog("none")}
          onSubmit={(source: ImportSource, name: string) =>
            void run(async () => {
              const result = await api.importFromConfig(source, name);
              setImportResult(result);
              await refreshProfiles();
              setSelectedId(result.profile.id);
            })
          }
        />
      ) : null}

      {dialog === "backups" ? (
        <BackupsDialog
          backups={backups}
          busy={busy}
          onClose={() => setDialog("none")}
          onRestore={(path) =>
            void run(async () => {
              await api.restoreBackup(path);
              setBackups(await api.listBackups());
              await refreshStatus();
              setNotice({ key: "backups.restored" });
            })
          }
        />
      ) : null}
    </div>
  );
}
