"use client";

/**
 * GitHub Trending right-panel tab.
 *
 * Single-view panel: language search box (All + curated hot languages) ·
 * since segment tabs (Today / This week / This month) · refresh button.
 * Rows show rank, owner/name, description, language dot, official star
 * figures and a copy-prompt button that puts a "clone & study this repo"
 * agent prompt on the clipboard.
 *
 * Fetch semantics: opening the panel loads `all + daily` (one request).
 * Switching lang/since fetches that (lang, since) key; cached-fresh rows
 * return instantly, expired rows refresh synchronously with a stale-data
 * fallback (`stale: true` banners the list). The refresh button forces a
 * re-scrape of the current view.
 */

import { useCallback, useEffect, useMemo, useState, type ReactElement } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useToast } from "@/components/ui/Toast";
import { Tooltip } from "@/components/ui/Tooltip";
import { RefreshIconButton } from "@/components/ui/RefreshIconButton";
import { CloseIcon, CopyIcon } from "@/components/ui/icons/primitives";
import { copyText } from "@/lib/client/clipboard";
import { relativeTime } from "@/components/rss/relativeTime";
import {
  HOT_TRENDING_LANGUAGES,
  TRENDING_SINCES,
  clonePrompt,
  languageLabel,
  type TrendingLang,
  type TrendingRepo,
  type TrendingResponse,
  type TrendingSince,
} from "@/lib/shared/github-trending";

// ── Shared panel styles (mirror the RSS panel's inline-style primitives) ─
const iconBtnStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: 26,
  height: 26,
  padding: 0,
  background: "transparent",
  border: "none",
  borderRadius: 5,
  color: "var(--text-dim)",
  cursor: "pointer",
  flexShrink: 0,
  transition: "color 120ms ease, background-color 120ms ease",
};

const emptyStyle: React.CSSProperties = {
  padding: "32px 16px",
  textAlign: "center",
  color: "var(--text-muted)",
  fontSize: 12,
};

const sinceTabStyle = (active: boolean): React.CSSProperties => ({
  border: "none",
  background: "transparent",
  color: active ? "var(--text)" : "var(--text-dim)",
  fontWeight: active ? 600 : 400,
  fontSize: 12,
  padding: "3px 8px",
  borderRadius: 5,
  cursor: "pointer",
  transition: "color 120ms ease, background-color 120ms ease",
});

const chipStyle = (active: boolean): React.CSSProperties => ({
  border: `1px solid ${active ? "var(--accent)" : "var(--border)"}`,
  background: active ? "var(--bg-hover)" : "transparent",
  color: active ? "var(--accent)" : "var(--text-dim)",
  borderRadius: 999,
  padding: "2px 9px",
  fontSize: 11,
  cursor: "pointer",
  transition: "color 120ms ease, background-color 120ms ease, border-color 120ms ease",
});

