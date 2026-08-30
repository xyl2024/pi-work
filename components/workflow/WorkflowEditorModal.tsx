/**
 * WorkflowEditorModal — create / edit a workflow and its orchestration graph.
 *
 * Nodes come in several kinds (start / agent / string / json / end) sharing a
 * generic schema: flow fields + literal `params` + data `inputs` bindings.
 * The kind's shape is driven by the registry in lib/shared/workflow-nodes.ts,
 * so the inspector form, the canvas tinting and the engine all agree.
 *
 * Left: draggable/connectable DAG canvas. Right: schema-driven node inspector
 * (kind selector, data inputs, literal params, outputs, flow + agent fields).
 * "Add node ▾" picks a node kind. Dragging output→input also auto-binds the
 * target's first unbound data input to the source's primary output.
 */

import { useEffect, useMemo, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useModalAnimation } from "@/hooks/useModalAnimation";
import { CloseIcon } from "@/components/ui/icons";
import { WorkflowNodeCanvas, type CanvasNode } from "./WorkflowNodeCanvas";
import { apiFetch, layeredLayout, newNodeId } from "./utils";
import { KINDS, NODE_DEFS } from "@/lib/shared/workflow-nodes";
import type {
  NodeCreateInput,
  Workflow,
  WorkflowFailurePolicy,
  WorkflowNodeInput,
  WorkflowNodeKind,
  WorkflowTriggerType,
} from "@/lib/shared/workflow";

interface Props {
  open: boolean;
  workflow: Workflow | null;
  onClose: () => void;
  onSaved: () => void;
  onToast: (kind: "success" | "error", message: string) => void;
}

interface NodeDraft {
  id: string;
  kind: WorkflowNodeKind;
  name: string;
  prompt: string;
  cwd: string;
  provider: string;
  modelId: string;
  thinkingLevel: string;
  maxLifetimeMs: number | "";
  params: Record<string, unknown>;
  inputs: WorkflowNodeInput[];
  failurePolicy: WorkflowFailurePolicy;
  maxAttempts: number;
  x: number;
  y: number;
  dependsOn: string[];
}

function defaultParams(kind: WorkflowNodeKind): Record<string, unknown> {
  const p: Record<string, unknown> = {};
  for (const def of NODE_DEFS[kind].params) {
    if (def.default !== undefined) p[def.key] = def.default;
  }
  return p;
}

function emptyNode(kind: WorkflowNodeKind, x: number, y: number): NodeDraft {
  return {
    id: newNodeId(), kind, name: "", prompt: "", cwd: "", provider: "", modelId: "",
    thinkingLevel: "", maxLifetimeMs: "", params: defaultParams(kind), inputs: [],
    failurePolicy: "fail", maxAttempts: 1, x, y, dependsOn: [],
  };
}

