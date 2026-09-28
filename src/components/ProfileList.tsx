import { useTranslation } from "react-i18next";
import type { Drift, Profile } from "../lib/types";
import { Badge, Button, Panel, SectionHeading } from "./primitives";

export interface ProfileListProps {
  profiles: readonly Profile[];
  selectedId: string | null;
  activeProfileId: string | null;
  drift: Drift | null;
  onSelect: (id: string) => void;
  onApply: (id: string) => void;
  onDuplicate: (profile: Profile) => void;
  onDelete: (profile: Profile) => void;
  onNew: () => void;
  onImport: () => void;
  onBackups: () => void;
}

function countOf(record: Record<string, unknown>): number {
  return Object.keys(record).length;
}

export function ProfileList({
  profiles,
  selectedId,
  activeProfileId,
  drift,
  onSelect,
  onApply,
  onDuplicate,
  onDelete,
  onNew,
  onImport,
  onBackups,
}: ProfileListProps) {
  const { t } = useTranslation();

  return (
    <Panel className="flex min-h-0 flex-col">
      <div className="flex flex-col gap-3 border-b border-ink-200 px-4 py-3 dark:border-ink-800">
        <SectionHeading>{t("profileList.title")}</SectionHeading>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="primary" onClick={onNew}>
            {t("profileList.new")}
          </Button>
          <Button size="sm" onClick={onImport}>
            {t("profileList.importFromConfig")}
          </Button>
          <Button size="sm" onClick={onBackups}>
            {t("backups.title")}
          </Button>
        </div>
      </div>

      {profiles.length === 0 ? (
        <p className="px-4 py-6 text-sm text-ink-600 dark:text-ink-300">{t("profileList.empty")}</p>
      ) : (
        <ul className="relative flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-3">
          {profiles.map((profile) => {
            const selected = profile.id === selectedId;
            const active = profile.id === activeProfileId;
            const inSync = active && drift === "inSync";
            return (
              <li key={profile.id}>
                <div
                  className={`rounded-lg p-3 ring-1 transition-colors duration-150 ease-ui ${
                    active
                      ? "bg-accent-500/8 ring-accent-500/60 dark:bg-accent-500/12 dark:ring-accent-400/50"
                      : selected
                        ? "bg-ink-100 ring-ink-300 dark:bg-ink-800 dark:ring-ink-600"
                        : "bg-white ring-ink-200 hover:ring-ink-300 dark:bg-ink-950/40 dark:ring-ink-800 dark:hover:ring-ink-700"
                  }`}
                >
                  <button
                    type="button"
                    aria-current={selected}
                    onClick={() => onSelect(profile.id)}
                    className="flex w-full flex-col items-start gap-1 text-left"
                  >
                    <span className="flex w-full flex-wrap items-center gap-2">
                      <span className="text-base font-semibold text-ink-900 dark:text-ink-50">
                        {profile.name}
                      </span>
                      {active ? (
                        <Badge tone={inSync ? "accent" : "warn"}>
                          <span aria-hidden="true">●</span>
                          {t("profileList.activeBadge")}
                        </Badge>
                      ) : null}
                    </span>
                    <span className="text-xs text-ink-600 dark:text-ink-300">
                      {t("profileList.agentsCount", { count: countOf(profile.agents) })} ·{" "}
                      {t("profileList.categoriesCount", { count: countOf(profile.categories) })}
                    </span>
                    <span className="font-mono text-micro text-ink-500 dark:text-ink-400">
                      {t("profileList.updatedAt", { value: profile.updatedAt })}
                    </span>
                  </button>

                  <div className="mt-3 flex items-center gap-1.5">
                    {inSync ? (
                      <Button size="sm" disabled className="min-w-20">
                        <span aria-hidden="true">✓</span>
                        {t("profileList.appliedButton")}
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="primary"
                        className="min-w-20"
                        onClick={() => onApply(profile.id)}
                      >
                        {active ? t("drift.reapply") : t("common.apply")}
                      </Button>
                    )}
                    <span className="flex-1" />
                    <Button size="sm" variant="ghost" onClick={() => onDuplicate(profile)}>
                      {t("common.duplicate")}
                    </Button>
                    <Button size="sm" variant="danger" onClick={() => onDelete(profile)}>
                      {t("common.delete")}
                    </Button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}
