import type { ReactNode } from "react";
import type { RightBarButtonId } from "@/lib/shared/right-bar";
import {
  PANEL_BUTTON_ID_BY_KIND,
  PANEL_TAB_KINDS,
  PANEL_TAB_SPECS,
  PANEL_TAB_SPEC_BY_KIND,
  type PanelMode,
  type PanelTabKind,
  type PanelViewKind,
} from "@/lib/shared/panelTabs";
import {
  Bot,
  ChartColumn,
  ChartSpline,
  Clock,
  GitBranch,
  GitGraph,
  Languages,
  PanelRight,
  Star,
} from "lucide-react";
import { ProviderGearIcon } from "../../ui/ProviderIcon";
import { GlobeIcon, McpIcon, ToolIcon } from "../../ui/icons";

export interface PanelIconOptions {
  size: number;
  active: boolean;
}
export type PanelIcon = (options: PanelIconOptions) => ReactNode;

export interface RightBarCtx {
  rightPanelState: PanelMode;
  activeTabKind: PanelTabKind | null;
  selectedSessionId: string | null;
  selectedCwd: string | null;
  modelsConfigDirty: boolean;
  skillsInstalling: boolean;
  schedulerRunning: boolean;
  mcpDirty: boolean;
  t: (key: string) => string;

  toggleRightPanel: () => void;
  togglePanel: (kind: PanelViewKind) => void;
}

export interface RightBarDescriptor {
  id: RightBarButtonId | "panelToggle";
  kind: "fixed" | "configurable";
  panelKind?: PanelViewKind;
  slot?: "top" | "bottom";
  sessionBound?: true;
  labelKey: string;
  icon: PanelIcon;
  badge?: (ctx: RightBarCtx) => ReactNode | null;
  isActive: (ctx: RightBarCtx) => boolean;
  isDisabled?: (ctx: RightBarCtx) => boolean;
  isVisible?: (ctx: RightBarCtx) => boolean;
  onClick: (ctx: RightBarCtx) => void;
}

const panelToggleDescriptor: RightBarDescriptor = {
  id: "panelToggle",
  kind: "fixed",
  slot: "top",
  labelKey: "",
  icon: ({ size }) => <PanelRight size={size} />,
  isActive: (ctx) => ctx.rightPanelState !== "closed",
  onClick: (ctx) => ctx.toggleRightPanel(),
};

function CornerBadge() {
  return (
    <span
      aria-hidden="true"
      style={{
        position: "absolute",
        top: 5,
        right: 5,
        width: 7,
        height: 7,
        borderRadius: "50%",
        background: "var(--accent)",
        boxShadow: "0 0 0 2px var(--bg-panel)",
      }}
    />
  );
}

function panelButton(
  kind: PanelViewKind,
  presentation: {
    labelKey: string;
    icon: PanelIcon;
    isDisabled?: (ctx: RightBarCtx) => boolean;
    badge?: (ctx: RightBarCtx) => ReactNode | null;
  },
): RightBarDescriptor {
  const buttonId = PANEL_BUTTON_ID_BY_KIND[kind];
  const spec = PANEL_TAB_SPEC_BY_KIND[buttonId];
  return {
    id: buttonId,
    kind: "configurable",
    panelKind: kind,
    labelKey: presentation.labelKey,
    icon: presentation.icon,
    isActive: (ctx) => ctx.activeTabKind === kind,
    onClick: (ctx) => ctx.togglePanel(kind),
    ...(spec.sessionBound ? { sessionBound: true as const } : {}),
    ...(presentation.isDisabled ? { isDisabled: presentation.isDisabled } : {}),
    ...(presentation.badge ? { badge: presentation.badge } : {}),
  };
}

