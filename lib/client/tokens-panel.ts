"use client";

import { createPanelViewStore, type PanelViewAdapter, type PanelViewWriter } from "./panel-view-store";
import { errorMessage } from "@/lib/shared/error-message";
import type { Range, SummarizeResult } from "@/lib/shared/token-audit-types";

export type TokenCategoryMetric = "cost" | "tokens";

export interface TokensViewState {
  range: Range;
  cwdFilter: string | null;
  categoryMetric: TokenCategoryMetric;
  cwds: string[];
  loading: boolean;
  loaded: boolean;
  time: SummarizeResult | null;
  model: SummarizeResult | null;
  heatmap: SummarizeResult | null;
  loadError: string | null;
}

type TokensPage = { kind: "root" };

const ROOT_PAGE: TokensPage = { kind: "root" };

const INITIAL: TokensViewState = {
  range: "7d",
  cwdFilter: null,
  categoryMetric: "cost",
  cwds: [],
  loading: false,
  loaded: false,
  time: null,
  model: null,
  heatmap: null,
  loadError: null,
};

function timeGroupBy(range: Range): "hour" | "day" {
  return range === "today" ? "hour" : "day";
}

function cwdParam(cwdFilter: string | null): string {
  return cwdFilter ? `&cwd=${encodeURIComponent(cwdFilter)}` : "";
}

const tokensAdapter: PanelViewAdapter<TokensViewState, TokensPage, void, string> = {
  kind: "tokens",
  initial: INITIAL,
  rootPage: ROOT_PAGE,
  loadPolicy: "once",
  key: () => "tokens",
  async load(_key, { get, patch }) {
    const { range, cwdFilter } = get();
    patch({ loading: true, loadError: null });
    try {
      const cwd = cwdParam(cwdFilter);
      const [timeRes, modelRes, heatmapRes] = await Promise.all([
        fetch(`/api/token-audit/summary?range=${range}&groupBy=${timeGroupBy(range)}${cwd}`),
        fetch(`/api/token-audit/summary?range=${range}&groupBy=model${cwd}`),
        fetch(`/api/token-audit/summary?range=30d&groupBy=day${cwd}`),
      ]);
      if (!timeRes.ok || !modelRes.ok || !heatmapRes.ok) {
        throw new Error(`HTTP ${timeRes.status}/${modelRes.status}/${heatmapRes.status}`);
      }
      const [time, model, heatmap] = (await Promise.all([
        timeRes.json(),
        modelRes.json(),
        heatmapRes.json(),
      ])) as [SummarizeResult, SummarizeResult, SummarizeResult];
      patch({ loading: false, loaded: true, time, model, heatmap, loadError: null });
    } catch (error) {
      patch({ loading: false, loadError: errorMessage(error) });
    }
  },
  start(writer: PanelViewWriter<TokensViewState, TokensPage>) {
    void fetch("/api/workspaces?limit=10000")
      .then((res) =>
        res.ok
          ? (res.json() as Promise<{ workspaces?: Array<{ cwd?: string }> }>)
          : Promise.reject(new Error("failed to load cwds")),
      )
      .then((data) =>
        writer.patch({
          cwds: (data.workspaces ?? [])
            .map((workspace) => workspace.cwd)
            .filter((cwd): cwd is string => !!cwd),
        }),
      )
      .catch(() => {});
  },
  release() {},
  guard: () => null,
  status: () => null,
};

export const tokensPanel = createPanelViewStore(tokensAdapter);

export function openTokens(): void {
  tokensPanel.open();
}

export function setTokensRange(range: Range): void {
  if (tokensPanel.get().range === range) return;
  tokensPanel.patch({ range });
  tokensPanel.reload();
}

export function setTokensCwd(cwdFilter: string | null): void {
  if (tokensPanel.get().cwdFilter === cwdFilter) return;
  tokensPanel.patch({ cwdFilter });
  tokensPanel.reload();
}

export function setTokensCategoryMetric(categoryMetric: TokenCategoryMetric): void {
  tokensPanel.patch({ categoryMetric });
}

export function useTokensPanel() {
  return tokensPanel.useSnapshot();
}
