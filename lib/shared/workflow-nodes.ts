/**
 * Generic workflow node schema + kind registry.
 *
 * All nodes share a common shape (see lib/shared/workflow.ts): flow fields
 * (`dependsOn`, `failurePolicy`, `maxAttempts`, canvas coords), a
 * `kind` selector, a literal `params` map and `inputs` bindings. The *only*
 * difference between node types is declared here — each kind describes its
 * input params, output params and how to compute them. Both the engine and
 * the schema-driven inspector UI consume this one registry, so adding a new
 * node type later means "write a def + a compute branch", not touching the
 * renderer or the flow engine.
 *
 * This module is pure (no fs / node APIs) so it stays shared with the client.
 */

export type WorkflowNodeKind = "start" | "agent" | "string" | "json" | "end";

export type WorkflowParamType = "string" | "number" | "boolean" | "select" | "json";
export type WorkflowValueType = "string" | "number" | "boolean" | "json";

/** A **literal input parameter** fed directly from the node's `params`. */
export interface WorkflowParamDef {
  key: string;
  label: string; // i18n key
  type: WorkflowParamType;
  required?: boolean;
  default?: unknown;
  placeholder?: string; // i18n key
  options?: { value: string; label: string }[]; // labels are i18n keys
  help?: string; // i18n key
}

/** A **data input** that may be bound (via an edge) to an upstream node's
 *  output, falling back to a literal `params[key]` value when unbound. */
export interface WorkflowInputDef {
  key: string;
  label: string; // i18n key
  type: WorkflowValueType;
  help?: string; // i18n key
}

/** A **data output** produced by the node for downstream nodes / templates. */
export interface WorkflowOutputDef {
  key: string;
  label: string; // i18n key
  type: WorkflowValueType;
  description?: string; // i18n key
}

export interface WorkflowNodeDef {
  kind: WorkflowNodeKind;
  label: string;       // i18n key, e.g. "Start node"
  description: string; // i18n key
  /** CSS var used to tint the node on the canvas. */
  accent: string;
  /** Whether this node spins up a pi agent session (vs. a pure function). */
  isAgent: boolean;
  params: WorkflowParamDef[];
  inputs: WorkflowInputDef[];
  outputs: WorkflowOutputDef[];
}

export const KINDS: WorkflowNodeKind[] = ["start", "agent", "string", "json", "end"];

export const NODE_DEFS: Record<WorkflowNodeKind, WorkflowNodeDef> = {
  start: {
    kind: "start",
    label: "Start node",
    description: "Workflow entry point; exposes the trigger input as its output",
    accent: "var(--success)",
    isAgent: false,
    params: [],
    inputs: [],
    outputs: [{ key: "input", label: "Trigger input", type: "json", description: "The payload the workflow was triggered with" }],
  },
  end: {
    kind: "end",
    label: "End node",
    description: "Terminal node; marks workflow completion and forwards the run's result",
    accent: "var(--text-muted)",
    isAgent: false,
    params: [],
    inputs: [{ key: "message", label: "Message", type: "string", help: "Text to carry through to the workflow result" }],
    outputs: [{ key: "message", label: "Message", type: "string" }],
  },
  agent: {
    kind: "agent",
    label: "Agent node",
    description: "Runs a pi agent session with a prompt (template supports {{steps.*}}, {{trigger.input.*}})",
    accent: "var(--accent)",
    isAgent: true,
    params: [],
    inputs: [],
    outputs: [{ key: "reply", label: "Reply", type: "string", description: "The final assistant reply text" }],
  },
  string: {
    kind: "string",
    label: "String node",
    description: "Transforms text (trim / case / length / concat / replace / substring)",
    accent: "var(--info)",
    isAgent: false,
    params: [
      { key: "operation", label: "Operation", type: "select", required: true, default: "trim", options: [
        { value: "trim", label: "Trim" },
        { value: "uppercase", label: "Uppercase" },
        { value: "lowercase", label: "Lowercase" },
        { value: "length", label: "Length" },
        { value: "concat", label: "Concat" },
        { value: "replace", label: "Replace" },
        { value: "substring", label: "Substring" },
      ] },
      { key: "value", label: "Value", type: "string", placeholder: "Input text" },
      { key: "append", label: "Append", type: "string", help: "Second operand for Concat" },
      { key: "search", label: "Search", type: "string", help: "Pattern to replace" },
      { key: "replacement", label: "Replacement", type: "string", help: "Replacement text" },
      { key: "start", label: "Start index", type: "number", default: 0 },
      { key: "len", label: "Length", type: "number", help: "Substring length" },
    ],
    inputs: [{ key: "value", label: "Value", type: "string", help: "Main text; may come from an upstream node" }],
    outputs: [{ key: "result", label: "Result", type: "string" }],
  },
  json: {
    kind: "json",
    label: "JSON node",
    description: "Serialize an object to JSON string, or parse a JSON string to an object",
    accent: "var(--accent)",
    isAgent: false,
    params: [
      { key: "mode", label: "Mode", type: "select", required: true, default: "stringify", options: [
        { value: "stringify", label: "Serialize" },
        { value: "parse", label: "Parse" },
      ] },
      { key: "value", label: "Value", type: "json", help: "Object to serialize, or JSON text to parse" },
    ],
    inputs: [{ key: "value", label: "Value", type: "json", help: "May come from an upstream node" }],
    outputs: [{ key: "result", label: "Result", type: "json" }],
  },
};

