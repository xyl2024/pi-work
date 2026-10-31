"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useToast } from "@/components/ui/Toast";
import { TruncatedText } from "@/components/ui/TruncatedText";
import { avatarPalette } from "@/lib/client/avatar-palette";
import { shortenPath } from "@/lib/client/paths";
import { searchSkills } from "@/lib/client/skills-io";
import { skillsPanel, startSkillInstall, useSkillsPanel } from "@/lib/client/skills-panel";
import type { SkillInstallRequest, SkillInstallScope, SkillSearchResult } from "@/lib/shared/skills";
import { PanelBackButton } from "../PanelBackButton";

const PAGE_SIZE = 6;
const SCROLL_THRESHOLD_PX = 240;
const FAILURE_TAIL_LINES = 12;

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
  const atIndex = result.package.indexOf("@");
  const repoPart = atIndex > -1 ? result.package.slice(0, atIndex) : result.package;
  const skillName = atIndex > -1 ? result.package.slice(atIndex + 1) : repoPart;
  const palette = avatarPalette(skillName);
  const initial = (skillName.trim()[0] ?? "?").toUpperCase();
  const blocked = isInstalled || isInstalling || installDisabled;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 8,
        padding: "12px 12px",
        border: "1px solid var(--border)",
        borderRadius: 10,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span
          style={{
            flexShrink: 0,
            width: 26,
            height: 26,
            borderRadius: "50%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: palette.bg,
            color: palette.fg,
            fontSize: 12,
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
            fontSize: 13,
            fontWeight: 600,
            color: "var(--text)",
            fontFamily: "var(--font-mono)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        />
        <button
          type="button"
          onClick={onInstall}
          disabled={blocked}
          style={{
            flexShrink: 0,
            padding: "3px 9px",
            fontSize: 11.5,
            fontWeight: 500,
            borderRadius: 6,
            border: "1px solid var(--border)",
            cursor: blocked ? "not-allowed" : "pointer",
            background: isInstalled ? "rgba(34,197,94,0.1)" : "none",
            color: isInstalled ? "var(--success)" : isInstalling ? "var(--accent)" : "var(--text-muted)",
          }}
        >
          {isInstalled ? t("Installed") : isInstalling ? t("Installing...") : t("Install")}
        </button>
      </div>

      {result.description && (
        <TruncatedText
          text={result.description}
          side="bottom"
          style={{
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
            fontSize: 12,
            lineHeight: 1.5,
            color: "var(--text-muted)",
          }}
        />
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
        <span
          style={{
            flex: 1,
            minWidth: 0,
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            color: "var(--text-dim)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
          title={repoPart}
        >
          {repoPart}
        </span>
        {result.installs && (
          <span style={{ flexShrink: 0, fontSize: 11, color: "var(--text-muted)", fontWeight: 500 }}>
            {result.installs}
          </span>
        )}
        {result.url && (
          <a
            href={result.url}
            target="_blank"
            rel="noreferrer"
            style={{ flexShrink: 0, fontSize: 11, color: "var(--accent)", textDecoration: "none" }}
          >
            skills.sh ↗
          </a>
        )}
      </div>
    </div>
  );
}

export function SkillsAddPage() {
  const { t } = useI18n();
  const toast = useToast();
  const { view } = useSkillsPanel();
  const { cwd, install } = view;

  const [query, setQuery] = useState("");
  const [activeQuery, setActiveQuery] = useState("");
  const [results, setResults] = useState<SkillSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [scope, setScope] = useState<SkillInstallScope>("global");

  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const requestSeqRef = useRef(0);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const running = install.phase === "running";
  const installingPackage = running ? install.request?.package ?? null : null;
  const visibleLogs = running ? install.logs : install.logs.slice(-FAILURE_TAIL_LINES);

  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [install.logs]);

  const search = useCallback(
    async (rawQuery: string) => {
      const trimmed = rawQuery.trim();
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
        const data = await searchSkills(trimmed, 1, PAGE_SIZE);
        if (seq !== requestSeqRef.current) return;
        setResults(data.results);
        setPage(data.page);
        setHasMore(data.hasMore);
      } catch (e) {
        if (seq !== requestSeqRef.current) return;
        setSearchError(e instanceof Error ? e.message : String(e));
      } finally {
        if (seq === requestSeqRef.current) setSearching(false);
      }
    },
    [],
  );

  const loadMore = useCallback(async () => {
    if (!activeQuery || loadingMore || searching || !hasMore) return;
    const seq = requestSeqRef.current;
    setLoadingMore(true);
    try {
      const data = await searchSkills(activeQuery, page + 1, PAGE_SIZE);
      if (seq !== requestSeqRef.current) return;
      setResults((previous) => [...previous, ...data.results]);
      setPage(data.page);
      setHasMore(data.hasMore);
    } catch (e) {
      if (seq !== requestSeqRef.current) return;
      setSearchError(e instanceof Error ? e.message : String(e));
      setHasMore(false);
    } finally {
      if (seq === requestSeqRef.current) setLoadingMore(false);
    }
  }, [activeQuery, loadingMore, searching, hasMore, page]);

  const handleScroll = useCallback(() => {
    const el = listRef.current;
    if (!el || !hasMore || loadingMore || searching) return;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < SCROLL_THRESHOLD_PX) {
      void loadMore();
    }
  }, [hasMore, loadingMore, searching, loadMore]);

  const runInstall = useCallback(
    (request: SkillInstallRequest) => {
      startSkillInstall(request, () =>
        toast.show({ kind: "success", message: t("Skill installed") }),
      );
    },
    [t, toast],
  );

  const requestFor = useCallback(
    (pkg: string): SkillInstallRequest => ({ package: pkg, scope, cwd: cwd ?? undefined }),
    [scope, cwd],
  );

  const installPath =
    scope === "global" || cwd === null
      ? "~/.pi/agent/skills/"
      : `${shortenPath(cwd)}/.pi/agent/skills/`;

  const showEmptySearchResult = !searching && !searchError && activeQuery !== "" && results.length === 0;
  const showInstallBlock = running || install.error !== null;

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", minHeight: 0 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "12px 12px 8px",
          flexShrink: 0,
        }}
      >
        <PanelBackButton panel={skillsPanel} />
        <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>{t("Add Skill")}</span>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: "0 12px 10px", flexShrink: 0 }}>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void search(query);
            }}
            style={{
              flex: 1,
              minWidth: 0,
              padding: "6px 9px",
              fontSize: 12.5,
              background: "var(--bg)",
              border: "1px solid var(--border)",
              borderRadius: 6,
              color: "var(--text)",
            }}
          />
          <button
            type="button"
            onClick={() => void search(query)}
            disabled={searching || !query.trim()}
            style={{
              flexShrink: 0,
              padding: "6px 14px",
              fontSize: 12.5,
              borderRadius: 6,
              border: "none",
              background: "var(--accent)",
              color: "#fff",
              cursor: searching || !query.trim() ? "not-allowed" : "pointer",
              opacity: searching || !query.trim() ? 0.5 : 1,
            }}
          >
            {searching ? t("Searching...") : t("Search")}
          </button>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <div
            style={{
              display: "flex",
              flexShrink: 0,
              borderRadius: 5,
              border: "1px solid var(--border)",
              overflow: "hidden",
              fontSize: 11.5,
            }}
          >
            {(["global", "project"] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setScope(s)}
                disabled={s === "project" && cwd === null}
                style={{
                  padding: "3px 10px",
                  border: "none",
                  cursor: s === "project" && cwd === null ? "not-allowed" : "pointer",
                  background: scope === s ? "var(--bg-selected)" : "none",
                  color: scope === s ? "var(--text)" : "var(--text-dim)",
                  fontWeight: scope === s ? 600 : 400,
                  opacity: s === "project" && cwd === null ? 0.5 : 1,
                  borderRight: s === "global" ? "1px solid var(--border)" : "none",
                }}
              >
                {t(s)}
              </button>
            ))}
          </div>
          <span
            style={{
              flex: 1,
              minWidth: 0,
              fontSize: 11,
              color: "var(--text-dim)",
              fontFamily: "var(--font-mono)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
            title={`→ ${installPath}`}
          >
            → {installPath}
          </span>
        </div>

        {showInstallBlock && (
          <div style={{ border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden" }}>
            {running && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "6px 10px",
                  fontSize: 11.5,
                  fontWeight: 600,
                  color: "var(--text)",
                  borderBottom: install.logs.length ? "1px solid var(--border)" : "none",
                }}
              >
                <span
                  style={{
                    flexShrink: 0,
                    width: 10,
                    height: 10,
                    borderRadius: "50%",
                    border: "2px solid var(--accent)",
                    borderTopColor: "transparent",
                    animation: "spin 1s linear infinite",
                  }}
                />
                <span
                  style={{
                    fontFamily: "var(--font-mono)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {installingPackage} · {t("Installing...")}
                </span>
              </div>
            )}
            {visibleLogs.length > 0 && (
              <div
                ref={logRef}
                style={{
                  maxHeight: 140,
                  overflowY: "auto",
                  padding: "6px 10px",
                  fontFamily: "var(--font-mono)",
                  fontSize: 10.5,
                  lineHeight: 1.7,
                  color: "var(--text-muted)",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-all",
                }}
              >
                {visibleLogs.map((line, i) => (
                  <div key={`${i}:${line}`}>{line}</div>
                ))}
              </div>
            )}
            {install.error !== null && (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 6,
                  alignItems: "flex-start",
                  padding: "6px 10px",
                  borderTop: install.logs.length ? "1px solid var(--border)" : "none",
                }}
              >
                <div style={{ fontSize: 11.5, color: "var(--error)", wordBreak: "break-word" }}>
                  {install.error}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    if (install.request !== null) runInstall(install.request);
                  }}
                  disabled={install.request === null}
                  style={{
                    padding: "3px 12px",
                    fontSize: 12,
                    borderRadius: 6,
                    border: "1px solid var(--border)",
                    background: "none",
                    color: "var(--text-muted)",
                    cursor: install.request === null ? "not-allowed" : "pointer",
                  }}
                >
                  {t("Retry")}
                </button>
              </div>
            )}
          </div>
        )}

        {searchError !== null && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ fontSize: 11.5, color: "var(--error)", wordBreak: "break-word" }}>{searchError}</div>
            <button
              type="button"
              onClick={() => void search(activeQuery || query)}
              style={{
                alignSelf: "flex-start",
                padding: "3px 12px",
                fontSize: 12,
                borderRadius: 6,
                border: "1px solid var(--border)",
                background: "none",
                color: "var(--text-muted)",
                cursor: "pointer",
              }}
            >
              {t("Retry")}
            </button>
          </div>
        )}
      </div>

      <div
        ref={listRef}
        onScroll={handleScroll}
        data-scroll-side
        style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "0 12px 18px" }}
      >
        {showEmptySearchResult ? (
          <Muted>{t("No skills found")}</Muted>
        ) : activeQuery === "" && !searching && searchError === null ? (
          <Muted>{t("Search skills hint")}</Muted>
        ) : (
          <>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {results.map((result) => (
                <ResultCard
                  key={result.package}
                  result={result}
                  isInstalled={install.installed.includes(result.package)}
                  isInstalling={installingPackage === result.package}
                  installDisabled={running}
                  onInstall={() => runInstall(requestFor(result.package))}
                />
              ))}
            </div>
            {hasMore && (
              <div style={{ display: "flex", justifyContent: "center", padding: "14px 0 4px" }}>
                <button
                  type="button"
                  onClick={() => void loadMore()}
                  disabled={loadingMore || searching}
                  style={{
                    padding: "5px 18px",
                    fontSize: 12,
                    borderRadius: 6,
                    border: "1px solid var(--border)",
                    background: "none",
                    color: "var(--text-muted)",
                    cursor: loadingMore || searching ? "not-allowed" : "pointer",
                    opacity: loadingMore || searching ? 0.6 : 1,
                  }}
                >
                  {loadingMore ? t("Loading...") : t("Search more")}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function Muted({ children }: { children: React.ReactNode }) {
  return <div style={{ padding: "10px 2px", fontSize: 12, color: "var(--text-dim)", lineHeight: 1.7 }}>{children}</div>;
}
