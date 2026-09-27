import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { KNOWN_AGENTS, KNOWN_CATEGORIES } from "../lib/catalog";
import { validateProfileInput, type ValidationErrors } from "../lib/assignment";
import type { Assignment, ModelInfo, Profile, ProfileInput } from "../lib/types";
import { AssignmentRow } from "./AssignmentRow";
import { Button, Field, Panel, SectionHeading, TextArea, TextInput } from "./primitives";

export interface ProfileEditorProps {
  profile: Profile | null;
  profiles: readonly Profile[];
  models: readonly ModelInfo[];
  omoAvailable: boolean;
  onSave: (input: ProfileInput) => void;
  onRefreshModels: () => void;
}

interface Draft {
  id?: string;
  name: string;
  note: string;
  agents: Record<string, Assignment>;
  categories: Record<string, Assignment>;
}

function draftOf(profile: Profile | null): Draft {
  if (profile === null) return { name: "", note: "", agents: {}, categories: {} };
  return {
    id: profile.id,
    name: profile.name,
    note: profile.note,
    agents: structuredClone(profile.agents),
    categories: structuredClone(profile.categories),
  };
}

type Section = "agents" | "categories";

export function ProfileEditor({
  profile,
  profiles,
  models,
  omoAvailable,
  onSave,
  onRefreshModels,
}: ProfileEditorProps) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<Draft>(() => draftOf(profile));
  const [dirty, setDirty] = useState(false);
  const [errors, setErrors] = useState<ValidationErrors>({});
  const [newKey, setNewKey] = useState<Record<Section, string>>({ agents: "", categories: "" });

  useEffect(() => {
    setDraft(draftOf(profile));
    setDirty(false);
    setErrors({});
    setNewKey({ agents: "", categories: "" });
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

  function save(): void {
    const input: ProfileInput = {
      ...(draft.id === undefined ? {} : { id: draft.id }),
      name: draft.name,
      note: draft.note,
      agents: draft.agents,
      categories: draft.categories,
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
      suggestions: KNOWN_AGENTS,
    },
    {
      id: "categories",
      title: t("editor.categories"),
      add: t("editor.addCategory"),
      empty: t("editor.noCategories"),
      suggestions: KNOWN_CATEGORIES,
    },
  ];

  return (
    <Panel className="flex min-h-0 flex-col">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-200 px-4 py-3 dark:border-ink-800">
        <SectionHeading>{t("editor.title")}</SectionHeading>
        <div className="flex items-center gap-2">
          {dirty ? (
            <span className="text-micro text-warn-500">{t("editor.unsaved")}</span>
          ) : null}
          <Button size="sm" variant="primary" onClick={save}>
            {t("common.save")}
          </Button>
        </div>
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
                <ul className="mt-2 flex flex-col gap-2">
                  {entries.map(([key, assignment]) => (
                    <AssignmentRow
                      key={key}
                      entryKey={key}
                      section={section.id}
                      assignment={assignment}
                      models={models}
                      omoAvailable={omoAvailable}
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