// ── Row skeleton (mirrors a real row's layout) ────────────────────────────
function RowSkeleton(): ReactElement {
  const bar = (w: string, h: number): React.CSSProperties => ({
    height: h,
    width: w,
    borderRadius: 3,
    background: "var(--border)",
    opacity: 0.6,
  });
  return (
    <div style={{ padding: "10px 12px", margin: "2px 8px", borderRadius: 8 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <div style={bar("16px", 12)} />
        <div style={{ ...bar("140px", 13), opacity: 0.9 }} />
      </div>
      <div style={bar("100%", 11)} />
      <div style={{ ...bar("70%", 11), marginTop: 4 }} />
    </div>
  );
}

// ── One trending row ──────────────────────────────────────────────────────
interface RowProps {
  repo: TrendingRepo;
  onCopyPrompt: (repo: TrendingRepo) => void;
}
function TrendingRow({ repo, onCopyPrompt }: RowProps): ReactElement {
  const { t } = useI18n();
  return (
    <div
      style={{
        display: "block",
        width: "auto",
        background: "transparent",
        borderRadius: 8,
        margin: "2px 8px",
        padding: "10px 12px",
        color: "var(--text)",
        font: "inherit",
        transition: "background-color 120ms ease",
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLElement).style.background = "var(--bg-hover)";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLElement).style.background = "transparent";
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            color: "var(--text-dim)",
            flexShrink: 0,
          }}
        >
          {repo.rank}
        </span>
        <span style={{ flex: 1, fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {repo.owner} / {repo.name}
        </span>
        <Tooltip content={t("Copy prompt")}>
          <button
            type="button"
            onClick={() => onCopyPrompt(repo)}
            style={{ ...iconBtnStyle, width: 22, height: 22 }}
            aria-label={t("Copy prompt")}
          >
            <CopyIcon size={13} />
          </button>
        </Tooltip>
      </div>
      {repo.description && (
        <p
          style={{
            margin: "4px 0 0",
            fontSize: 12,
            color: "var(--text-muted)",
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
            lineHeight: "1.45",
          }}
        >
          {repo.description}
        </p>
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 6, fontSize: 12 }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5, color: "var(--text-muted)" }}>
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: "var(--text-dim)",
              flexShrink: 0,
            }}
          />
          {repo.language || "—"}
        </span>
        {repo.totalStars && (
          <span style={{ color: "var(--text-dim)", fontFamily: "var(--font-mono)", fontSize: 11 }}>
            ★ {repo.totalStars}
          </span>
        )}
        {repo.periodStars && (
          <span style={{ color: "var(--accent)", fontFamily: "var(--font-mono)", fontSize: 11 }}>
            {repo.periodStars}
          </span>
        )}
      </div>
    </div>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────
export function GitHubTrendingPanel(): ReactElement {
  const { t } = useI18n();
  const toast = useToast();

  const [lang, setLang] = useState<TrendingLang>("all");
  const [since, setSince] = useState<TrendingSince>("daily");
  // Free-text language search (replaces the dropdown). Empty query = "all".
  const [langQuery, setLangQuery] = useState("");
  const [langFocused, setLangFocused] = useState(false);
  const [data, setData] = useState<TrendingResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (l: TrendingLang, s: TrendingSince, refresh: boolean) => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({ lang: l, since: s });
        if (refresh) params.set("refresh", "1");
        const res = await fetch(`/api/github-trending?${params.toString()}`);
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { error?: string } | null;
          throw new Error(body?.error ?? `HTTP ${res.status}`);
        }
        const json = (await res.json()) as TrendingResponse;
        setData(json);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setData(null);
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  // Language matching over the curated hot-language table: case-insensitive
  // substring against slug or display label. Empty query lists every option
  // (discovery); a uniquely-matching query auto-applies.
  const langMatches = useMemo<Array<[string, string]>>(() => {
    const q = langQuery.trim().toLowerCase();
    const entries = Object.entries(HOT_TRENDING_LANGUAGES);
    if (!q) return entries;
    return entries.filter(
      ([slug, label]) =>
        slug.toLowerCase().includes(q) || label.toLowerCase().includes(q),
    );
  }, [langQuery]);

  // Auto-apply when the query uniquely identifies one language ("py" →
  // Python, "typescript" → TypeScript). Multi-way matches ("c" → C++/C#)
  // stay as candidates until the user picks one or narrows the query.
  useEffect(() => {
    if (langMatches.length !== 1) return;
    const [slug] = langMatches[0];
    if (slug === lang) return;
    setLang(slug as TrendingLang);
    setLangQuery(HOT_TRENDING_LANGUAGES[slug]);
    void load(slug as TrendingLang, since, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [langMatches]);

  // Open the panel → load the default view (All languages, Today).
  useEffect(() => {
    void load("all", "daily", false);
  }, [load]);

  // Apply a language from the candidate list (or "all").
  const applyLang = (value: string) => {
    const next = value as TrendingLang;
    setLangQuery(next === "all" ? "" : HOT_TRENDING_LANGUAGES[next]);
    setLang(next);
    void load(next, since, false);
  };

  // Apply the "all languages" state (cleared search) from the clear button
  // or Escape key.
  const clearLang = () => applyLang("all");

  const handleSince = (value: TrendingSince) => {
    setSince(value);
    void load(lang, value, false);
  };

  const handleRefresh = () => {
    void load(lang, since, true);
  };

  const handleCopyPrompt = async (repo: TrendingRepo) => {
    try {
      await copyText(clonePrompt(repo.fullName));
      toast.show({ kind: "success", message: t("Prompt copied") });
    } catch {
      toast.show({ kind: "error", message: t("Failed to copy") });
    }
  };

  // ── List view ─────────────────────────────────────────────────────────
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "transparent", color: "var(--text)" }}>
      {/* Toolbar: language search · since tabs · refresh */}
      <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: "8px 12px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <div style={{ position: "relative", flex: 1, minWidth: 0 }}>
            <input
              value={langQuery}
              onChange={(e) => setLangQuery(e.target.value)}
              onFocus={() => setLangFocused(true)}
              onBlur={() => setLangFocused(false)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.preventDefault();
                  clearLang();
                  (e.currentTarget as HTMLInputElement).blur();
                }
              }}
              placeholder={t("Search language")}
              aria-label={t("Search language")}
              style={{
                width: "100%",
                boxSizing: "border-box",
                background: "transparent",
                border: "1px solid var(--border)",
                borderRadius: 5,
                color: "var(--text)",
                padding: "5px 24px 5px 8px",
                fontSize: 12,
              }}
            />
            {langQuery !== "" && (
              <button
                type="button"
                onClick={clearLang}
                aria-label={t("Clear")}
                title={t("Clear")}
                style={{
                  position: "absolute",
                  right: 3,
                  top: 0,
                  bottom: 0,
                  width: 20,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  background: "transparent",
                  border: "none",
                  color: "var(--text-dim)",
                  cursor: "pointer",
                }}
              >
                <CloseIcon size={12} />
              </button>
            )}
          </div>
          <div style={{ display: "inline-flex", border: "1px solid var(--border)", borderRadius: 5, overflow: "hidden" }}>
            {TRENDING_SINCES.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => handleSince(s)}
                style={sinceTabStyle(since === s)}
              >
                {s === "daily" ? t("Today") : s === "weekly" ? t("This week") : t("This month")}
              </button>
            ))}
          </div>
          <RefreshIconButton onClick={handleRefresh} label={t("Refresh")} />
        </div>

        {langFocused && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
            <button type="button" onClick={clearLang} style={chipStyle(lang === "all")}>
              {languageLabel("all")}
            </button>
            {langMatches.map(([slug, label]) => (
              <button
                key={slug}
                type="button"
                onClick={() => applyLang(slug)}
                style={chipStyle(lang === slug)}
              >
                {label}
              </button>
            ))}
            {langQuery.trim() !== "" && langMatches.length === 0 && (
              <span style={{ fontSize: 11, color: "var(--text-dim)", padding: "3px 4px", alignSelf: "center" }}>
                {t("No match")}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Stale-data banner */}
      {data?.stale && (
        <div
          style={{
            margin: "0 12px 6px",
            padding: "5px 8px",
            borderRadius: 5,
            fontSize: 11,
            color: "var(--text-muted)",
            background: "var(--bg-hover)",
            border: "1px solid var(--border)",
          }}
        >
          {t("Cached data · last fetched {t}").replace("{t}", relativeTime(data.fetchedAt, ""))}
        </div>
      )}

      <div style={{ flex: 1, overflow: "auto" }}>
        {loading && !data && (
          <>
            <RowSkeleton />
            <RowSkeleton />
            <RowSkeleton />
            <RowSkeleton />
          </>
        )}

        {!loading && error && (
          <div style={{ padding: "24px 14px", textAlign: "center", color: "var(--text-muted)", fontSize: 12 }}>
            <div>{t("Failed to load trending")}</div>
            <div style={{ marginTop: 6, color: "var(--text-dim)", wordBreak: "break-all" }}>{error}</div>
            <button
              type="button"
              onClick={handleRefresh}
              style={{ ...iconBtnStyle, width: "auto", padding: "4px 12px", marginTop: 12, border: "1px solid var(--border)", borderRadius: 5, fontSize: 12 }}
            >
              {t("Retry")}
            </button>
          </div>
        )}

        {!loading && !error && data && data.repos.length === 0 && (
          <div style={emptyStyle}>{t("No trending repos")}</div>
        )}

        {!loading && !error && data && data.repos.map((repo) => (
          <TrendingRow
            key={repo.fullName}
            repo={repo}
            onCopyPrompt={handleCopyPrompt}
          />
        ))}
      </div>
    </div>
  );
}