export function WorkflowEditorModal({ open, workflow, onClose, onSaved, onToast }: Props) {
  const { t } = useI18n();
  const { requestClose, backdropStyle, panelStyle, isVisible } = useModalAnimation({ isOpen: open, onClose });

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [triggerType, setTriggerType] = useState<WorkflowTriggerType>("manual");
  const [cron, setCron] = useState("");
  const [cwd, setCwd] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [nodes, setNodes] = useState<NodeDraft[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const timezone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, []);

  useEffect(() => {
    if (!open) return;
    if (workflow) {
      setName(workflow.name);
      setDescription(workflow.description);
      setTriggerType(workflow.triggerType);
      setCron(workflow.cron ?? "");
      setCwd(workflow.cwd);
      setEnabled(workflow.enabled);
      let drafts: NodeDraft[] = workflow.nodes.length > 0
        ? workflow.nodes.map((n) => ({
            id: n.id, kind: n.kind, name: n.name, prompt: n.prompt, cwd: n.cwd ?? "",
            provider: n.provider ?? "", modelId: n.modelId ?? "", thinkingLevel: n.thinkingLevel ?? "",
            maxLifetimeMs: n.maxLifetimeMs ?? "", params: { ...n.params }, inputs: (n.inputs ?? []).map((i) => ({ ...i })),
            failurePolicy: n.failurePolicy, maxAttempts: n.maxAttempts, x: n.x, y: n.y, dependsOn: [...n.dependsOn],
          }))
        : [emptyNode("start", 30, 40)];
      if (drafts.length > 0 && drafts.every((d) => d.x === 0 && d.y === 0)) {
        drafts = applyLayout(drafts);
      }
      setNodes(drafts);
      setSelectedId(drafts[0]?.id ?? null);
    } else {
      setName(""); setDescription(""); setTriggerType("manual"); setCron(""); setEnabled(true); setCwd("");
      const first = emptyNode("start", 30, 40);
      setNodes([first]);
      setSelectedId(first.id);
    }
  }, [open, workflow]);

  const updateDeps = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const n of nodes) m.set(n.id, [...n.dependsOn]);
    return m;
  }, [nodes]);

  const nodeById = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);

  if (!isVisible) return null;

  const selected = selectedId ? nodes.find((n) => n.id === selectedId) ?? null : null;
  const canvasNodes: CanvasNode[] = nodes.map((n) => {
    const def = NODE_DEFS[n.kind];
    return { id: n.id, kind: n.kind, kindLabel: t(def?.label ?? "Agent node"), accent: def?.accent ?? "var(--accent)", name: n.name, x: n.x, y: n.y, failurePolicy: n.failurePolicy, dependsOn: n.dependsOn };
  });

  const updateNode = (id: string, patch: Partial<NodeDraft>) =>
    setNodes((prev) => prev.map((n) => (n.id === id ? { ...n, ...patch } : n)));

  const addNode = (kind: WorkflowNodeKind) => {
    const last = nodes[nodes.length - 1];
    const node = last && (last.name || last.prompt)
      ? emptyNode(kind, last.x + 264, last.y)
      : emptyNode(kind, 30, 40 + nodes.length * 96);
    if (last && (last.name || last.prompt)) node.dependsOn = [last.id];
    setNodes((prev) => [...prev, node]);
    setSelectedId(node.id);
  };

  const removeNode = (id: string) => {
    setNodes((prev) => prev.filter((n) => n.id !== id).map((n) => ({
      ...n,
      dependsOn: n.dependsOn.filter((d) => d !== id),
      inputs: n.inputs.map((i) => (i.ref && i.ref.startsWith(`${id}.`) ? { ...i, ref: null } : i)),
    })));
    if (selectedId === id) setSelectedId(null);
  };

  const moveNode = (id: string, x: number, y: number) => {
    setNodes((prev) => prev.map((n) => (n.id === id ? { ...n, x: Math.round(x), y: Math.round(y) } : n)));
  };

  const dependsOnTransitively = (fromId: string, toId: string): boolean => {
    const stack = [...(updateDeps.get(fromId) ?? [])];
    const seen = new Set<string>();
    while (stack.length) {
      const cur = stack.pop()!;
      if (cur === toId) return true;
      if (seen.has(cur)) continue;
      seen.add(cur);
      for (const d of updateDeps.get(cur) ?? []) stack.push(d);
    }
    return false;
  };

  /** Wire an edge fromId→toId and auto-bind toId's first unbound input to
   *  fromId's primary output. */
  const connect = (fromId: string, toId: string) => {
    const target = nodes.find((n) => n.id === toId);
    const source = nodes.find((n) => n.id === fromId);
    if (!target || !source) return;
    if (fromId === toId) return;
    if (target.dependsOn.includes(fromId)) return;
    if (dependsOnTransitively(fromId, toId)) {
      onToast("error", t("Cannot connect — that would create a cycle"));
      return;
    }
    const nextDeps = [...target.dependsOn, fromId];
    // Auto-bind: first declared input of the target that has no ref yet ← source output.
    const tDef = NODE_DEFS[target.kind];
    const sourceOut = NODE_DEFS[source.kind]?.outputs[0]?.key;
    let nextInputs = [...target.inputs];
    if (tDef && sourceOut) {
      const unbound = tDef.inputs.find((d) => !nextInputs.some((i) => i.key === d.key && i.ref));
      if (unbound) {
        nextInputs = [...nextInputs.filter((i) => i.key !== unbound.key), { key: unbound.key, ref: `${fromId}.${sourceOut}` }];
      }
    }
    updateNode(toId, { dependsOn: nextDeps, inputs: nextInputs });
  };

  const changeKind = (id: string, kind: WorkflowNodeKind) => {
    updateNode(id, { kind, params: defaultParams(kind) });
  };

  const unbindInput = (id: string, key: string) => {
    const node = nodes.find((n) => n.id === id);
    if (!node) return;
    updateNode(id, { inputs: node.inputs.map((i) => (i.key === key ? { ...i, ref: null } : i)) });
  };

  const setParam = (id: string, key: string, val: unknown) => {
    const node = nodes.find((n) => n.id === id);
    if (!node) return;
    updateNode(id, { params: { ...node.params, [key]: val } });
  };

  const autoLayoutNodes = () => {
    setNodes((prev) => applyLayout(prev));
  };

  const validate = (): string | null => {
    if (!name.trim()) return t("Please enter a workflow name");
    if (!cwd.trim()) return t("Please enter a working directory");
    if (triggerType === "cron" && !cron.trim()) return t("Please enter a cron expression");
    const trimmed = nodes.filter((n) => n.name.trim() || n.prompt.trim());
    if (trimmed.length === 0) return t("Add at least one node");
    const ids = new Set(nodes.map((n) => n.id));
    for (const n of trimmed) {
      if (!n.name.trim()) return t("Every node needs a name");
      if (n.kind === "agent" && !n.prompt.trim()) return t("Every agent node needs a prompt");
      for (const d of n.dependsOn) if (!ids.has(d)) return t("Every node dependency must exist");
    }
    return null;
  };

  const handleSave = async () => {
    const err = validate();
    if (err) { onToast("error", err); return; }
    setSaving(true);
    const trimmedNodes = nodes
      .filter((n) => n.name.trim() || n.prompt.trim())
      .map((n): NodeCreateInput => {
        const common = {
          id: n.id,
          kind: n.kind,
          name: n.name.trim(),
          params: n.params,
          inputs: n.inputs,
          failurePolicy: n.failurePolicy,
          maxAttempts: Math.max(1, Math.min(10, Math.floor(n.maxAttempts) || 1)),
          dependsOn: n.dependsOn,
          x: Math.round(n.x),
          y: Math.round(n.y),
        };
        if (n.kind === "agent") {
          return {
            ...common,
            prompt: n.prompt.trim(),
            cwd: n.cwd.trim() ? n.cwd.trim() : null,
            provider: n.provider.trim() ? n.provider.trim() : null,
            modelId: n.modelId.trim() ? n.modelId.trim() : null,
            thinkingLevel: n.thinkingLevel.trim() ? n.thinkingLevel.trim() : null,
            maxLifetimeMs: n.maxLifetimeMs === "" || n.maxLifetimeMs === null ? null : Math.floor(Number(n.maxLifetimeMs)) || null,
          };
        }
        return { ...common, prompt: "" };
      });
    const payload = {
      name: name.trim(),
      description: description.trim(),
      triggerType,
      cron: triggerType === "cron" && cron.trim() ? cron.trim() : null,
      timezone,
      enabled: triggerType === "cron" ? enabled : true,
      cwd: cwd.trim(),
      nodes: trimmedNodes,
    };
    try {
      if (workflow) {
        await apiFetch("/api/workflows", { method: "PATCH", body: JSON.stringify({ id: workflow.id, ...payload }) });
      } else {
        await apiFetch("/api/workflows", { method: "POST", body: JSON.stringify(payload) });
      }
      onToast("success", workflow ? t("Workflow updated") : t("Workflow created"));
      onSaved();
    } catch (e) {
      onToast("error", e instanceof Error ? e.message : t("Failed to save workflow"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={backdropStyle} onClick={(e) => { if (e.target === e.currentTarget) requestClose(); }}>
      <div style={{ ...panelStyle, background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 12, width: 1120, maxWidth: "98vw", height: "94vh", display: "flex", flexDirection: "column", boxShadow: "0 12px 40px rgba(0,0,0,0.22)", overflow: "hidden" }}>
        {/* header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 18px", flexShrink: 0 }}>
          <span style={{ fontSize: 15, fontWeight: 700, color: "var(--text)" }}>{workflow ? t("Edit workflow") : t("New workflow")}</span>
          <button onClick={requestClose} aria-label={t("Close")} style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 28, height: 28, padding: 0, background: "transparent", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: 18, lineHeight: 1 }}>
            <CloseIcon width={14} height={14} />
          </button>
        </div>

        {/* scroll body */}
        <div style={{ flex: 1, overflowY: "auto", padding: "0 18px 18px" }}>
          <WorkflowMeta
            name={name} description={description} triggerType={triggerType} cron={cron}
            enabled={enabled} cwd={cwd}
            onName={setName} onDescription={setDescription} onTriggerType={setTriggerType}
            onCron={setCron} onEnabled={setEnabled} onCwd={setCwd} t={t}
          />

          {/* graph area: canvas + inspector side by side */}
          <div style={{ marginTop: 12 }}>
            <div style={{ display: "flex", gap: 12, marginTop: 8, alignItems: "stretch" }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <WorkflowNodeCanvas
                  nodes={canvasNodes}
                  selectedId={selectedId}
                  onSelect={setSelectedId}
                  onMoveNode={moveNode}
                  onConnect={connect}
                  onRemoveNode={removeNode}
                  onAddNode={addNode}
                  onAutoLayout={autoLayoutNodes}
                  t={t}
                />
              </div>

              {/* right-hand node inspector — schema-driven */}
              <div style={{ width: 320, flexShrink: 0, border: `1px solid ${selected ? NODE_DEFS[selected.kind]?.accent ?? "var(--accent)" : "var(--border)"}`, borderRadius: 8, background: "var(--bg-panel)", display: "flex", flexDirection: "column", maxHeight: "52vh", minHeight: 380 }}>
                <div style={{ padding: "10px 12px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text)" }}>{selected ? t("Node inspector") : t("Node inspector")}</span>
                  {selected && <button onClick={() => setSelectedId(null)} style={mini}>{t("Done")}</button>}
                </div>
                <div style={{ flex: 1, overflowY: "auto", padding: 12 }}>
                  {selected ? (
                    <NodeInspector node={selected} byId={nodeById} t={t}
                      onChangeKind={(k) => changeKind(selected.id, k)}
                      onChange={(p) => updateNode(selected.id, p)}
                      onSetParam={(key, v) => setParam(selected.id, key, v)}
                      onUnbind={(key) => unbindInput(selected.id, key)} />
                  ) : (
                    <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.6 }}>
                      {t("Click a node on the canvas to edit it")}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* footer */}
        <div style={{ padding: "12px 18px", borderTop: "1px solid var(--border)", display: "flex", justifyContent: "flex-end", gap: 8, flexShrink: 0 }}>
          <button onClick={requestClose} style={ghost}>{t("Cancel")}</button>
          <button onClick={handleSave} disabled={saving} style={{ ...primary, opacity: saving ? 0.6 : 1 }}>
            {saving ? t("Saving...") : (workflow ? t("Save") : t("Create"))}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Schema-driven inspector for the selected node. */
function NodeInspector(props: {
  node: NodeDraft;
  byId: Map<string, NodeDraft>;
  t: (k: string) => string;
  onChangeKind: (k: WorkflowNodeKind) => void;
  onChange: (p: Partial<NodeDraft>) => void;
  onSetParam: (key: string, v: unknown) => void;
  onUnbind: (key: string) => void;
}) {
  const { node, byId, t } = props;
  const def = NODE_DEFS[node.kind];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* kind + name */}
      <Field label={t("Type")}>
        <select style={input} value={node.kind} onChange={(e) => props.onChangeKind(e.target.value as WorkflowNodeKind)}>
          {KINDS.map((k) => <option key={k} value={k}>{t(NODE_DEFS[k].label)}</option>)}
        </select>
      </Field>
      <Field label={t("Name")} required stretch>
        <input style={input} value={node.name} onChange={(e) => props.onChange({ name: e.target.value })} placeholder={t("e.g. summarize issues")} />
      </Field>
      {def.description && <div style={{ fontSize: 11, color: "var(--text-muted)", lineHeight: 1.5 }}>{t(def.description)}</div>}

      {/* data inputs */}
      {def.inputs.length > 0 && (
        <SectionTitle>{t("Data inputs")}</SectionTitle>
      )}
      {def.inputs.map((inDef) => {
        const bound = node.inputs.find((i) => i.key === inDef.key && i.ref);
        const refParts = bound && bound.ref ? parseRef(bound.ref) : null;
        const refName = refParts ? (byId.get(refParts.nodeId)?.name || refParts.nodeId) : "";
        return (
          <div key={inDef.key} style={{ marginBottom: 2 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.04em", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span>{t(inDef.label)}</span>
              {bound && (
                <button onClick={() => props.onUnbind(inDef.key)} style={{ ...mini, padding: "1px 6px", fontSize: 10 }}>{t("unbind")}</button>
              )}
            </div>
            {bound && refParts ? (
              <div style={{ fontSize: 11, color: "var(--accent)", marginTop: 3, wordBreak: "break-all" }}>
                ← {refName}.{refParts.outputKey}
              </div>
            ) : (
              <input style={{ ...input, marginTop: 3 }} value={String(node.params[inDef.key] ?? "")}
                onChange={(e) => props.onSetParam(inDef.key, inDef.type === "number" ? (e.target.value === "" ? "" : Number(e.target.value)) : e.target.value)}
                placeholder={t("Literal; drag an edge to bind")} />
            )}
            {inDef.help && <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 2 }}>{t(inDef.help)}</div>}
          </div>
        );
      })}

      {/* literal params */}
      {def.params.length > 0 && <SectionTitle>{t("Parameters")}</SectionTitle>}
      {def.params.map((pDef) => (
        <Field key={pDef.key} label={t(pDef.label)} required={pDef.required}>
          <ParamField param={pDef} value={node.params[pDef.key]} t={t} onChange={(v) => props.onSetParam(pDef.key, v)} />
        </Field>
      ))}

      {/* outputs */}
      {def.outputs.length > 0 && <SectionTitle>{t("Outputs")}</SectionTitle>}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {def.outputs.map((o) => (
          <span key={o.key} style={{ fontSize: 11, padding: "3px 8px", borderRadius: 6, background: "var(--bg-hover)", color: "var(--text)", border: "1px solid var(--border)" }}>
            <b>{o.key}</b> <span style={{ color: "var(--text-muted)" }}>({t(o.label)} · {o.type})</span>
          </span>
        ))}
      </div>

      {/* flow / execution common */}
      <SectionTitle>{t("Flow")}</SectionTitle>
      <div style={{ display: "flex", gap: 8 }}>
        <Field label={t("Failure")}>
          <select style={input} value={node.failurePolicy} onChange={(e) => props.onChange({ failurePolicy: e.target.value as WorkflowFailurePolicy })}>
            <option value="fail">{t("Fail run")}</option>
            <option value="skip">{t("Skip node")}</option>
          </select>
        </Field>
        <Field label={t("Attempts")}>
          <input style={input} type="number" min={1} max={10} value={node.maxAttempts} onChange={(e) => props.onChange({ maxAttempts: parseInt(e.target.value, 10) || 1 })} />
        </Field>
      </div>

      {/* agent-specific */}
      {node.kind === "agent" && (
        <>
          <SectionTitle>{t("Agent")}</SectionTitle>
          <Field label={t("Prompt")} required>
            <textarea style={textarea} value={node.prompt} onChange={(e) => props.onChange({ prompt: e.target.value })} placeholder={t("Prompt sent to agent at this step")} />
          </Field>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            <Field label={t("cwd (optional)")} stretch>
              <input style={{ ...input, fontFamily: "var(--font-mono)" }} value={node.cwd} onChange={(e) => props.onChange({ cwd: e.target.value })} placeholder={t("falls back to workflow cwd")} />
            </Field>
            <Field label={t("provider")}>
              <input style={input} value={node.provider} onChange={(e) => props.onChange({ provider: e.target.value })} />
            </Field>
            <Field label={t("modelId")}>
              <input style={input} value={node.modelId} onChange={(e) => props.onChange({ modelId: e.target.value })} />
            </Field>
            <Field label={t("thinking")}>
              <input style={input} value={node.thinkingLevel} onChange={(e) => props.onChange({ thinkingLevel: e.target.value })} />
            </Field>
            <Field label={t("max lifetime (ms)")}>
              <input style={input} type="number" min={1000} value={node.maxLifetimeMs} onChange={(e) => props.onChange({ maxLifetimeMs: e.target.value === "" ? "" : Number(e.target.value) })} />
            </Field>
          </div>
        </>
      )}
    </div>
  );
}

function ParamField(props: {
  param: import("@/lib/shared/workflow-nodes").WorkflowParamDef;
  value: unknown;
  t: (k: string) => string;
  onChange: (v: unknown) => void;
}) {
  const { param, value, t } = props;
  if (param.type === "select") {
    return (
      <select style={input} value={String(value ?? "")} onChange={(e) => props.onChange(e.target.value)}>
        {param.options?.map((o) => <option key={o.value} value={o.value}>{t(o.label)}</option>)}
      </select>
    );
  }
  if (param.type === "boolean") {
    return (
      <select style={input} value={String(!!value)} onChange={(e) => props.onChange(e.target.value === "true")}>
        <option value="true">{t("true")}</option>
        <option value="false">{t("false")}</option>
      </select>
    );
  }
  if (param.type === "json") {
    return (
      <textarea style={{ ...input, fontFamily: "var(--font-mono)", resize: "vertical", minHeight: 56, lineHeight: 1.4 }} value={typeof value === "string" ? value : (value == null ? "" : JSON.stringify(value, null, 2))} onChange={(e) => props.onChange(e.target.value)} placeholder={t("Enter a JSON literal")} />
    );
  }
  if (param.type === "number") {
    return (
      <input style={input} type="number" value={value === undefined || value === null ? "" : String(value)} onChange={(e) => props.onChange(e.target.value === "" ? "" : Number(e.target.value))} />
    );
  }
  return <input style={input} value={value === undefined || value === null ? "" : String(value)} onChange={(e) => props.onChange(e.target.value)} placeholder={param.placeholder ? t(param.placeholder) : undefined} />;
}

function parseRef(ref: string): { nodeId: string; outputKey: string } | null {
  const m = /^([\w-]+)\.([\w-]+)$/.exec(ref);
  if (!m) return null;
  return { nodeId: m[1], outputKey: m[2] };
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginTop: 2 }}>{children}</div>
  );
}

