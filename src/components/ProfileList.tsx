import { useTranslation } from "react-i18next";
import type { Profile } from "../lib/types";
import { Badge, Button, Panel, SectionHeading } from "./primitives";

export interface ProfileListProps {
  profiles: readonly Profile[];
  selectedId: string | null;
  activeProfileId: string | null;
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
      <div className="flex flex-col gap-2 border-b border-ink-200 px-3 py-3 dark:border-ink-800">
        <SectionHeading>{t("profileList.title")}</SectionHeading>
        <div className="flex flex-wrap gap-1.5">
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
        <p className="px-3 py-6 text-xs text-ink-500 dark:text-ink-400">{t("profileList.empty")}</p>
      ) : (
        <ul className="min-h-0 flex-1 overflow-y-auto p-2">
          {profiles.map((profile) => {
            const selected = profile.id === selectedId;
            return (
              <li key={profile.id}>
                <div
                  className={`rounded-panel mb-1.5 px-2.5 py-2 transition-colors duration-150 ease-ui ${
                    selected
                      ? "bg-ink-200/80 dark:bg-ink-800"
                      : "hover:bg-ink-100 dark:hover:bg-ink-800/60"
                  }`}
                >
                  <button
                    type="button"
                    aria-current={selected}
                    onClick={() => onSelect(profile.id)}
                    className="flex w-full items-start gap-2 text-left"
                  >
                    <span
                      aria-hidden="true"
                      className={`mt-1.5 size-1.5 shrink-0 rounded-full ${
                        profile.id === activeProfileId ? "bg-accent-500" : "bg-transparent"
                      }`}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-1.5">
                        <span className="text-sm font-medium text-ink-900 dark:text-ink-50">
                          {profile.name}
                        </span>
                        {profile.id === activeProfileId ? (
                          <Badge tone="accent">{t("profileList.activeBadge")}</Badge>
                        ) : null}
                      </span>
                      <span className="mt-0.5 block text-micro text-ink-500 dark:text-ink-400">
                        {t("profileList.agentsCount", { count: countOf(profile.agents) })} ·{" "}
                        {t("profileList.categoriesCount", { count: countOf(profile.categories) })}
                      </span>
                      <span className="block text-micro text-ink-400 dark:text-ink-500">
                        {t("profileList.updatedAt", { value: profile.updatedAt })}
                      </span>
                    </span>
                  </button>

                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    <Button size="sm" variant="primary" onClick={() => onApply(profile.id)}>
                      {t("common.apply")}
                    </Button>
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
