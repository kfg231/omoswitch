import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { splitAssignment, validateProfileInput, type ValidationErrors } from "../lib/assignment";
import type {
  Assignment,
  ModelInfo,
  NativeCatalog,
  Profile,
  ProfileInput,
  ProviderInfo,
} from "../lib/types";
import { AssignmentRow } from "./AssignmentRow";
import { Button, Field, Panel, SectionHeading, TextArea, TextInput } from "./primitives";

export interface ProfileEditorProps {
  profile: Profile | null;
  profiles: readonly Profile[];
  models: readonly ModelInfo[];
  providers: readonly ProviderInfo[];
  omoAvailable: boolean;
  catalog: NativeCatalog;
  onSave: (input: ProfileInput) => void;
  onRefreshModels: () => Promise<void>;
  onFetchCatalog: () => Promise<NativeCatalog | null>;
  onConfigureProvider: (providerId: string) => void;
}

interface Draft {
  id?: string;
  name: string;
  note: string;
  agents: Record<string, Assignment>;
  categories: Record<string, Assignment>;
}

interface FetchStatus {
  catalog: NativeCatalog;
  added: number;
}

type Section = "agents" | "categories";

function blankRows(keys: readonly string[]): Record<string, Assignment> {
  return Object.fromEntries(keys.map((key) => [key, { model: "" }]));
}

function draftOf(profile: Profile | null, catalog: NativeCatalog): Draft {
  if (profile === null) {
    return {
      name: "",
      note: "",
      agents: blankRows(catalog.agents),
      categories: blankRows(catalog.categories),
    };
  }
  return {
    id: profile.id,
    name: profile.name,
    note: profile.note,
    agents: structuredClone(profile.agents),
    categories: structuredClone(profile.categories),
  };
}

function isBlankAssignment(assignment: Assignment): boolean {
  const parts = splitAssignment(assignment);
  return (
    parts.model === "" &&
    assignment["reasoning"] === undefined &&
    assignment["models"] === undefined &&
    Object.keys(parts.extra).length === 0
  );
}

function withoutBlankRows(entries: Record<string, Assignment>): Record<string, Assignment> {
  return Object.fromEntries(Object.entries(entries).filter(([, assignment]) => !isBlankAssignment(assignment)));
}

function withMissingRows(
  entries: Record<string, Assignment>,
  keys: readonly string[],
): Record<string, Assignment> {
  const next = { ...entries };
  for (const key of keys) {
    if (!(key in next)) next[key] = { model: "" };
  }
  return next;
}

function countMissing(entries: Record<string, Assignment>, keys: readonly string[]): number {
  return keys.filter((key) => !(key in entries)).length;
}

function catalogSourceLabel(catalog: NativeCatalog, t: TFunction): string {
  const version = catalog.omoVersion ?? t("editor.catalogVersionUnknown");
  switch (catalog.source) {
    case "installed":
      return t("editor.catalogSourceInstalled", { version });
    case "cache":
      return t("editor.catalogSourceCache", { version });
    case "builtin":
      return t("editor.catalogSourceBuiltin");
    default: {
      const unreachable: never = catalog.source;
      return unreachable;
    }
  }
}