const PANEL_DESCRIPTOR_BY_KIND: Record<PanelViewKind, RightBarDescriptor> = {
  context: panelButton("context", {
    labelKey: "Context insight",
    icon: ({ size }) => <Bot size={size} />,
  }),
  translate: panelButton("translate", {
    labelKey: "Open translate",
    icon: ({ size }) => <Languages size={size} />,
  }),
  gitDiff: panelButton("gitDiff", {
    labelKey: "Open git diff",
    isDisabled: (ctx) => !ctx.selectedCwd,
    icon: ({ size }) => <GitGraph size={size} />,
  }),
  favorites: panelButton("favorites", {
    labelKey: "Open favorites",
    icon: ({ size, active }) => (
      <Star size={size} fill={active ? "var(--accent)" : "none"} />
    ),
  }),
  tokens: panelButton("tokens", {
    labelKey: "Open token audit",
    icon: ({ size }) => <ChartSpline size={size} />,
  }),
  llmAudit: panelButton("llmAudit", {
    labelKey: "Open LLM API audit",
    icon: ({ size }) => <ChartColumn size={size} />,
  }),
  modelsConfig: panelButton("modelsConfig", {
    labelKey: "Open models config",
    icon: ({ size }) => <ProviderGearIcon size={size} color="inherit" />,
    badge: (ctx) => (ctx.modelsConfigDirty ? <CornerBadge /> : null),
  }),
  skills: panelButton("skills", {
    labelKey: "Open skills",
    icon: ({ size }) => <ToolIcon size={size} />,
    badge: (ctx) => (ctx.skillsInstalling ? <CornerBadge /> : null),
  }),
  scheduler: panelButton("scheduler", {
    labelKey: "Open scheduled tasks",
    icon: ({ size }) => <Clock size={size} />,
    badge: (ctx) => (ctx.schedulerRunning ? <CornerBadge /> : null),
  }),
  mcp: panelButton("mcp", {
    labelKey: "mcp.open",
    icon: ({ size }) => <McpIcon size={size} />,
    badge: (ctx) => (ctx.mcpDirty ? <CornerBadge /> : null),
  }),
  channels: panelButton("channels", {
    labelKey: "Open channels",
    icon: ({ size }) => <GlobeIcon size={size} />,
  }),
  conversationTree: panelButton("conversationTree", {
    labelKey: "Open conversation tree",
    isDisabled: (ctx) => !ctx.selectedSessionId && !ctx.selectedCwd,
    icon: ({ size }) => <GitBranch size={size} />,
  }),
};

export const RIGHT_BAR_DESCRIPTORS: readonly RightBarDescriptor[] = [
  panelToggleDescriptor,
  ...PANEL_TAB_KINDS.map((kind) => PANEL_DESCRIPTOR_BY_KIND[kind]),
];

export const PANEL_TAB_ICON_BY_KIND: Record<PanelViewKind, PanelIcon> =
  Object.fromEntries(
    PANEL_TAB_KINDS.map((kind) => [kind, PANEL_DESCRIPTOR_BY_KIND[kind].icon]),
  ) as Record<PanelViewKind, PanelIcon>;

export const PANEL_COMMAND_ICON_BY_KIND: Partial<Record<PanelViewKind, ReactNode>> =
  Object.fromEntries(
    PANEL_TAB_SPECS.filter((spec) => spec.commands?.length).map((spec) => [
      spec.kind,
      PANEL_TAB_ICON_BY_KIND[spec.kind]({ size: 16, active: false }),
    ]),
  ) as Partial<Record<PanelViewKind, ReactNode>>;

export const RIGHT_BAR_BUTTON_IDS: readonly RightBarButtonId[] =
  RIGHT_BAR_DESCRIPTORS.filter((d) => d.kind === "configurable").map(
    (d) => d.id as RightBarButtonId,
  );

export function isSessionBoundDescriptor(desc: RightBarDescriptor): boolean {
  return desc.sessionBound === true;
}

export const RIGHT_BAR_DESCRIPTOR_BY_ID: ReadonlyMap<
  RightBarDescriptor["id"],
  RightBarDescriptor
> = new Map(RIGHT_BAR_DESCRIPTORS.map((d) => [d.id, d]));

export function resolveButtonLabel(
  desc: RightBarDescriptor,
  ctx: RightBarCtx,
): string {
  switch (desc.id) {
    case "panelToggle":
      return ctx.t(
        ctx.rightPanelState !== "closed" ? "Hide file panel" : "Show file panel",
      );
    default:
      return ctx.t(desc.labelKey);
  }
}
