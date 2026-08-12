"use client";

/**
 * SessionLibraryPreview — theater view (Q12B / Q1A).
 *
 * A single media tile takes over the modal body in a dark, cinematic
 * stage with minimal chrome: floating circular prev/next arrows on the
 * sides, a back-to-grid button and counter pill on top, and (for images)
 * a zoom cluster in the corner. No header bar of its own — the modal's
 * top bar shows the current file path + a copy button and handles
 * closing.
 *
 *   image  →  auto-fits the stage (contain) and zooms inline: wheel to
 *             zoom (cursor-anchored), drag to pan when zoomed,
 *             double-click to toggle 100% / fit, plus −/+/% buttons
 *   video  →  <video controls> (autoplay)
 *   audio  →  AudioPlayer album variant (gradient cover + animated
 *             equalizer, "now playing" layout)
 *
 * Below the stage sits a filmstrip (Google Photos / Lightroom pattern):
 * thumbnails of every media tile in the current filter for one-click
 * jumping. ←/→ walk the list cyclically; Esc returns to the grid
 * (handled in SessionLibraryModal).
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import {
  backToSessionLibraryGrid,
  useSessionLibraryActions,
  useSessionLibraryUi,
} from "@/hooks/sessionLibraryStore";
import { AudioPlayer } from "@/components/AudioPlayer";
import { encodeFilePathForApi, getFileName, joinFilePath } from "@/lib/file-paths";
import { EqualizerBars, gradientFromPath, useInView } from "./MediaBits";
import type { SessionLibraryTile } from "@/lib/session-library-derive";

interface Props {
  tiles: SessionLibraryTile[];
  cwd?: string;
}

const MEDIA_CATEGORIES = new Set(["image", "video", "audio"]);
const MIN_SCALE = 0.1;
const MAX_SCALE = 8;

function makeTileKey(tile: { entryToolCallId: string; path: string }): string {
  return `${tile.entryToolCallId}|${tile.path}`;
}

function resolvePath(filePath: string, cwd?: string): string {
  if (!cwd) return filePath;
  if (filePath.startsWith("/")) return filePath;
  if (/^[a-zA-Z]:[\\/]/.test(filePath)) return filePath;
  if (filePath.startsWith("\\\\")) return filePath;
  return joinFilePath(cwd, filePath);
}

function fileApiUrl(filePath: string): string {
  return `/api/files/${encodeFilePathForApi(filePath)}?type=read`;
}

export function SessionLibraryPreview({
  tiles,
  cwd,
}: Props) {
  const { t } = useI18n();
  const ui = useSessionLibraryUi();
  const actions = useSessionLibraryActions();

  // `known` guards the cold-cache case (reload / session switch): unknown
  // tiles render best-effort; only cache-confirmed failures are excluded
  // (they live in the grid's error rows; pending tiles can't be clicked
  // into preview).
  const mediaTiles = useMemo(
    () => tiles.filter((tl) => MEDIA_CATEGORIES.has(tl.category) && (!tl.known || tl.exists)),
    [tiles],
  );

  const currentIndex = useMemo(() => {
    if (!ui.mediaPreviewTileKey) return 0;
    const i = mediaTiles.findIndex(
      (tl) => makeTileKey(tl) === ui.mediaPreviewTileKey,
    );
    return i >= 0 ? i : 0;
  }, [mediaTiles, ui.mediaPreviewTileKey]);

  const current = mediaTiles[currentIndex];
  const resolvedPath = current ? resolvePath(current.path, cwd) : null;
  const name = current ? getFileName(current.path) : "";

  // ── Inline image zoom / pan (reset when switching tiles) ──
  const [imgZoom, setImgZoom] = useState({ scale: 1, tx: 0, ty: 0 });
  useEffect(() => setImgZoom({ scale: 1, tx: 0, ty: 0 }), [currentIndex]);

  const stageRef = useRef<HTMLDivElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const dragStartRef = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);

  const clampScale = (s: number) => Math.max(MIN_SCALE, Math.min(MAX_SCALE, s));
  const zoomIn = () => setImgZoom((z) => ({ ...z, scale: clampScale(z.scale * 1.25) }));
  const zoomOut = () => setImgZoom((z) => ({ ...z, scale: clampScale(z.scale / 1.25) }));
  const resetZoom = () => setImgZoom({ scale: 1, tx: 0, ty: 0 });

  // Wheel zoom, cursor-anchored, images only. The stage doesn't scroll so
  // preventDefault is safe here (the filmstrip below has its own listener).
  useEffect(() => {
    const el = stageRef.current;
    if (!el || current?.category !== "image") return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const px = e.clientX - rect.left - rect.width / 2;
      const py = e.clientY - rect.top - rect.height / 2;
      setImgZoom((z) => {
        const next = clampScale(z.scale * (e.deltaY < 0 ? 1.15 : 1 / 1.15));
        const k = next / z.scale;
        return {
          scale: next,
          tx: px - (px - z.tx) * k,
          ty: py - (py - z.ty) * k,
        };
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [current?.category, currentIndex]);

  // Drag-to-pan while zoomed — window listeners so the drag survives
  // leaving the stage.
  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: MouseEvent) => {
      const s = dragStartRef.current;
      if (!s) return;
      setImgZoom((z) => ({ ...z, tx: s.tx + (e.clientX - s.x), ty: s.ty + (e.clientY - s.y) }));
    };
    const onUp = () => {
      setDragging(false);
      dragStartRef.current = null;
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [dragging]);

  const onImageDoubleClick = () => {
    setImgZoom((z) => (z.scale > 1 ? { scale: 1, tx: 0, ty: 0 } : { scale: 2, tx: 0, ty: 0 }));
  };

  const onImageMouseDown = (e: React.MouseEvent) => {
    if (imgZoom.scale <= 1) return;
    e.preventDefault();
    dragStartRef.current = { x: e.clientX, y: e.clientY, tx: imgZoom.tx, ty: imgZoom.ty };
    setDragging(true);
  };

  // ── ←/→ keyboard nav ──
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!current) return;
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        const next = (currentIndex - 1 + mediaTiles.length) % mediaTiles.length;
        actions.focusMedia(makeTileKey(mediaTiles[next]));
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        const next = (currentIndex + 1) % mediaTiles.length;
        actions.focusMedia(makeTileKey(mediaTiles[next]));
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [currentIndex, mediaTiles, current, actions]);

  // ── Filmstrip: keep the active thumb in view when navigating ──
  const stripRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = stripRef.current?.children[currentIndex] as HTMLElement | undefined;
    el?.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
  }, [currentIndex]);

  if (!current || !resolvedPath) {
    return (
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--text-dim)",
        }}
      >
        {t("No media in the current filter.")}
      </div>
    );
  }

  const url = fileApiUrl(resolvedPath);

  const goPrev = () => {
    const next = (currentIndex - 1 + mediaTiles.length) % mediaTiles.length;
    actions.focusMedia(makeTileKey(mediaTiles[next]));
  };
  const goNext = () => {
    const next = (currentIndex + 1) % mediaTiles.length;
    actions.focusMedia(makeTileKey(mediaTiles[next]));
  };

  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
        background: "var(--bg)",
      }}
    >
      {/* ── Media stage (dark theater, floating controls) ── */}
      <div
        ref={stageRef}
        style={{
          position: "relative",
          flex: 1,
          minHeight: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "14px 20px",
          overflow: "hidden",
          background: "#050505",
        }}
      >
        {current.category === "image" && (
          <ImageBody
            src={url}
            alt={name}
            key={url}
            zoom={imgZoom}
            dragging={dragging}
            onDoubleClick={onImageDoubleClick}
            onMouseDown={onImageMouseDown}
          />
        )}
        {current.category === "video" && (
          <VideoBody src={url} alt={name} key={url} />
        )}
        {current.category === "audio" && (
          <div style={{ width: "min(560px, 100%)" }}>
            <AudioPlayer
              src={url}
              title={name}
              subtitle={current.size !== undefined ? fmtSize(current.size) : undefined}
              variant="album"
              artGradient={gradientFromPath(resolvedPath)}
              artSize={200}
            />
          </div>
        )}

        {/* Floating back-to-grid button */}
        <button
          type="button"
          onClick={() => backToSessionLibraryGrid()}
          aria-label={t("Close")}
          title={t("Close")}
          style={floatCtlBtnStyle({ top: 12, left: 12 })}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>

        {/* Counter pill */}
        <span
          style={{
            position: "absolute",
            top: 14,
            left: "50%",
            transform: "translateX(-50%)",
            padding: "3px 12px",
            borderRadius: 999,
            background: "rgba(0,0,0,0.5)",
            border: "1px solid rgba(255,255,255,0.14)",
            color: "rgba(255,255,255,0.92)",
            fontSize: 12,
            fontFamily: "var(--font-mono)",
            zIndex: 2,
            pointerEvents: "none",
          }}
        >
          {t("{n} of {total}", { n: currentIndex + 1, total: mediaTiles.length })}
        </span>

        {/* Circular prev/next arrows on the sides */}
        <CarouselArrow side="left" onClick={goPrev} disabled={mediaTiles.length <= 1} />
        <CarouselArrow side="right" onClick={goNext} disabled={mediaTiles.length <= 1} />

        {/* Zoom cluster (images only) */}
        {current.category === "image" && (
          <div
            style={{
              position: "absolute",
              right: 14,
              bottom: 12,
              display: "flex",
              gap: 6,
              zIndex: 2,
            }}
          >
            <StageCtlBtn onClick={zoomOut} ariaLabel={t("Zoom out")} disabled={imgZoom.scale <= MIN_SCALE + 0.001}>
              −
            </StageCtlBtn>
            <StageCtlBtn onClick={resetZoom} ariaLabel={t("Fit")} style={{ minWidth: 48 }}>
              {imgZoom.scale === 1 ? t("Fit") : `${Math.round(imgZoom.scale * 100)}%`}
            </StageCtlBtn>
            <StageCtlBtn onClick={zoomIn} ariaLabel={t("Zoom in")} disabled={imgZoom.scale >= MAX_SCALE}>
              +
            </StageCtlBtn>
          </div>
        )}
      </div>

      {/* ── Filmstrip: click any thumb to jump ── */}
      <div
        ref={stripRef}
        style={{
          display: "flex",
          gap: 8,
          padding: "10px 14px",
          borderTop: "1px solid var(--border)",
          background: "var(--bg-subtle)",
          overflowX: "auto",
          flexShrink: 0,
        }}
      >
        {mediaTiles.map((tile, i) => (
          <FilmThumb
            key={makeTileKey(tile)}
            tile={tile}
            active={i === currentIndex}
            onClick={() => actions.focusMedia(makeTileKey(tile))}
            cwd={cwd}
          />
        ))}
      </div>
    </div>
  );
}

