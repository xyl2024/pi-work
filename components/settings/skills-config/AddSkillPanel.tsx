"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type { SkillSearchResult } from "@/app/api/skills/search/route";
import { useI18n } from "@/hooks/useI18n";
import { useToast } from "@/components/ui/Toast";
import { shortenPath } from "./utils";
import { avatarPalette } from "./SkillCard";
import { TruncatedText } from "./TruncatedText";

/**
 * Card for one skills.sh search result. Mirrors the look of `SkillCard`
 * (initial-letter avatar + name + 2-line description) so the Add-Skill
 * results read as the same kind of object as the installed skills — but
 * the header's trailing control is an Install button instead of a toggle,
 * and a meta row carries the repo path / install count / skills.sh link.
 */
function ResultCard({
  result,
  isInstalled,
  isInstalling,
  installDisabled,
  onInstall,
}: {
  result: SkillSearchResult;
  isInstalled: boolean;
  isInstalling: boolean;
  installDisabled: boolean;
  onInstall: () => void;
}) {
  const { t } = useI18n();
  const atIdx = result.package.indexOf("@");
  const repoPart = atIdx > -1 ? result.package.slice(0, atIdx) : result.package;
  const skillName = atIdx > -1 ? result.package.slice(atIdx + 1) : repoPart;
  const palette = avatarPalette(skillName);
  const initial = (skillName.trim()[0] ?? "?").toUpperCase();
  const blocked = isInstalled || isInstalling || installDisabled;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 10,
        padding: "14px 16px",
        background: "transparent",
        border: "1px solid var(--border)",
        borderRadius: 12,
        transition: "background 0.12s, border-color 0.12s",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = "var(--bg-panel)";
        e.currentTarget.style.borderColor = "var(--text-dim)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "transparent";
        e.currentTarget.style.borderColor = "var(--border)";
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span
          style={{
            flexShrink: 0,
            width: 30,
            height: 30,
            borderRadius: "50%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: palette.bg,
            color: palette.fg,
            fontSize: 14,
            fontWeight: 700,
          }}
        >
          {initial}
        </span>
        <TruncatedText
          text={skillName}
          side="bottom"
          always
          style={{
            flex: 1,
            minWidth: 0,
            fontSize: 14,
            fontWeight: 600,
            color: "var(--text)",
            fontFamily: "var(--font-mono)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        />
        <button
          onClick={onInstall}
          disabled={blocked}
          style={{
            flexShrink: 0,
            padding: "4px 10px",
            fontSize: 11.5,
            fontWeight: 500,
            borderRadius: 6,
            border: "1px solid var(--border)",
            cursor: blocked ? "not-allowed" : "pointer",
            background: isInstalled ? "rgba(34,197,94,0.1)" : "none",
            color: isInstalled ? "#16a34a" : isInstalling ? "var(--accent)" : "var(--text-muted)",
            transition: "color 0.12s, background 0.12s",
          }}
        >
          {isInstalled ? t("Installed") : isInstalling ? t("Installing...") : t("Install")}
        </button>
      </div>

      <TruncatedText
        text={result.description}
        side="bottom"
        style={{
          display: "-webkit-box",
          WebkitLineClamp: 2,
          WebkitBoxOrient: "vertical",
          overflow: "hidden",
          minHeight: 38,
          fontSize: 12.5,
          lineHeight: 1.55,
          color: "var(--text-muted)",
        }}
      />

      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            color: "var(--text-dim)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {repoPart}
        </span>
        {result.installs && (
          <span style={{ fontSize: 11.5, color: "var(--text-muted)", fontWeight: 500 }}>
            {result.installs}
          </span>
        )}
        {result.url && (
          <a
            href={result.url}
            target="_blank"
            rel="noreferrer"
            style={{ fontSize: 11.5, color: "var(--accent)", textDecoration: "none" }}
          >
            skills.sh ↗
          </a>
        )}
      </div>
    </div>
  );
}

const PAGE_SIZE = 6;
// Reveal the next page when the list is scrolled within this many px of the
// bottom, so the new cards are already there by the time the user arrives.
const SCROLL_THRESHOLD_PX = 240;

/**
 * Add-Skill tab inside the SkillsConfig modal. Searches the skills.sh
 * marketplace, then installs into either the global path (`~/.pi/agent/skills/`)
 * or the project path (`<cwd>/.pi/agent/skills/`) depending on scope.
 *
 * Network calls:
 *   • POST /api/skills/search  { query, page } → { results, page, hasMore }
 *     Upstream skills.sh has no offset, so "page N" is served by asking for
 *     `6 × N` results and taking the tail — this panel shows 6 cards and pulls
 *     the next page on scroll.
 *   • POST /api/skills/install { package, scope, cwd } → { success, error? }
 *
 * Self-contained state machine: search / paging / install. The parent gets
 * a fire-and-forget `onInstalled()` callback so it can refresh the skill list.
 */
export function AddSkillPanel({
  cwd,
  onInstalled,
}: {
  cwd: string;
  onInstalled: () => void;
}) {
  const { t } = useI18n();
  const toast = useToast();
  const [query, setQuery] = useState("");
  const [activeQuery, setActiveQuery] = useState("");
  const [results, setResults] = useState<SkillSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [installing, setInstalling] = useState<string | null>(null);
  const [installError, setInstallError] = useState<string | null>(null);
  const [installedPkgs, setInstalledPkgs] = useState<Set<string>>(new Set());
  const [scope, setScope] = useState<"global" | "project">("global");
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  // Guards against a stale response from a previous query overwriting the
  // current one (fast consecutive searches).
  const requestSeqRef = useRef(0);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const fetchPage = useCallback(async (q: string, nextPage: number) => {
    const res = await fetch("/api/skills/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: q, page: nextPage, pageSize: PAGE_SIZE }),
    });
    const d = (await res.json()) as {
      results?: SkillSearchResult[];
      page?: number;
      hasMore?: boolean;
      error?: string;
    };
    if (d.error) throw new Error(d.error);
    return {
      results: d.results ?? [],
      page: d.page ?? nextPage,
      hasMore: d.hasMore ?? false,
    };
  }, []);

  const search = useCallback(async (q: string) => {
    const trimmed = q.trim();
    if (!trimmed) return;
    const seq = ++requestSeqRef.current;
    setSearching(true);
    setSearchError(null);
    setResults([]);
    setPage(1);
    setHasMore(false);
    setActiveQuery(trimmed);
    if (listRef.current) listRef.current.scrollTop = 0;
    try {
      const data = await fetchPage(trimmed, 1);
      if (seq !== requestSeqRef.current) return;
      setResults(data.results);
      setPage(data.page);
      setHasMore(data.hasMore);
      if (data.results.length === 0) setSearchError(t("No skills found"));
    } catch (e) {
      if (seq !== requestSeqRef.current) return;
      setSearchError(String(e));
    } finally {
      if (seq === requestSeqRef.current) setSearching(false);
    }
  }, [fetchPage, t]);

  const loadMore = useCallback(async () => {
    if (!activeQuery || loadingMore || searching || !hasMore) return;
    const seq = requestSeqRef.current;
    setLoadingMore(true);
    try {
      const data = await fetchPage(activeQuery, page + 1);
      if (seq !== requestSeqRef.current) return;
      setResults((prev) => [...prev, ...data.results]);
      setPage(data.page);
      setHasMore(data.hasMore);
    } catch (e) {
      if (seq !== requestSeqRef.current) return;
      setSearchError(String(e));
      setHasMore(false);
    } finally {
      if (seq === requestSeqRef.current) setLoadingMore(false);
    }
  }, [activeQuery, loadingMore, searching, hasMore, page, fetchPage]);

  const handleScroll = useCallback(() => {
    const el = listRef.current;
    if (!el || !hasMore || loadingMore || searching) return;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < SCROLL_THRESHOLD_PX) {
      void loadMore();
    }
  }, [hasMore, loadingMore, searching, loadMore]);

  const install = useCallback(
    async (pkg: string) => {
      setInstalling(pkg);
      setInstallError(null);
      try {
        const res = await fetch("/api/skills/install", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ package: pkg, scope, cwd }),
        });
        const d = (await res.json()) as { success?: boolean; error?: string };
        if (!res.ok || d.error) {
          setInstallError(d.error ?? `HTTP ${res.status}`);
          toast.show({ kind: "error", message: d.error ?? `HTTP ${res.status}` });
          return;
        }
        setInstalledPkgs((prev) => new Set(prev).add(pkg));
        onInstalled();
        toast.show({ kind: "success", message: t("Skill installed") });
      } catch (e) {
        setInstallError(String(e));
        toast.show({ kind: "error", message: String(e) });
      } finally {
        setInstalling(null);
      }
    },
    [onInstalled, scope, cwd, t, toast],
  );

  const installPath =
    scope === "global"
      ? "~/.pi/agent/skills/"
      : `${shortenPath(cwd)}/.pi/agent/skills/`;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* ── Header area ── */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 12,
          marginBottom: 20,
        }}
      >
        <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text)" }}>
          {t("Add Skill")}
        </div>

        {/* Search row */}
        <div style={{ display: "flex", gap: 8 }}>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") search(query);
            }}
            placeholder="e.g. react, testing, deploy"
            style={{
              flex: 1,
              padding: "7px 10px",
              fontSize: 13,
              background: "var(--bg)",
              border: "1px solid var(--border)",
              borderRadius: 6,
              color: "var(--text)",
            }}
          />
          <button
            onClick={() => search(query)}
            disabled={searching || !query.trim()}
            style={{
              padding: "7px 16px",
              fontSize: 13,
              borderRadius: 6,
              border: "none",
              background: "var(--accent)",
              color: "#fff",
              cursor: searching || !query.trim() ? "not-allowed" : "pointer",
              opacity: searching || !query.trim() ? 0.5 : 1,
              flexShrink: 0,
            }}
          >
            {searching ? t("Searching...") : t("Search")}
          </button>
        </div>

        {/* Scope + install path row */}
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div
            style={{
              display: "flex",
              borderRadius: 5,
              border: "1px solid var(--border)",
              overflow: "hidden",
              fontSize: 12,
              flexShrink: 0,
            }}
          >
            {(["global", "project"] as const).map((s) => (
              <button
                key={s}
                onClick={() => setScope(s)}
                style={{
                  padding: "3px 10px",
                  border: "none",
                  cursor: "pointer",
                  background: scope === s ? "var(--bg-selected)" : "none",
                  color: scope === s ? "var(--text)" : "var(--text-dim)",
                  fontWeight: scope === s ? 600 : 400,
                  borderRight:
                    s === "global" ? "1px solid var(--border)" : "none",
                }}
              >
                {t(s)}
              </button>
            ))}
          </div>
          <span
            style={{
              fontSize: 12,
              color: "var(--text-dim)",
              fontFamily: "var(--font-mono)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            → {installPath}
          </span>
        </div>

        {/* Errors */}
        {searchError && (
          <div style={{ fontSize: 12, color: "#f87171" }}>{searchError}</div>
        )}
        {installError && (
          <div
            style={{ fontSize: 12, color: "#f87171", wordBreak: "break-word" }}
          >
            {installError}
          </div>
        )}
      </div>

      {/* ── Results ── */}
      {results.length > 0 ? (
        <div
          ref={listRef}
          onScroll={handleScroll}
          data-scroll-wide
          style={{ flex: 1, overflowY: "auto" }}
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))",
              gap: 12,
            }}
          >
            {results.map((r) => (
              <ResultCard
                key={r.package}
                result={r}
                isInstalled={installedPkgs.has(r.package)}
                isInstalling={installing === r.package}
                installDisabled={installing !== null}
                onInstall={() => install(r.package)}
              />
            ))}
          </div>

          {/* Paging footer — explicit "Search more" button in addition to
              the scroll-triggered auto-load. */}
          <div
            style={{
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
              padding: "14px 0 4px",
            }}
          >
            {hasMore ? (
              <button
                onClick={() => void loadMore()}
                disabled={loadingMore || searching}
                style={{
                  padding: "6px 18px",
                  fontSize: 12.5,
                  borderRadius: 6,
                  border: "1px solid var(--border)",
                  background: "none",
                  color: "var(--text-muted)",
                  cursor: loadingMore || searching ? "not-allowed" : "pointer",
                  opacity: loadingMore || searching ? 0.6 : 1,
                  transition: "background 0.12s, color 0.12s",
                }}
                onMouseEnter={(e) => {
                  if (!loadingMore && !searching) {
                    e.currentTarget.style.background = "var(--bg-hover)";
                    e.currentTarget.style.color = "var(--text)";
                  }
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "none";
                  e.currentTarget.style.color = "var(--text-muted)";
                }}
              >
                {loadingMore ? t("Loading...") : t("Search more")}
              </button>
            ) : (
              <span style={{ fontSize: 12, color: "var(--text-dim)" }}>
                {results.length}
              </span>
            )}
          </div>
        </div>
      ) : (
        !searchError &&
        !searching && (
          <div
            style={{ fontSize: 13, color: "var(--text-dim)", lineHeight: 1.8 }}
          >
            {t("Search skills hint")}
          </div>
        )
      )}
    </div>
  );
}