/** Primary output key (the "reply" a node feeds into templates / history). */
export function primaryOutputKey(kind: WorkflowNodeKind): string {
  return NODE_DEFS[kind].outputs[0]?.key ?? "result";
}

/**
 * Pure node computation. `params` are literals, `inputs` are already-resolved
 * upstream values (engine resolves refs against previously computed nodes).
 * Returns structured `outputs` keyed by the node kind's output defs, or an
 * `error` string if the transform itself fails (e.g. bad JSON to parse).
 */
export function computeNodeOutputs(
  kind: WorkflowNodeKind,
  params: Record<string, unknown>,
  inputs: Record<string, unknown>,
): { outputs: Record<string, unknown>; error?: string } {
  // value(): literal param, falling back to the bound input of the same key.
  const value = (key: string): unknown => (params[key] !== undefined ? params[key] : inputs[key]);
  const str = (key: string): string => {
    const v = value(key);
    return typeof v === "string" ? v : (v == null ? "" : String(v));
  };

  switch (kind) {
    case "start":
      return { outputs: { input: inputs["input"] ?? params["input"] ?? {} } };
    case "end":
      return { outputs: { message: str("message") } };
    case "string": {
      const text = str("value");
      switch (params["operation"] ?? "trim") {
        case "trim": return { outputs: { result: text.trim() } };
        case "uppercase": return { outputs: { result: text.toUpperCase() } };
        case "lowercase": return { outputs: { result: text.toLowerCase() } };
        case "length": return { outputs: { result: text.length } };
        case "concat": return { outputs: { result: text + str("append") } };
        case "replace": return { outputs: { result: text.split(str("search")).join(str("replacement")) } };
        case "substring": {
          const start = Number(value("start")) || 0;
          const len = params["len"] !== undefined && params["len"] !== "" ? Number(params["len"]) : NaN;
          return { outputs: { result: Number.isNaN(len) ? text.slice(start) : text.slice(start, start + len) } };
        }
        default: return { outputs: { result: text } };
      }
    }
    case "json": {
      if ((params["mode"] ?? "stringify") === "parse") {
        try {
          return { outputs: { result: JSON.parse(textOr(value("value"))) } };
        } catch (err) {
          return { outputs: { result: null }, error: `invalid JSON: ${err instanceof Error ? err.message : String(err)}` };
        }
      }
      let v = value("value");
      // A textual literal (from the editor textarea) may be a JSON object
      // literal — parse it first so we serialize the object, not a quoted string.
      if (typeof v === "string") {
        try { v = JSON.parse(v); } catch { /* keep the raw string */ }
      }
      try {
        return { outputs: { result: JSON.stringify(v ?? null) } };
      } catch (err) {
        return { outputs: { result: null }, error: `cannot serialize: ${err instanceof Error ? err.message : String(err)}` };
      }
    }
    case "agent":
      // Agent nodes run through the session executor, not here.
      return { outputs: { reply: str("reply") } };
    default:
      return { outputs: {} };
  }
}

function textOr(v: unknown): string {
  if (typeof v === "string") return v;
  if (v == null) return "";
  try { return JSON.stringify(v); } catch { return String(v); }
}