import { TOOL_MARKET_IDS, type ToolMarketId } from "../shared/tools-market";

// 工具市场工具现在固定全部开启，不再支持关闭。
// 保留此模块是为了让调用方（rpc-manager、custom-tools-config 等）无需改动；
// 历史的 ~/.pi-work/tools-market.json 会被忽略，可安全删除。
export function readEnabledTools(): ToolMarketId[] {
  return [...TOOL_MARKET_IDS];
}
