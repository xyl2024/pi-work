// Tool activation is now owned by tools-market.json. This compatibility export
// remains for third-party server extensions that imported the old accessor.
import { readEnabledTools } from "./tools-market-config";

export function readEnabledCustomTools(): Set<string> {
  return new Set(readEnabledTools());
}
