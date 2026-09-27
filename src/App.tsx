import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, type ImportSource } from "./lib/api";
import type {
  AppError,
  BackupInfo,
  ImportResult,
  ModelInfo,
  Profile,
  ProfileInput,
  Status,
  SwitchPreview as SwitchPreviewData,
} from "./lib/types";
import { setLanguage, type Lang } from "./i18n";
import { BackupsDialog } from "./components/BackupsDialog";
import { ErrorBanner, isAppError } from "./components/ErrorBanner";
import { ImportDialog } from "./components/ImportDialog";
import { ProfileEditor } from "./components/ProfileEditor";
import { ProfileList } from "./components/ProfileList";
import { StatusBar } from "./components/StatusBar";
import { SwitchPreview } from "./components/SwitchPreview";

const POLL_MS = 3000;

interface Notice {
  key: string;
  params?: Record<string, string>;
}

function toAppError(cause: unknown): AppError {
  if (isAppError(cause)) return cause;
  return { kind: "io", message: cause instanceof Error ? cause.message : String(cause) };
}

export default function App() {
  const { t, i18n } = useTranslation();
  const [status, setStatus] = useState<Status | null>(null);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [backups, setBackups] = useState<BackupInfo[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [preview, setPreview] = useState<SwitchPreviewData | null>(null);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [dialog, setDialog] = useState<"none" | "import" | "backups">("none");
  const [error, setError] = useState<AppError | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState(false);

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

  useEffect(() => {
    void (async () => {
      try {
        const list = await refreshProfiles();
        setSelectedId(list[0]?.id ?? null);
      } catch (cause) {
        report(cause);
      }
      await refreshStatus();
      await loadModels(false);
    })();
  }, [loadModels, refreshProfiles, refreshStatus, report]);

  useEffect(() => {
    const timer = window.setInterval(() => void refreshStatus(), POLL_MS);
    const onFocus = (): void => void refreshStatus();
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [refreshStatus]);

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

  const activeProfile =
    profiles.find((profile) => profile.id === status?.activeProfileId) ?? null;
  const selected = profiles.find((profile) => profile.id === selectedId) ?? null;

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-3">
      <StatusBar
        status={status}
        activeProfile={activeProfile}
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

      {notice !== null ? (
        <p
          aria-live="polite"
          className="rounded-panel bg-good-500/12 px-4 py-2 text-xs text-ink-700 dark:text-ink-200"
        >
          {t(notice.key, notice.params)}
        </p>
      ) : null}

      <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[22rem_1fr]">
        <ProfileList
          profiles={profiles}
          selectedId={selectedId}
          activeProfileId={status?.activeProfileId ?? null}
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
            profiles={profiles}
            models={models}
            omoAvailable={status?.omoAvailable ?? true}
            onRefreshModels={() => void loadModels(true)}
            onSave={(input: ProfileInput) =>
              void run(async () => {
                const saved = await api.saveProfile(input);
                await refreshProfiles();
                setSelectedId(saved.id);
                setNotice({ key: "editor.saved" });
              })
            }
          />
        )}
      </div>

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
