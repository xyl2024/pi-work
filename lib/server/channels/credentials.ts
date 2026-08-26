import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync, chmodSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import type { WeChatAccount } from "@/lib/shared/wechat/types";

function root(): string { return join(homedir(), ".pi-work", "channels"); }
function pathFor(channelId: string): string { return join(root(), channelId, "account.json"); }

export function loadChannelAccount(channelId: string): WeChatAccount | null {
  const file = pathFor(channelId);
  if (!existsSync(file)) return null;
  try {
    const account = JSON.parse(readFileSync(file, "utf8")) as WeChatAccount;
    return account && typeof account.token === "string" ? account : null;
  } catch { return null; }
}

export function saveChannelAccount(channelId: string, account: WeChatAccount): void {
  const dir = join(root(), channelId);
  mkdirSync(dir, { recursive: true });
  const file = pathFor(channelId);
  writeFileSync(file, JSON.stringify(account, null, 2), "utf8");
  try { chmodSync(file, 0o600); } catch { /* best effort */ }
}

export function deleteChannelAccount(channelId: string): void {
  try { unlinkSync(pathFor(channelId)); } catch { /* already absent */ }
}
