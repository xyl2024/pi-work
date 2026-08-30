/**
 * WorkflowNodeCanvas — visual DAG orchestration editor.
 *
 * Renders workflow nodes as draggable, type-tinted boxes on a scrollable
 * grid. Dragging a node's right (output) handle onto another node's left
 * (input) handle creates a dependency edge (and auto-binds the target's first
 * unbound data input). The engine runs the graph in topological order.
 *
 * The canvas is intentionally dependency-free (no React Flow / Excalidraw):
 * node drag, handle-to-handle wiring and layered auto-layout are implemented
 * directly so the whole editor stays lightweight and themed with CSS vars.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { KINDS, NODE_DEFS } from "@/lib/shared/workflow-nodes";
import type { WorkflowNodeKind } from "@/lib/shared/workflow";

export interface CanvasNode {
  id: string;
  kind: string;
  kindLabel: string;
  accent: string;
  name: string;
  x: number;
  y: number;
  failurePolicy: "fail" | "skip";
  dependsOn: string[];
}

interface Props {
  nodes: CanvasNode[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onMoveNode: (id: string, x: number, y: number) => void;
  onConnect: (fromId: string, toId: string) => void;
  onRemoveNode: (id: string) => void;
  onAddNode: (kind: WorkflowNodeKind) => void;
  onAutoLayout: () => void;
  t: (k: string) => string;
}

const NODE_W = 196;
const NODE_H = 62;
const PAD = 40;
const MIN_W = 900;
const MIN_H = 480;

type Draft =
  | { kind: "none" }
  | { kind: "drag"; id: string; startClientX: number; startClientY: number; startX: number; startY: number }
  | { kind: "connect"; fromId: string; cursor: { x: number; y: number }; hoverTarget: string | null };

export function WorkflowNodeCanvas(props: Props) {
  const { nodes, selectedId } = props;
  const viewRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const [draft, setDraft] = useState<Draft>({ kind: "none" });
  const [addOpen, setAddOpen] = useState(false);

  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);

  const handlePos = (n: CanvasNode, side: "in" | "out") => ({
    x: side === "out" ? n.x + NODE_W : n.x,
    y: n.y + NODE_H / 2,
  });

  // Content extent so the scrollable region grows with the graph.
  const extent = useMemo(() => {
    let maxX = MIN_W;
    let maxY = MIN_H;
    for (const n of nodes) {
      maxX = Math.max(maxX, n.x + NODE_W + PAD);
      maxY = Math.max(maxY, n.y + NODE_H + PAD);
    }
    return { width: maxX, height: maxY };
  }, [nodes]);

  // Map a client point to content coords. Must measure the inner content div
  // (not the scroll container) so scrolling is accounted for.
  const toContent = (clientX: number, clientY: number) => {
    const r = contentRef.current?.getBoundingClientRect() ?? viewRef.current?.getBoundingClientRect();
    if (!r) return { x: clientX, y: clientY };
    return { x: clientX - r.left, y: clientY - r.top };
  };

  const findInputTarget = (cx: number, cy: number): string | null => {
    // Prefer the nearest node whose input handle is near the cursor.
    let best: string | null = null;
    let bestD = Infinity;
    for (const n of nodes) {
      const h = handlePos(n, "in");
      const d = Math.hypot(h.x - cx, h.y - cy);
      if (d < 28 && d < bestD) {
        bestD = d;
        best = n.id;
      }
    }
    return best;
  };

  useEffect(() => {
    if (draft.kind === "none") return;

    const move = (e: PointerEvent) => {
      if (draft.kind === "drag") {
        props.onMoveNode(draft.id, draft.startX + (e.clientX - draft.startClientX), draft.startY + (e.clientY - draft.startClientY));
      } else if (draft.kind === "connect") {
        const c = toContent(e.clientX, e.clientY);
        setDraft({ kind: "connect", fromId: draft.fromId, cursor: c, hoverTarget: findInputTarget(c.x, c.y) });
      }
    };
    const up = (e: PointerEvent) => {
      if (draft.kind === "connect") {
        const c = toContent(e.clientX, e.clientY);
        const target = findInputTarget(c.x, c.y);
        if (target && target !== draft.fromId) {
          props.onConnect(draft.fromId, target);
        }
      }
      setDraft({ kind: "none" });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, nodes]);

  const onPointerDownNode = (e: React.PointerEvent, n: CanvasNode) => {
    if (e.button !== 0) return;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    setDraft({ kind: "drag", id: n.id, startClientX: e.clientX, startClientY: e.clientY, startX: n.x, startY: n.y });
    props.onSelect(n.id);
  };

  const onPointerDownOutput = (e: React.PointerEvent, n: CanvasNode) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    const c = toContent(e.clientX, e.clientY);
    setDraft({ kind: "connect", fromId: n.id, cursor: c, hoverTarget: null });
    props.onSelect(n.id);
  };

  // Active temp edge path during wiring.
  let tempLine = null;
  if (draft.kind === "connect") {
    const from = byId.get(draft.fromId);
    if (from) tempLine = edgePath(handlePos(from, "out").x, handlePos(from, "out").y, draft.cursor.x, draft.cursor.y);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {/* toolbar */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ fontSize: 11, color: "var(--text-muted)", lineHeight: 1.5 }}>
          {props.t("Drag a node's right handle to connect it to another node")}
        </div>
        <div style={{ display: "flex", gap: 6, position: "relative" }}>
          <button onClick={props.onAutoLayout} style={toolBtn}>{props.t("Auto layout")}</button>
          <button onClick={() => setAddOpen((v) => !v)} style={{ ...toolBtn, color: "var(--accent)", fontWeight: 600 }}>{props.t("Add node")} ▾</button>
          {addOpen && (
            <div style={{ position: "absolute", top: "100%", right: 0, marginTop: 4, background: "var(--bg-panel)", border: "1px solid var(--border)", borderRadius: 8, boxShadow: "0 6px 20px rgba(0,0,0,0.16)", zIndex: 20, minWidth: 170, padding: 4 }}>
              {KINDS.map((kind) => {
                const def = NODE_DEFS[kind];
                return (
                  <button
                    key={kind}
                    onClick={() => { props.onAddNode(kind); setAddOpen(false); }}
                    style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "6px 10px", background: "transparent", border: "none", borderRadius: 6, cursor: "pointer", textAlign: "left", fontFamily: "inherit", fontSize: 12, color: "var(--text)" }}
                  >
                    <span style={{ width: 8, height: 8, borderRadius: "50%", background: def.accent, flexShrink: 0 }} />
                    <span>{props.t(def.label)}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* canvas */}
      <div
        ref={viewRef}
        onPointerDown={(e) => {
          if (e.target === e.currentTarget) props.onSelect(null);
        }}
        style={{
          position: "relative",
          border: "1px solid var(--border)",
          borderRadius: 8,
          background: "var(--bg-subtle)",
          overflow: "auto",
          height: "46vh",
          minHeight: 340,
        }}
      >
        <div ref={contentRef} onPointerDown={(e) => { if (e.target === e.currentTarget) props.onSelect(null); }} style={{ position: "relative", width: extent.width, height: extent.height, backgroundSize: "24px 24px", backgroundImage: "radial-gradient(circle, var(--border) 1px, transparent 1px)" }}>
          {/* edges */}
          <svg width={extent.width} height={extent.height} style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
            {nodes.flatMap((node) =>
              node.dependsOn.map((depId) => {
                const dep = byId.get(depId);
                if (!dep) return null;
                const a = handlePos(dep, "out");
                const b = handlePos(node, "in");
                const active = selectedId === node.id || selectedId === depId;
                return (
                  <path key={`${depId}->${node.id}`} d={edgePath(a.x, a.y, b.x, b.y)} fill="none"
                    stroke={active ? "var(--accent)" : "var(--border)"} strokeWidth={active ? 2 : 1.5}
                    strokeLinecap="round" />
                );
              }),
            )}
            {tempLine && <path d={tempLine} fill="none" stroke="var(--accent)" strokeWidth={2} strokeDasharray="5 4" strokeLinecap="round" />}
          </svg>

          {/* nodes */}
          {nodes.map((n) => {
            const selected = n.id === selectedId;
            return (
              <div
                key={n.id}
                onPointerDown={(e) => onPointerDownNode(e, n)}
                style={{
                  position: "absolute",
                  left: n.x,
                  top: n.y,
                  width: NODE_W,
                  height: NODE_H,
                  border: `1.5px solid ${selected ? n.accent : "var(--border)"}`,
                  borderLeft: `4px solid ${n.accent}`,
                  borderRadius: 8,
                  background: "var(--bg-panel)",
                  boxShadow: selected ? `0 0 0 1px ${n.accent}, 0 2px 12px rgba(0,0,0,0.18)` : undefined,
                  cursor: "grab",
                  touchAction: "none",
                  boxSizing: "border-box",
                  display: "flex",
                  flexDirection: "column",
                }}
              >
                {/* remove */}
                <button
                  onClick={(e) => { e.stopPropagation(); props.onRemoveNode(n.id); }}
                  style={{ position: "absolute", top: 2, right: 4, border: "none", background: "transparent", color: "var(--text-muted)", fontSize: 13, lineHeight: 1, cursor: "pointer", padding: 2, opacity: 0.65, zIndex: 2 }}
                  title={props.t("Remove")}
                >×</button>
                <div style={{ padding: "7px 10px 2px", fontWeight: 700, fontSize: 12, color: "var(--text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", paddingRight: 18 }}>
                  {n.name || "· · ·"}
                </div>
                <div style={{ padding: "0 10px", fontSize: 10, color: n.accent, fontWeight: 600 }}>
                  {n.kindLabel}
                </div>
                <div style={{ padding: "0 10px", fontSize: 10, color: "var(--text-muted)" }}>
                  {n.failurePolicy === "skip" ? props.t("skip on fail") : props.t("Fail run")}
                </div>

                {/* input handle */}
                <div
                  data-handle="in"
                  onPointerDown={(e) => e.stopPropagation()}
                  style={handleStyle("in")}
                  title={props.t("Input")}
                />
                {/* output handle */}
                <div
                  data-handle="out"
                  onPointerDown={(e) => onPointerDownOutput(e, n)}
                  style={handleStyle("out")}
                  title={props.t("Drag to connect")}
                />
              </div>
            );
          })}

          {nodes.length === 0 && (
            <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-muted)", fontSize: 12 }}>
              {props.t("No nodes yet — Add node to start building the graph")}
            </div>
          )}
        </div>
      </div>
      <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
        {props.t("Node prompt template")}:{" "}
        <code style={{ background: "var(--bg-hover)", padding: "0 4px", borderRadius: 4 }}>{"{{steps.<node>.reply}}"}</code>,{" "}
        <code style={{ background: "var(--bg-hover)", padding: "0 4px", borderRadius: 4 }}>{"{{trigger.input.<key>}}"}</code>
      </div>
    </div>
  );

  function handleStyle(side: "in" | "out"): React.CSSProperties {
    return {
      position: "absolute",
      top: NODE_H / 2 - 5,
      [side === "out" ? "right" : "left"]: -5,
      width: 10,
      height: 10,
      borderRadius: "50%",
      background: "var(--accent)",
      border: "2px solid var(--bg-panel)",
      cursor: "crosshair",
      touchAction: "none",
      zIndex: 3,
    };
  }
}

function edgePath(x1: number, y1: number, x2: number, y2: number): string {
  const dx = Math.max(24, Math.abs(x2 - x1) / 2);
  return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
}

const toolBtn: React.CSSProperties = {
  background: "var(--bg-hover)",
  color: "var(--text)",
  border: "1px solid var(--border)",
  borderRadius: 6,
  padding: "4px 10px",
  fontSize: 11,
  fontWeight: 500,
  cursor: "pointer",
  fontFamily: "inherit",
};