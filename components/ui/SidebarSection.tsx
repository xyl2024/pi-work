"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode, type Ref, type RefObject } from "react";
import {
  NO_SCROLL_EDGES,
  decideScrollEdges,
  scrollFadeMaskImage,
  type ScrollEdges,
} from "@/lib/shared/sidebar-section";

interface Props {
  /** Header label rendered next to the chevron (uppercased, matching the
   *  sidebar's existing section headers). */
  title: ReactNode;
  /** Whether the content area is expanded. */
  open: boolean;
  /** Called when the header row (chevron/title) is clicked. */
  onToggle: () => void;
  /** Optional action buttons rendered at the right end of the header row
   *  (e.g. collapse-all, refresh). */
  actions?: ReactNode;
  /** Content rendered below the header, inside an internal scroll container. */
  children: ReactNode;
  /** Height-animation duration; default 180ms — same as CollapsiblePanel. */
  durationMs?: number;
  /** flex-grow value applied to the section when open. Default 1 (shares
   *  remaining sidebar space with sibling open sections). Pass 0 for short,
   *  intrinsically-sized sections like the GrokBot stage — they only claim
   *  the height of their own header + content. */
  grow?: number;
  /** Optional max height for the scrollable body (any CSS length). Only
   *  meaningful for intrinsically-sized sections (grow: 0): a grow:1 section
   *  already gets exactly its share of free space. A heavy list then scrolls
   *  inside the cap instead of stretching the section past it. A capped body
   *  also gets the top/bottom scroll hints (see below). */
  maxHeight?: number | string;
  /** Optional *minimum* body height (any CSS length), the symmetric partner of
   *  `maxHeight` and equally only meaningful for intrinsically-sized sections
   *  (grow: 0). Without it such a section is rigid (it never gives up height).
   *  With it the section becomes compressible down to its header plus this
   *  body floor, so a sibling that is squeezed can hand its height back to the
   *  working sections first. The body also stays scrollable while squeezed. */
  minHeight?: number | string;
  /** Keep the content mounted while collapsed (it stays squashed to zero
   *  height). Default false — unmounting releases things like FileExplorer's
   *  git polling. Pass true for sections whose body refetches on mount (e.g.
   *  Today's Sessions): toggling then never replays that load. */
  keepMounted?: boolean;
  /** Optional ref forwarded to the internal scroll container (the element
   *  that actually scrolls, not the section wrapper). Callers that watch
   *  scrolling (the Sessions infinite scroll) read its metrics and attach
   *  their listener to it. Leave unset and the section behaves as before. */
  scrollRef?: Ref<HTMLDivElement>;
}

// A capped section is the sidebar's sacrificial height: when the column runs
// short it gives up its own rows (down to `minHeight`) before the working
// sections lose theirs. Draining it first is a flex-shrink *weight*, not a
// switch, so a high value deliberately outweighs the much taller siblings —
// once this section is clamped at its floor the remaining deficit flows to
// them as usual.
const CAP_SACRIFICE_SHRINK = 999;

/**
 * Scroll hint wiring for a capped section. Watches the scroll container's own
 * box and its content (a `ResizeObserver` covers the expand animation
 * finishing, the window resizing, and rows arriving while the box itself is
 * already clamped at the cap) plus its scroll position, and turns the pure
 * edge decision into a mask. Uncapped sections cannot overflow and keep the
 * mask undefined.
 */