function WorkflowMeta(props: {
  name: string; description: string; triggerType: WorkflowTriggerType; cron: string;
  enabled: boolean; cwd: string;
  onName: (v: string) => void; onDescription: (v: string) => void;
  onTriggerType: (v: WorkflowTriggerType) => void; onCron: (v: string) => void;
  onEnabled: (v: boolean) => void; onCwd: (v: string) => void;
  t: (k: string) => string;
}) {
  const { t } = props;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <Field label={t("Name")} required>
        <input style={input} value={props.name} onChange={(e) => props.onName(e.target.value)} placeholder={t("e.g. morning report")} />
      </Field>
      <Field label={t("Description")}>
        <input style={input} value={props.description} onChange={(e) => props.onDescription(e.target.value)} placeholder={t("Optional description")} />
      </Field>
      <Field label={t("Trigger")}>
        <div style={{ display: "flex", gap: 6 }}>
          {(["manual", "cron"] as WorkflowTriggerType[]).map((tt) => (
            <button key={tt} onClick={() => props.onTriggerType(tt)} style={{ padding: "5px 12px", fontSize: 12, borderRadius: 6, border: "1px solid var(--border)", cursor: "pointer", fontFamily: "inherit", background: props.triggerType === tt ? "var(--accent)" : "var(--bg-hover)", color: props.triggerType === tt ? "#fff" : "var(--text)", fontWeight: 500 }}>
              {tt === "cron" ? t("Cron") : t("Manual")}
            </button>
          ))}
        </div>
      </Field>
      {props.triggerType === "cron" && (
        <div style={{ display: "flex", gap: 8 }}>
          <Field label={t("Cron expression")} required stretch>
            <input style={input} value={props.cron} onChange={(e) => props.onCron(e.target.value)} placeholder="0 9 * * 1-5" />
          </Field>
          <Field label={t("Enabled")}>
            <button onClick={() => props.onEnabled(!props.enabled)} style={{ padding: "5px 12px", fontSize: 12, borderRadius: 6, border: "1px solid var(--border)", cursor: "pointer", fontFamily: "inherit", background: props.enabled ? "var(--success-bg)" : "var(--bg-hover)", color: props.enabled ? "var(--success)" : "var(--text-muted)", fontWeight: 500 }}>
              {t(props.enabled ? "Enabled" : "Paused")}
            </button>
          </Field>
        </div>
      )}
      <Field label={t("Working directory")} required hint={t("agent cwd; nodes can override")}>
        <input style={{ ...input, fontFamily: "var(--font-mono)" }} value={props.cwd} onChange={(e) => props.onCwd(e.target.value)} />
      </Field>
    </div>
  );
}

