"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useToast } from "@/components/ui/Toast";
import type { CatalogModelEntry } from "@/lib/shared/catalog-search";
import type { RuntimeCatalog } from "./types";

export interface RuntimeCatalogEntries {
  entries: CatalogModelEntry[];
  loading: boolean;
  error: string | null;
}

export function useRuntimeCatalogEntries(): RuntimeCatalogEntries {
  const { t } = useI18n();
  const toast = useToast();
  const [state, setState] = useState<RuntimeCatalogEntries>({ entries: [], loading: true, error: null });

  useEffect(() => {
    let cancelled = false;
    setState({ entries: [], loading: true, error: null });
    fetch("/api/models", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error(`HTTP ${response.status}`))))
      .then((data: { catalog?: RuntimeCatalog }) => {
        if (cancelled) return;
        setState({
          entries: (data.catalog?.providers ?? []).flatMap((provider) =>
            provider.models.map((model) => ({ model, providerName: provider.name })),
          ),
          loading: false,
          error: null,
        });
      })
      .catch((e) => {
        if (cancelled) return;
        const message = e instanceof Error && e.message ? e.message : t("Failed to load model catalog");
        setState({ entries: [], loading: false, error: message });
        toast.show({ kind: "error", message });
      });
    return () => {
      cancelled = true;
    };
  }, [t, toast]);

  return state;
}
