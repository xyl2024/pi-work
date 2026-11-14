"use client";

import { useEffect, useMemo, useState } from "react";
import { Field, GroupedSelect } from "./controls";

interface ModelOption {
  id: string;
  name: string;
  provider: string;
}

export interface ModelSelection {
  provider: string;
  modelId: string;
}

export function ModelSelect({
  label,
  value,
  onChange,
  leadingOption,
  width,
}: {
  label?: string;
  width?: number;
  value: ModelSelection | null;
  onChange: (value: ModelSelection | null) => void;
  leadingOption: { value: string; label: string };
}) {
  const [models, setModels] = useState<ModelOption[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/models")
      .then((response) => response.json())
      .then((data: { modelList?: ModelOption[] }) => {
        if (!cancelled) setModels(data.modelList ?? []);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const groupedModels = useMemo(() => {
    const groups = new Map<string, ModelOption[]>();
    for (const model of models) {
      const group = groups.get(model.provider) ?? [];
      group.push(model);
      groups.set(model.provider, group);
    }
    return [...groups.entries()];
  }, [models]);

  const select = (
    <GroupedSelect
      value={value ? `${value.provider}:${value.modelId}` : leadingOption.value}
      disabled={models.length === 0}
      leadingOption={leadingOption}
      groups={groupedModels.map(([provider, providerModels]) => ({
        label: provider,
        options: providerModels.map((model) => ({
          value: `${model.provider}:${model.id}`,
          label: model.name,
        })),
      }))}
      onChange={(next) => {
        if (next === leadingOption.value) {
          onChange(null);
          return;
        }
        const [provider, ...id] = next.split(":");
        onChange({ provider, modelId: id.join(":") });
      }}
      style={width === undefined ? undefined : { width }}
    />
  );
  if (label === undefined) return select;
  return <Field label={label}>{select}</Field>;
}
