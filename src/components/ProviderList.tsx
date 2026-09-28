import { useTranslation } from "react-i18next";
import type { ProviderInfo, ProbeResult } from "../lib/types";
import { Badge, Button, Panel, SectionHeading } from "./primitives";

export interface ProviderListProps {
  providers: ProviderInfo[];
  probes: Record<string, ProbeResult | "pending" | undefined>;
  onToggle: (id: string, enabled: boolean) => void;
  onTest: (id: string) => void;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
  onAdd: () => void;
  onImport: () => void;
}

export function ProviderList({
  providers,
  probes,
  onToggle,
  onTest,
  onEdit,
  onDelete,
  onAdd,
  onImport,
}: ProviderListProps) {
  const { t } = useTranslation();

  return (
    <Panel className="flex min-h-0 flex-col">
      <div className="flex flex-col gap-2 border-b border-ink-200 px-3 py-3 dark:border-ink-800">
        <SectionHeading>{t("provider.title")}</SectionHeading>
        <div className="flex flex-wrap gap-1.5">
          <Button size="sm" variant="primary" onClick={onAdd}>
            {t("provider.add")}
          </Button>
          <Button size="sm" onClick={onImport}>
            {t("provider.import")}
          </Button>
        </div>
      </div>

      {providers.length === 0 ? (
        <p className="px-3 py-6 text-xs text-ink-500 dark:text-ink-400">{t("provider.empty")}</p>
      ) : (
        <ul className="relative min-h-0 flex-1 overflow-y-auto p-2">
          {providers.map((provider) => {
            const probe = probes[provider.id];
            return (
              <li key={provider.id} data-testid={`provider-row-${provider.id}`}>
                <div className="rounded-panel mb-1.5 px-2.5 py-2 transition-colors duration-150 ease-ui hover:bg-ink-100 dark:hover:bg-ink-800/60">
                  <div className="flex flex-col gap-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-ink-900 dark:text-ink-50">
                            {provider.name}
                          </span>
                          <button
                            type="button"
                            role="switch"
                            aria-checked={provider.enabled}
                            aria-label={provider.enabled ? t("provider.disable") : t("provider.enable")}
                            data-testid={`provider-toggle-${provider.id}`}
                            onClick={() => onToggle(provider.id, !provider.enabled)}
                            className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors duration-150 ease-ui focus:outline-none focus:ring-2 focus:ring-accent-500 dark:focus:ring-accent-400 ${
                              provider.enabled
                                ? "bg-accent-500"
                                : "bg-ink-300 dark:bg-ink-700"
                            }`}
                          >
                            <span
                              className={`inline-block size-4 rounded-full bg-ink-50 shadow-sm transition-transform duration-150 ease-ui ${
                                provider.enabled ? "translate-x-[18px]" : "translate-x-0.5"
                              }`}
                            />
                          </button>
                        </div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                          <span className="font-mono text-micro text-ink-500 dark:text-ink-400">
                            {provider.id}
                          </span>
                          <Badge
                            tone={provider.knownToOmo ? "good" : "neutral"}
                            data-testid={`provider-known-badge-${provider.id}`}
                          >
                            {provider.knownToOmo ? t("provider.knownToOmo") : t("provider.unknownToOmo")}
                          </Badge>
                          <Badge
                            tone={provider.hasKey ? "accent" : "neutral"}
                            data-testid={`provider-key-badge-${provider.id}`}
                          >
                            {provider.hasKey
                              ? `${t("provider.keySet")} (${t(`provider.keySource${provider.keySource.charAt(0).toUpperCase()}${provider.keySource.slice(1)}`)})`
                              : t("provider.keyNotSet")}
                          </Badge>
                        </div>
                        <span className="mt-0.5 block text-micro text-ink-400 dark:text-ink-500">
                          {provider.baseUrl}
                        </span>
                      </div>
                    </div>

                    {probe !== undefined && (
                      <div data-testid={`provider-probe-${provider.id}`}>
                        {probe === "pending" ? (
                          <Badge tone="neutral">{t("provider.testing")}</Badge>
                        ) : probe.reachable ? (
                          <Badge tone={probe.tier === "fast" ? "good" : probe.tier === "ok" ? "accent" : "warn"}>
                            {t(`provider.tier${probe.tier.charAt(0).toUpperCase()}${probe.tier.slice(1)}`)} ({t("provider.latency", { ms: probe.latencyMs })})
                          </Badge>
                        ) : (
                          <Badge tone="bad">
                            {t("provider.unreachable", { kind: probe.errorKind || "unknown" })}
                          </Badge>
                        )}
                      </div>
                    )}

                    <div className="flex flex-wrap gap-1.5">
                      <Button
                        size="sm"
                        onClick={() => onTest(provider.id)}
                        data-testid={`provider-test-${provider.id}`}
                      >
                        {t("provider.test")}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => onEdit(provider.id)}
                        data-testid={`provider-edit-${provider.id}`}
                      >
                        {t("common.edit")}
                      </Button>
                      <Button
                        size="sm"
                        variant="danger"
                        onClick={() => onDelete(provider.id)}
                        data-testid={`provider-delete-${provider.id}`}
                      >
                        {t("common.delete")}
                      </Button>
                    </div>
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
