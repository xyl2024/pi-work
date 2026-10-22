import { testModelConnection } from "@/lib/server/model-connection-test";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: unknown;
  try { body = await request.json(); } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const { provider, modelId } = (body ?? {}) as Record<string, unknown>;
  if (typeof provider !== "string" || !provider.trim() || provider.length > 256 ||
      typeof modelId !== "string" || !modelId.trim() || modelId.length > 512) {
    return Response.json({ error: "provider and modelId are required" }, { status: 400 });
  }
  return Response.json(await testModelConnection(provider, modelId, request.signal), {
    headers: { "Cache-Control": "no-store" },
  });
}