export function ProfileEditor({
  profile,
  profiles,
  models,
  providers,
  omoAvailable,
  catalog,
  onSave,
  onRefreshModels,
  onFetchCatalog,
  onConfigureProvider,
}: ProfileEditorProps) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<Draft>(() => draftOf(profile, catalog));
  const [dirty, setDirty] = useState(false);
  const [errors, setErrors] = useState<ValidationErrors>({});
  const [newKey, setNewKey] = useState<Record<Section, string>>({ agents: "", categories: "" });
  const [fetching, setFetching] = useState(false);
  const [fetchStatus, setFetchStatus] = useState<FetchStatus | null>(null);

  useEffect(() => {
    setDraft(draftOf(profile, catalog));
    setDirty(false);
    setErrors({});
    setNewKey({ agents: "", categories: "" });
    // The catalog only seeds a fresh draft; a catalog update must not discard edits.
  }, [profile]);

  function mutate(next: Partial<Draft>): void {
    setDraft((current) => ({ ...current, ...next }));
    setDirty(true);
  }

  function setEntry(section: Section, key: string, assignment: Assignment): void {
    mutate({ [section]: { ...draft[section], [key]: assignment } } as Partial<Draft>);
  }

  function removeEntry(section: Section, key: string): void {
    const next: Record<string, Assignment> = {};
    for (const [entryKey, value] of Object.entries(draft[section])) {
      if (entryKey !== key) next[entryKey] = value;
    }
    mutate({ [section]: next } as Partial<Draft>);
  }

  function addEntry(section: Section): void {
    const key = newKey[section].trim();
    if (key === "" || key in draft[section]) return;
    setNewKey((current) => ({ ...current, [section]: "" }));
    mutate({ [section]: { ...draft[section], [key]: { model: "" } } } as Partial<Draft>);
  }

  async function fetchDefinitions(): Promise<void> {
    setFetching(true);
    try {
      const next = await onFetchCatalog();
      if (next === null) return;
      const added = countMissing(draft.agents, next.agents) + countMissing(draft.categories, next.categories);
      if (added > 0) {
        setDraft((current) => ({
          ...current,
          agents: withMissingRows(current.agents, next.agents),
          categories: withMissingRows(current.categories, next.categories),
        }));
        setDirty(true);
      }
      setFetchStatus({ catalog: next, added });
    } finally {
      setFetching(false);
    }
  }

  function save(): void {
    const input: ProfileInput = {
      ...(draft.id === undefined ? {} : { id: draft.id }),
      name: draft.name,
      note: draft.note,
      agents: withoutBlankRows(draft.agents),
      categories: withoutBlankRows(draft.categories),
    };
    const found = validateProfileInput(input, profiles);
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    setDirty(false);
    onSave(input);
  }

  const sections: readonly { id: Section; title: string; add: string; empty: string; suggestions: readonly string[] }[] = [
    {
      id: "agents",
      title: t("editor.agents"),
      add: t("editor.addAgent"),
      empty: t("editor.noAgents"),
      suggestions: catalog.agents,
    },
    {
      id: "categories",
      title: t("editor.categories"),
      add: t("editor.addCategory"),
      empty: t("editor.noCategories"),
      suggestions: catalog.categories,
    },
  ];

  return (
    <Panel className="flex min-h-0 flex-col">
      <div className="flex flex-col gap-2 border-b border-ink-200 px-4 py-3 dark:border-ink-800">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <SectionHeading>{t("editor.title")}</SectionHeading>
            <span data-testid="catalog-source" className="text-micro text-ink-500 dark:text-ink-400">
              {t("editor.catalogSource", { source: catalogSourceLabel(catalog, t) })}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {dirty ? (
              <span className="text-micro text-warn-500">{t("editor.unsaved")}</span>
            ) : null}
            <Button
              size="sm"
              disabled={fetching}
              aria-busy={fetching}
              onClick={() => void fetchDefinitions()}
            >
              {fetching ? t("editor.fetchingCatalog") : t("editor.fetchCatalog")}
            </Button>
            <Button size="sm" variant="primary" onClick={save}>
              {t("common.save")}
            </Button>
          </div>
        </div>
        <p aria-live="polite" data-testid="catalog-status" className="text-micro text-ink-600 empty:hidden dark:text-ink-300">
          {fetchStatus === null
            ? null
            : t("editor.catalogFetched", {
                source: catalogSourceLabel(fetchStatus.catalog, t),
                agents: fetchStatus.catalog.agents.length,
                categories: fetchStatus.catalog.categories.length,
                added: fetchStatus.added,
              })}
        </p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("editor.name")} error={errors["name"] === undefined ? undefined : t(errors["name"])}>
            {(field) => (
              <TextInput
                {...field}
                value={draft.name}
                placeholder={t("editor.namePlaceholder")}
                onChange={(event) => mutate({ name: event.target.value })}
              />
            )}
          </Field>
          <Field label={t("editor.note")}>
            {(field) => (
              <TextArea
                {...field}
                rows={2}
                prose
                value={draft.note}
                placeholder={t("editor.notePlaceholder")}
                onChange={(event) => mutate({ note: event.target.value })}
              />
            )}
          </Field>
        </div>

        {sections.map((section) => {
          const entries = Object.entries(draft[section.id]);
          const listId = `${section.id}-suggestions`;
          return (
            <div key={section.id} className="mt-6">
              <div className="flex flex-wrap items-end justify-between gap-2">
                <SectionHeading>{section.title}</SectionHeading>
                <div className="flex items-end gap-1.5">
                  <Field label={t("editor.key")} labelHidden>
                    {(field) => (
                      <TextInput
                        {...field}
                        list={listId}
                        value={newKey[section.id]}
                        placeholder={t("editor.keyPlaceholder")}
                        className="w-44 font-mono text-xs"
                        onChange={(event) =>
                          setNewKey((current) => ({ ...current, [section.id]: event.target.value }))
                        }
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            addEntry(section.id);
                          }
                        }}
                      />
                    )}
                  </Field>
                  <datalist id={listId}>
                    {section.suggestions.map((suggestion) => (
                      <option key={suggestion} value={suggestion} />
                    ))}
                  </datalist>
                  <Button size="sm" onClick={() => addEntry(section.id)}>
                    {section.add}
                  </Button>
                </div>
              </div>

              {entries.length === 0 ? (
                <p className="mt-2 text-xs text-ink-500 dark:text-ink-400">{section.empty}</p>
              ) : (
                <ul className="mt-2 flex flex-col gap-2" data-testid={`${section.id}-rows`}>
                  {entries.map(([key, assignment]) => (
                    <AssignmentRow
                      key={key}
                      entryKey={key}
                      section={section.id}
                      assignment={assignment}
                      models={models}
                      providers={providers}
                      omoAvailable={omoAvailable}
                      knownKeys={section.suggestions}
                      keyError={
                        errors[`${section.id}.${key}`] === undefined
                          ? undefined
                          : t(errors[`${section.id}.${key}`] as string)
                      }
                      modelError={
                        errors[`${section.id}.${key}.model`] === undefined
                          ? undefined
                          : t(errors[`${section.id}.${key}.model`] as string)
                      }
                      onChange={(next) => setEntry(section.id, key, next)}
                      onRemove={() => removeEntry(section.id, key)}
                      onRefreshModels={onRefreshModels}
                      onConfigureProvider={onConfigureProvider}
                    />
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </Panel>
  );
}