function floatCtlBtnStyle(extra: React.CSSProperties): React.CSSProperties {
  return {
    position: "absolute",
    width: 34,
    height: 34,
    padding: 0,
    borderRadius: "50%",
    background: "rgba(0,0,0,0.5)",
    border: "1px solid rgba(255,255,255,0.18)",
    color: "#fff",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
    zIndex: 2,
    transition: "background 0.12s ease, opacity 0.12s ease",
    ...extra,
  };
}

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

// ── Stage bodies ────────────────────────────────────────────────────────

function ImageBody({
  src,
  alt,
  zoom,
  dragging,
  onDoubleClick,
  onMouseDown,
}: {
  src: string;
  alt: string;
  zoom: { scale: number; tx: number; ty: number };
  dragging: boolean;
  onDoubleClick: () => void;
  onMouseDown: (e: React.MouseEvent) => void;
}) {
  const [loaded, setLoaded] = useState(false);
  const [errored, setErrored] = useState(false);
  return (
    <div
      onDoubleClick={onDoubleClick}
      onMouseDown={onMouseDown}
      style={{
        position: "relative",
        // Fill the stage on BOTH axes (flex: 1 grows width, alignSelf:
        // stretch fills the cross axis) so the image's percentage
        // max-height resolves against a definite height. Without the
        // stretch, the wrapper's height is content-driven (auto) and a
        // tall image renders taller than the stage and gets clipped.
        flex: 1,
        alignSelf: "stretch",
        minWidth: 0,
        minHeight: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: zoom.scale > 1 ? "grab" : "default",
        userSelect: "none",
      }}
    >
      {!loaded && !errored && <Spinner />}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        draggable={false}
        onLoad={() => setLoaded(true)}
        onError={() => setErrored(true)}
        style={{
          display: loaded ? "block" : "none",
          maxWidth: "100%",
          maxHeight: "100%",
          objectFit: "contain",
          transform: `translate(${zoom.tx}px, ${zoom.ty}px) scale(${zoom.scale})`,
          transition: dragging ? "none" : "transform 0.1s ease-out",
        }}
      />
      {errored && <ErrorBox label={alt} />}
    </div>
  );
}

