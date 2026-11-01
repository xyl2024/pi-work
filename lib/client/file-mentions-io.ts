import type { DirectoryListingAdapter, DirectoryListingSourceEntry } from "./directory-listing";

export function createFileMentionAdapter(cwd: string): DirectoryListingAdapter {
  return {
    async list(directory, { signal }): Promise<readonly DirectoryListingSourceEntry[]> {
      if (!cwd) return [];
      const params = new URLSearchParams({ cwd, directory });
      const response = await fetch(`/api/file-mentions?${params}`, { signal });
      if (!response.ok) throw new Error("Failed to load files");
      const data = await response.json() as { entries?: DirectoryListingSourceEntry[] };
      return data.entries ?? [];
    },
  };
}
