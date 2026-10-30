import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import type { Provider } from "@earendil-works/pi-ai";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ provider: string }> };

export async function GET(_req: Request, { params }: Params) {
  const { provider } = await params;
  const runtime = await ModelRuntime.create();
  const status = runtime.getProviderAuthStatus(provider);
  const displayName = runtime.getProviders().find((p: Provider) => p.id === provider)?.name ?? provider;
  const models = runtime.getModels().filter((m) => m.provider === provider).length;
  return NextResponse.json({ provider, displayName, configured: status.configured, source: status.source, models });
}

export async function POST(req: Request, { params }: Params) {
  const { provider } = await params;
  try {
    const { apiKey } = await req.json() as { apiKey?: string };
    if (!apiKey || typeof apiKey !== "string" || !apiKey.trim()) {
      return NextResponse.json({ error: "apiKey is required" }, { status: 400 });
    }
    const runtime = await ModelRuntime.create();
    await (runtime as unknown as { credentials: { modify: (id: string, fn: () => Promise<{ type: "api_key"; key: string }>) => Promise<unknown> } })
      .credentials.modify(provider, async () => ({ type: "api_key", key: apiKey.trim() }));
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

export async function DELETE(_req: Request, { params }: Params) {
  const { provider } = await params;
  try {
    const runtime = await ModelRuntime.create();
    await (runtime as unknown as { credentials: { delete: (id: string) => Promise<void> } })
      .credentials.delete(provider);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