function VideoBody({ src, alt }: { src: string; alt: string }) {
  const [errored, setErrored] = useState(false);
  if (errored) return <ErrorBox label={alt} />;
  return (
    <video
      controls
      autoPlay
      src={src}
      preload="metadata"
      onError={() => setErrored(true)}
      style={{
        display: "block",
        maxWidth: "100%",
        maxHeight: "100%",
        objectFit: "contain",
        borderRadius: 6,
        border: "1px solid rgba(255,255,255,0.08)",
        background: "#000",
      }}
    />
  );
}

// ── Floating controls ───────────────────────────────────────────────────

function CarouselArrow({
  side,
  onClick,
  disabled,
}: {
  side: "left" | "right";
  onClick: () => void;
  disabled: boolean;
}) {
  const { t } = useI18n();
  const label = side === "left" ? t("Previous") : t("Next");
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      style={{
        position: "absolute",
        top: "50%",
        transform: "translateY(-50%)",
        left: side === "left" ? 12 : undefined,
        right: side === "right" ? 12 : undefined,
        width: 44,
        height: 44,
        padding: 0,
        borderRadius: "50%",
        background: "rgba(0,0,0,0.5)",
        border: "1px solid rgba(255,255,255,0.18)",
        color: "#fff",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.3 : 0.9,
        zIndex: 2,
        transition: "background 0.12s ease, opacity 0.12s ease",
      }}
      onMouseEnter={(e) => {
        if (disabled) return;
        e.currentTarget.style.background = "rgba(0,0,0,0.72)";
        e.currentTarget.style.opacity = "1";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "rgba(0,0,0,0.5)";
        e.currentTarget.style.opacity = disabled ? "0.3" : "0.9";
      }}
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
        {side === "left" ? (
          <polyline points="15 18 9 12 15 6" />
        ) : (
          <polyline points="9 18 15 12 9 6" />
        )}
      </svg>
    </button>
  );
}

