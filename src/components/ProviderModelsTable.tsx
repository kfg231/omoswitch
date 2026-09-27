import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ProviderModel } from "../lib/types";
import { ImeSafeInput } from "./ImeSafeInput";
import { Button, SectionHeading } from "./primitives";

export interface ProviderModelsTableProps {
  models: ProviderModel[];
  onChange: (models: ProviderModel[]) => void;
  fetched?: string[] | null;
}

interface ModelRow {
  rowId: string;
  model: ProviderModel;
}

let rowCounter = 0;

export function ProviderModelsTable({ models, onChange, fetched }: ProviderModelsTableProps) {
  const { t } = useTranslation();
  const [rows, setRows] = useState<ModelRow[]>(() =>
    models.map((model) => ({ rowId: `row-${rowCounter++}`, model }))
  );
  const [selectedFetched, setSelectedFetched] = useState<Set<string>>(new Set());

  useEffect(() => {
    setRows(models.map((model) => ({ rowId: `row-${rowCounter++}`, model })));
  }, [models]);

  function updateRow(rowId: string, model: ProviderModel): void {
    const updated = rows.map((row) => (row.rowId === rowId ? { ...row, model } : row));
    setRows(updated);
    onChange(updated.map((row) => row.model));
  }

  function addRow(): void {
    const newRow: ModelRow = { rowId: `row-${rowCounter++}`, model: { id: "" } };
    const updated = [...rows, newRow];
    setRows(updated);
    onChange(updated.map((row) => row.model));
  }

  function removeRow(rowId: string): void {
    const updated = rows.filter((row) => row.rowId !== rowId);
    setRows(updated);
    onChange(updated.map((row) => row.model));
  }

  function addSelectedFetched(): void {
    const existingIds = new Set(rows.map((row) => row.model.id));
    const toAdd = Array.from(selectedFetched).filter((id) => !existingIds.has(id));
    const newRows = toAdd.map((id) => ({ rowId: `row-${rowCounter++}`, model: { id } }));
    const updated = [...rows, ...newRows];
    setRows(updated);
    onChange(updated.map((row) => row.model));
    setSelectedFetched(new Set());
  }

  const fetchedFiltered = fetched?.filter((id) => !rows.some((row) => row.model.id === id)) ?? [];

  return (
    <div data-testid="models-table">
      <div className="flex items-center justify-between gap-2">
        <SectionHeading>{t("provider.models")}</SectionHeading>
        <Button size="sm" onClick={addRow} data-testid="model-add">
          {t("provider.addModel")}
        </Button>
      </div>

      {rows.length === 0 ? (
        <p className="mt-2 text-xs text-ink-500 dark:text-ink-400">{t("provider.noModels")}</p>
      ) : (
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-ink-200 dark:border-ink-800">
                <th className="pb-1.5 pr-2 text-left text-micro font-medium uppercase tracking-wide text-ink-500 dark:text-ink-400">
                  {t("provider.modelId")}
                </th>
                <th className="pb-1.5 pr-2 text-left text-micro font-medium uppercase tracking-wide text-ink-500 dark:text-ink-400">
                  {t("provider.modelName")}
                </th>
                <th className="pb-1.5 w-20" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.rowId} data-testid="model-row" className="border-b border-ink-100 dark:border-ink-800/60">
                  <td className="py-2 pr-2">
                    <ImeSafeInput
                      value={row.model.id}
                      onCommit={(value) => updateRow(row.rowId, { ...row.model, id: value })}
                      className="font-mono text-xs"
                      data-testid="model-id-input"
                    />
                  </td>
                  <td className="py-2 pr-2">
                    <ImeSafeInput
                      value={row.model.name ?? ""}
                      onCommit={(value) => updateRow(row.rowId, { ...row.model, name: value || undefined })}
                      data-testid="model-name-input"
                    />
                  </td>
                  <td className="py-2 text-right">
                    <Button
                      size="sm"
                      variant="danger"
                      onClick={() => removeRow(row.rowId)}
                      data-testid="model-remove"
                    >
                      {t("common.remove")}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {fetchedFiltered.length > 0 && (
        <div className="mt-4">
          <div className="flex items-center justify-between gap-2">
            <SectionHeading>{t("provider.fetchedModels")}</SectionHeading>
            <Button
              size="sm"
              onClick={addSelectedFetched}
              disabled={selectedFetched.size === 0}
              data-testid="fetched-add"
            >
              {t("provider.addSelected")}
            </Button>
          </div>
          <div className="mt-2 flex max-h-40 flex-col gap-1.5 overflow-y-auto rounded-md bg-ink-100 p-2 dark:bg-ink-800/60">
            {fetchedFiltered.map((id) => (
              <label
                key={id}
                className="flex items-center gap-2 text-sm text-ink-800 dark:text-ink-100"
              >
                <input
                  type="checkbox"
                  checked={selectedFetched.has(id)}
                  onChange={(e) => {
                    const next = new Set(selectedFetched);
                    if (e.target.checked) {
                      next.add(id);
                    } else {
                      next.delete(id);
                    }
                    setSelectedFetched(next);
                  }}
                  className="size-4 rounded border-ink-300 text-accent-500 focus:ring-2 focus:ring-accent-500 dark:border-ink-700 dark:focus:ring-accent-400"
                  data-testid={`fetched-model-${id}`}
                />
                <span className="font-mono text-xs">{id}</span>
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
