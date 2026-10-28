// 消息来源（Message origin）——一条用户消息从哪个入口发进会话的归属。
// 见 GLOSSARY「消息来源」词条、ADR-0023（用 custom entry 旁路记录）与
// .scratch/message-origin/spec.md。
//
// 判别联合 + 纯函数的全部决策在这里：web 是缺省（无标记 ≡ 网页端）、
// 非网页来源跟随一条 custom entry 持久化（customType 见
// MESSAGE_ORIGIN_ENTRY_TYPE）、渲染映射只产出图标名 + 名称 + i18n 词典键。
// 本模块浏览器/服务端两侧共用，禁止任何 Node API 或 React 依赖。

/** JSONL 里非网页来源用户消息身后那条 custom entry 的 customType（wire 值，钉住）。 */
export const MESSAGE_ORIGIN_ENTRY_TYPE = "pi_work_message_origin";

/** 每条自定义 entry 的 data 形状：来源本体 + 毫秒时间戳 + 消息文本前 80 字符。 */
export interface MessageOriginEntryData {
  origin: MessageOrigin;
  /** entry 写入时刻的毫秒时间戳。仅诊断用，不参与归属判定。 */
  timestamp: number;
  /** 应写入时刻消息文本的前 80 个码点。历史归属只靠消息树位置（reader 取
   * 树序最近的前一条 user message），此字段仅诊断用；但实时 pending 归属
   * 匹配兼用它做前缀比对（rpc-manager `consumePromptOrigin` 的
   * `text.startsWith(p.messagePrefix)`），见 ADR-0023。 */
  messagePrefix: string;
}

/** 消息来源的证据文件名（图标用 lucide 名，UI 侧映射为组件）。 */
export const MESSAGE_ORIGIN_ICONS = {
  channel: "MessageCircle",
  "scheduled-task": "CalendarClock",
  "subagent-session": "Bot",
} as const;

/** origin → 图标/名称/悬停文案的映射产物。名称是发送时刻的快照；悬停文案是
 * i18n 词典键（`t(key, params)` 形状），不硬编码单语言文本。网页端（缺省）
 * 返回三个 undefined，渲染继续走现有头像 + 昵称。 */
export interface MessageOriginDisplay {
  /** lucide 图标名；仅非网页来源有值。 */
  icon: string | undefined;
  /** 来源名称快照；仅非网页来源有值。 */
  label: string | undefined;
  /** 悬停完整说明（词典键 + 插值参数）；仅非网页来源有值。 */
  hover: { key: string; params: Record<string, string> } | undefined;
}

/**
 * 无标记（不含标记或缺省）一律视为网页端发送——这是历史消息、乐观插入消息
 * 天然落入的缺省规则。
 */
export function normalizeMessageOrigin(value: unknown): MessageOrigin {
  if (isMessageOrigin(value)) return value;
  return { kind: "web" };
}

/** 判别联合的类型守卫。非法数据不抛错，调用方按缺省（网页端）处理。 */
export function isMessageOrigin(value: unknown): value is MessageOrigin {
  if (typeof value !== "object" || value === null) return false;
  const o = value as Record<string, unknown>;
  switch (o.kind) {
    case "web":
      return true;
    case "channel":
      return (
        typeof o.channelId === "string" && o.channelId !== "" &&
        typeof o.provider === "string" && o.provider !== "" &&
        typeof o.name === "string" && o.name !== ""
      );
    case "scheduled-task":
      return (
        typeof o.taskId === "string" && o.taskId !== "" &&
        typeof o.name === "string" && o.name !== ""
      );
    case "subagent-session":
      return (
        typeof o.parentSessionId === "string" && o.parentSessionId !== "" &&
        typeof o.parentSessionTitle === "string" && o.parentSessionTitle !== "" &&
        typeof o.childSessionId === "string" && o.childSessionId !== ""
      );
    default:
      return false;
  }
}

/** entry data 的类型守卫：origin 必须合法、timestamp 是有限数、messagePrefix 是字符串。 */
export function isMessageOriginEntryData(value: unknown): value is MessageOriginEntryData {
  if (typeof value !== "object" || value === null) return false;
  const o = value as Record<string, unknown>;
  return (
    isMessageOrigin(o.origin) &&
    typeof o.timestamp === "number" && Number.isFinite(o.timestamp) &&
    typeof o.messagePrefix === "string"
  );
}

/** 「prompt + origin → 待写 entry 数据」：毫秒时间戳（仅诊断）+ 文本前 80 字符
 * （诊断 + 实时 pending 匹配的前缀）。 */
export function buildMessageOriginEntryData(
  prompt: string,
  origin: MessageOrigin,
  timestamp: number = Date.now(),
  prefixLength: number = 80,
): MessageOriginEntryData {
  const messagePrefix = [...String(prompt).slice(0, prefixLength * 2)].slice(0, prefixLength).join("");
  return { origin, timestamp, messagePrefix };
}

/** origin → 图标/名称/悬停文案。纯映射，UI 组件无脑消费。 */
export function messageOriginDisplay(origin: MessageOrigin | undefined | unknown): MessageOriginDisplay {
  const resolved = normalizeMessageOrigin(origin);
  if (resolved.kind === "web") return { icon: undefined, label: undefined, hover: undefined };
  if (resolved.kind === "channel") {
    return {
      icon: MESSAGE_ORIGIN_ICONS.channel,
      label: resolved.name,
      hover: { key: "Message from channel {channel}", params: { channel: resolved.name } },
    };
  }
  if (resolved.kind === "scheduled-task") {
    return {
      icon: MESSAGE_ORIGIN_ICONS["scheduled-task"],
      label: resolved.name,
      hover: { key: "Message from scheduled task {task}", params: { task: resolved.name } },
    };
  }
  // subagent-session
  return {
    icon: MESSAGE_ORIGIN_ICONS["subagent-session"],
    label: resolved.parentSessionTitle,
    hover: { key: "Message from session {session}", params: { session: resolved.parentSessionTitle } },
  };
}

/**
 * 消息来源的判别联合（扩展点：将来新来源加一个 kind，不动既有渲染与存储）。
 * id 与名称/标题快照都存：渲染优先用快照（历史稳定、实体可删），id 留作
 * 将来的跳转/区分能力。网页端没有附加数据。
 */
export type MessageOrigin =
  /** 网页端手动输入（缺省）。 */
  | { kind: "web" }
  /** 频道转发：频道 id + provider + 名称快照。 */
  | { kind: "channel"; channelId: string; provider: string; name: string }
  /** 定时任务触发：任务 id + 名称快照。 */
  | { kind: "scheduled-task"; taskId: string; name: string }
  /** 子代理会话手动补输入：父会话 id + 父会话标题快照 + 子会话 id。 */
  | {
      kind: "subagent-session";
      parentSessionId: string;
      parentSessionTitle: string;
      childSessionId: string;
    };