function StageCtlBtn({
  onClick,
  ariaLabel,
  disabled,
  children,
  style,
}: {
  onClick: () => void;
  ariaLabel: string;
  disabled?: boolean;
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      title={ariaLabel}
      style={{
        height: 30,
        minWidth: 30,
        padding: "0 10px",
        borderRadius: 999,
        background: "rgba(0,0,0,0.5)",
        border: "1px solid rgba(255,255,255,0.18)",
        color: "rgba(255,255,255,0.92)",
        fontSize: 12,
        fontFamily: "var(--font-mono)",
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.35 : 1,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        transition: "background 0.12s ease",
        ...style,
      }}
    >
      {children}
    </button>
  );
}

// ── Filmstrip thumb ─────────────────────────────────────────────────────

function FilmThumb({
  tile,
  active,
  onClick,
  cwd,
}: {
  tile: SessionLibraryTile;
  active: boolean;
  onClick: () => void;
  cwd?: string;
}) {
  const resolvedPath = resolvePath(tile.path, cwd);
  const url = fileApiUrl(resolvedPath);
  const [ref, inView] = useInView<HTMLButtonElement>();
  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      aria-label={getFileName(tile.path)}
      style={{
        width: 72,
        height: 54,
        flexShrink: 0,
        padding: 0,
        borderRadius: 6,
        overflow: "hidden",
        border: active ? "2px solid var(--accent)" : "1px solid var(--border)",
        background: "#000",
        cursor: "pointer",
        opacity: active ? 1 : 0.72,
        transition: "opacity 0.12s ease, border-color 0.12s ease",
        position: "relative",
      }}
    >
      {tile.category === "image" && (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          src={url}
          alt=""
          loading="lazy"
          style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
        />
      )}
      {tile.category === "video" && (
        <video
          src={inView ? url : undefined}
          preload="metadata"
          muted
          playsInline
          style={{ width: "100%", height: "100%", objectFit: "cover", display: "block", background: "#000" }}
        />
      )}
      {tile.category === "audio" && (
        <div
          style={{
            width: "100%",
            height: "100%",
            background: gradientFromPath(tile.path),
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <EqualizerBars playing={false} width={22} height={12} barCount={5} />
        </div>
      )}
    </button>
  );
}

function Spinner() {
  return (
    <div
      aria-hidden="true"
      style={{
        position: "absolute",
        width: 28,
        height: 28,
        border: "3px solid rgba(255,255,255,0.12)",
        borderTopColor: "rgba(255,255,255,0.7)",
        borderRadius: "50%",
        animation: "session-library-spin 0.9s linear infinite",
      }}
    />
  );
}

function ErrorBox({ label }: { label: string }) {
  return (
    <div
      style={{
        color: "#f87171",
        fontSize: 12,
        fontFamily: "var(--font-mono)",
        padding: "8px 12px",
        border: "1px dashed rgba(248,113,113,0.4)",
        borderRadius: 6,
      }}
    >
      {label}
    </div>
  );
}
