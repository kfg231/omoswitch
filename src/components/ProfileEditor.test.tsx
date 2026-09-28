import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { initI18n } from "../i18n";
import { BUILTIN_CATALOG } from "../lib/catalog";
import { seedModels } from "../lib/mockData";
import type { NativeCatalog, Profile, ProfileInput } from "../lib/types";
import { ProfileEditor } from "./ProfileEditor";

beforeAll(() => {
  initI18n();
});

interface Setup {
  profile?: Profile | null;
  onFetchCatalog?: () => Promise<NativeCatalog | null>;
}

function renderEditor({ profile = null, onFetchCatalog = vi.fn().mockResolvedValue(null) }: Setup = {}) {
  const onSave = vi.fn<(input: ProfileInput) => void>();
  const view = render(
    <ProfileEditor
      profile={profile}
      profiles={[]}
      models={seedModels()}
      providers={[]}
      omoAvailable
      catalog={BUILTIN_CATALOG}
      onSave={onSave}
      onRefreshModels={vi.fn().mockResolvedValue(undefined)}
      onFetchCatalog={onFetchCatalog}
      onConfigureProvider={vi.fn()}
    />,
  );
  return { ...view, onSave };
}

function rowKeys(container: HTMLElement, section: "agents" | "categories"): string[] {
  return Array.from(
    container.querySelectorAll<HTMLInputElement>(`[data-testid="${section}-rows"] > li input[readonly]`),
    (input) => input.value,
  );
}

const existing: Profile = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Existing",
  note: "",
  agents: { explore: { model: "openai/gpt-6-sol", reasoning: "high" } },
  categories: {},
  createdAt: "2026-09-20T09:00:00Z",
  updatedAt: "2026-09-20T09:00:00Z",
};

describe("ProfileEditor", () => {
  it("prefills one blank row per catalog agent and category for a new profile", () => {
    const { container } = renderEditor();

    expect(rowKeys(container, "agents")).toEqual(BUILTIN_CATALOG.agents);
    expect(rowKeys(container, "categories")).toEqual(BUILTIN_CATALOG.categories);
    expect(screen.queryByText("保存されていない変更があります")).toBeNull();
  });

  it("saves only the rows the user filled in", () => {
    const { onSave } = renderEditor();
    fireEvent.change(screen.getByPlaceholderText("プロファイル名"), { target: { value: "Fresh" } });

    const [firstModel] = screen.getAllByLabelText("モデル", { exact: true });
    fireEvent.input(firstModel!, { target: { value: "openai/gpt-6-sol" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0]?.[0]).toEqual({
      name: "Fresh",
      note: "",
      agents: { explore: { model: "openai/gpt-6-sol" } },
      categories: {},
    });
  });

  it("still requires a model on a partially filled row", () => {
    const { onSave } = renderEditor();
    fireEvent.change(screen.getByPlaceholderText("プロファイル名"), { target: { value: "Fresh" } });

    const [firstReasoning] = screen.getAllByLabelText("推論レベル");
    fireEvent.change(firstReasoning!, { target: { value: "high" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText("モデルを入力してください")).toBeTruthy();
  });

  it("adds only missing rows when fetching the latest definitions", async () => {
    const fetched: NativeCatalog = {
      agents: [...BUILTIN_CATALOG.agents, "new-agent"],
      categories: [...BUILTIN_CATALOG.categories],
      source: "installed",
      omoVersion: "5.0.1",
      fetchedAt: "2026-09-28T00:00:00Z",
    };
    const onFetchCatalog = vi.fn().mockResolvedValue(fetched);
    const { container } = renderEditor({ profile: existing, onFetchCatalog });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "最新のエージェント定義を取得" }));
    });

    expect(rowKeys(container, "agents")).toEqual(["explore", ...fetched.agents.filter((key) => key !== "explore")]);
    expect(rowKeys(container, "categories")).toEqual(fetched.categories);
    expect(screen.getAllByLabelText("モデル", { exact: true })[0]).toHaveProperty("value", "openai/gpt-6-sol");
    expect(screen.getByTestId("catalog-status").textContent).toBe(
      "omo 5.0.1 から取得: エージェント 8 / カテゴリ 10（17 行追加）",
    );
    expect(screen.getByText("保存されていない変更があります")).toBeTruthy();
  });

  it("leaves the draft clean when the fetched definitions add nothing", async () => {
    const onFetchCatalog = vi.fn().mockResolvedValue({ ...BUILTIN_CATALOG, source: "installed", omoVersion: "5.0.1" });
    const { container } = renderEditor({ onFetchCatalog });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "最新のエージェント定義を取得" }));
    });

    expect(rowKeys(container, "agents")).toHaveLength(7);
    expect(screen.getByTestId("catalog-status").textContent).toContain("（0 行追加）");
    expect(screen.queryByText("保存されていない変更があります")).toBeNull();
  });
});