function Field({ label, required, hint, stretch, children }: { label: string; required?: boolean; hint?: string; stretch?: boolean; children: React.ReactNode }) {
  return (
    <div style={{ flex: stretch ? 1 : undefined, minWidth: 0 }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.05em" }}>
        {label}{required && <span style={{ color: "var(--error)", marginLeft: 2 }}>*</span>}
      </div>
      {children}
      {hint && <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 3, lineHeight: 1.4 }}>{hint}</div>}
    </div>
  );
}

function applyLayout(drafts: NodeDraft[]): NodeDraft[] {
  const pos = layeredLayout(drafts);
  return drafts.map((n) => ({ ...n, ...(pos.get(n.id) ?? { x: n.x, y: n.y }) }));
}

const input: React.CSSProperties = { width: "100%", fontSize: 12, padding: "6px 9px", border: "1px solid var(--border)", borderRadius: 6, background: "var(--bg)", color: "var(--text)", boxSizing: "border-box", fontFamily: "inherit" };
const textarea: React.CSSProperties = { ...input, resize: "vertical", minHeight: 64, fontFamily: "var(--font-mono)", lineHeight: 1.5 };
const primary: React.CSSProperties = { background: "var(--accent)", color: "#fff", border: "none", borderRadius: 6, padding: "6px 14px", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" };
const ghost: React.CSSProperties = { background: "var(--bg-hover)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: 6, padding: "5px 12px", fontSize: 12, fontWeight: 500, cursor: "pointer", fontFamily: "inherit" };
const mini: React.CSSProperties = { background: "var(--bg-hover)", color: "var(--text-muted)", border: "1px solid var(--border)", borderRadius: 5, padding: "2px 10px", fontSize: 11, cursor: "pointer", fontFamily: "inherit" };