function useScrollFadeMask(elRef: RefObject<HTMLDivElement | null>, active: boolean): string | undefined {
  const [edges, setEdges] = useState<ScrollEdges>(NO_SCROLL_EDGES);

  useEffect(() => {
    if (!active) {
      setEdges((prev) => (prev.top || prev.bottom ? NO_SCROLL_EDGES : prev));
      return;
    }
    const el = elRef.current;
    if (!el) return;
    const read = () => {
      const next = decideScrollEdges({
        scrollHeight: el.scrollHeight,
        scrollTop: el.scrollTop,
        clientHeight: el.clientHeight,
      });
      setEdges((prev) => (prev.top === next.top && prev.bottom === next.bottom ? prev : next));
    };
    read();
    el.addEventListener("scroll", read, { passive: true });
    const observer = new ResizeObserver(read);
    observer.observe(el);
    // The scroll container's own box stops changing once content is clamped at
    // the cap, so a row added while already overflowing would otherwise not be
    // noticed. The content element still grows, so watch it too.
    const content = el.firstElementChild;
    if (content) observer.observe(content);
    return () => {
      el.removeEventListener("scroll", read);
      observer.disconnect();
    };
  }, [elRef, active]);

  return scrollFadeMaskImage(edges);
}

// Collapsible section for the left sidebar. Explorer today, future sections
// with the same collapse/expand behavior should reuse this component.
//
// Unlike CollapsiblePanel / useCollapseHeight — which animate to the *content*
// height — a sidebar section expands to whatever free space the flex column
// grants it (siblings like MultiCwdList share the remaining height), so the
// animation is driven by `flex-grow` itself: transitioning 0↔1 makes the
// browser re-flow the section's height every frame toward the flex-computed
// target. No pixel measurement is needed and the target is always correct,
// even when a sibling section's own open state changes the free space.
//
// The trick that keeps this smooth without measuring: flex-basis stays `auto`
// while the content wrapper has `flex-basis: 0`. The section's content height
// is therefore always exactly the header row — closed state is just the
// header, open state is header + grow × free space, and the closed header can
// never be compressed (flexShrink: 0 when closed, matching the previous
// `flex: 0 0 auto` behavior).
//
// grow: 0 sections can't use that: their flex-grow is 0 in both states, so
// there is nothing to interpolate. They animate their body instead with
// `grid-template-rows: 0fr ↔ 1fr`, which interpolates toward the content's own
// height (still without measuring, and capped by `maxHeight` below), so a short
// list animates at the same pace as a full one.
export function SidebarSection({
  title,
  open,
  onToggle,
  actions,
  children,
  durationMs = 180,
  grow = 1,
  maxHeight,
  minHeight,
  keepMounted = false,
  scrollRef,
}: Props) {
  // Keep the content mounted through the collapse animation (it must be in
  // the DOM to squeeze to zero), then unmount it after the transition
  // settles — same lifecycle as MultiCwdList's body. Unmounting releases
  // things like FileExplorer's git polling while the section is collapsed;
  // `keepMounted` opts out for bodies that would refetch on remount.
  const [mounted, setMounted] = useState(open);

  useEffect(() => {
    if (open || keepMounted) {
      setMounted(true);
      return;
    }
    const timer = window.setTimeout(() => setMounted(false), durationMs + 40);
    return () => window.clearTimeout(timer);
  }, [open, durationMs, keepMounted]);

  const ease = "cubic-bezier(0.32, 0.72, 0, 1)";
  // grow=0 sections (e.g. the GrokBot stage) claim only their content's
  // natural height: the content wrapper must then size itself to its content
  // (flex 0 0 auto) instead of the flex-basis-0 + flex-grow trick that
  // grow=1 sections use to absorb free space. A flex-basis-0 wrapper would
  // collapse to 0 height and clip the content away.
  const isFixedHeight = grow === 0;
  // Only a grow:0 section with a body floor can be squeezed; everything else
  // keeps the exact flex behaviour it had before.
  const compressible = isFixedHeight && minHeight !== undefined;

  // The internal scroll container is always ours to observe; a caller that
  // also wants it (the Sessions infinite scroll) still gets the same node.
  const scrollElRef = useRef<HTMLDivElement | null>(null);
  const setScrollRef = useCallback(
    (node: HTMLDivElement | null) => {
      scrollElRef.current = node;
      if (typeof scrollRef === "function") scrollRef(node);
      else if (scrollRef) scrollRef.current = node;
    },
    [scrollRef],
  );
  // `mounted` is in the condition so the effect re-runs once the body
  // actually mounts: a capped section that starts collapsed has no scroll
  // container to observe at the moment `open` flips.
  const fadeMask = useScrollFadeMask(scrollElRef, open && mounted && maxHeight !== undefined);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        flexGrow: open ? grow : 0,
        flexShrink: !open ? 0 : grow > 0 ? 1 : compressible ? CAP_SACRIFICE_SHRINK : 0,
        flexBasis: "auto",
        // A compressible section floors at its own content minimum: the header
        // (never compressed) plus the body's `minHeight` below. Without this
        // the high shrink weight above could squeeze the section past its
        // floor and clip it. Rigid sections keep the old `minHeight: 0`.
        minHeight: compressible ? "min-content" : 0,
        overflow: "hidden",
        transition: `flex-grow ${durationMs}ms ${ease}`,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", flexShrink: 0 }}>
        <button
          onClick={onToggle}
          aria-expanded={open}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            flex: 1,
            padding: "6px 10px",
            background: "none",
            border: "none",
            color: "var(--text-muted)",
            cursor: "pointer",
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: "0.05em",
            textTransform: "uppercase",
            textAlign: "left",
          }}
        >
          <svg
            width="9" height="9" viewBox="0 0 10 10" fill="none"
            stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
            style={{
              flexShrink: 0,
              transform: open ? "rotate(90deg)" : "none",
              transition: `transform ${durationMs}ms ${ease}`,
            }}
          >
            <polyline points="3 2 7 5 3 8" />
          </svg>
          {title}
        </button>
        {actions && (
          <div style={{ display: "flex", alignItems: "center", flexShrink: 0 }}>
            {actions}
          </div>
        )}
      </div>
      {mounted &&
        (isFixedHeight ? (
          // The grid item must be allowed to shrink to nothing (minHeight: 0)
          // and clip (overflow: hidden) for the 0fr row to squash it.
          <div
            style={{
              display: "grid",
              gridTemplateRows: open ? "1fr" : "0fr",
              // A compressible section may be squeezed by the sidebar; a rigid
              // one still only claims its content height.
              flex: compressible ? "0 1 auto" : "0 0 auto",
              // The floor lives on the body, so the section's hard minimum is
              // its header plus this. Transitioning it alongside the row tracks
              // keeps the collapse/expand animation from jumping when the floor
              // becomes active.
              minHeight: compressible ? (open ? minHeight : 0) : 0,
              transition: `grid-template-rows ${durationMs}ms ${ease}${compressible ? `, min-height ${durationMs}ms ${ease}` : ""}`,
            }}
          >
            <div
              style={{
                minHeight: 0,
                overflow: "hidden",
                // When the body can shrink, the inner box is a column so the
                // scroll container below receives the squeezed height instead
                // of overflowing it (which would clip the scrollbar and the
                // last row).
                ...(compressible ? { display: "flex", flexDirection: "column" as const } : null),
              }}
            >
              <div
                ref={setScrollRef}
                data-scroll-side
                style={{
                  maxHeight,
                  overflowY: "auto",
                  overflowX: "hidden",
                  ...(compressible ? { flex: "0 1 auto", minHeight: 0 } : null),
                  maskImage: fadeMask,
                  WebkitMaskImage: fadeMask,
                }}
              >
                {children}
              </div>
            </div>
          </div>
        ) : (
          <div style={{ flex: "1 1 0", minHeight: 0, overflow: "hidden" }}>
            <div
              ref={setScrollRef}
              data-scroll-side
              style={{
                height: "100%",
                maxHeight,
                overflowY: "auto",
                overflowX: "hidden",
                maskImage: fadeMask,
                WebkitMaskImage: fadeMask,
              }}
            >
              {children}
            </div>
          </div>
        ))}
    </div>
  );
}
