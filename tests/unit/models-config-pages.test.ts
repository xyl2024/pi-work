import { describe, expect, it } from "vitest";
import {
  isModelsConfigFormPage,
  modelsConfigPageTitleKey,
  type ModelsConfigFormPage,
} from "@/lib/shared/models-config";

const FORM_PAGES: ModelsConfigFormPage[] = [
  { kind: "provider", name: "openai" },
  { kind: "model", providerName: "openai", index: 0 },
  { kind: "oauth", providerId: "openai" },
  { kind: "apikey", providerId: "openai" },
  { kind: "catalog" },
  { kind: "addProvider" },
  { kind: "addModelName", providerName: "openai" },
  { kind: "fillModel", providerName: "openai", index: 0 },
];

describe("models config page kinds", () => {
  it("treats the root as the only browse page", () => {
    expect(isModelsConfigFormPage({ kind: "root" })).toBe(false);
    for (const page of FORM_PAGES) {
      expect(isModelsConfigFormPage(page)).toBe(true);
    }
  });

  it("gives every form page its own title key", () => {
    const titles = FORM_PAGES.map((page) => modelsConfigPageTitleKey(page));

    expect(titles.every((title) => title.length > 0)).toBe(true);
    expect(new Set(titles).size).toBe(titles.length);
  });

  it("names the provider and model forms as edit forms", () => {
    expect(modelsConfigPageTitleKey({ kind: "provider", name: "openai" })).toBe("Edit provider");
    expect(modelsConfigPageTitleKey({ kind: "model", providerName: "openai", index: 0 })).toBe(
      "Edit model",
    );
  });
});
