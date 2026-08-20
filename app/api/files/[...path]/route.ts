import { NextRequest } from "next/server";
import {
  handleFileDelete,
  handleFilePatch,
  handleFilePost,
  handleFilePut,
  handleFilesGet,
} from "@/lib/server/files";

type RouteContext = { params: Promise<{ path: string[] }> };

async function getSegments({ params }: RouteContext): Promise<string[]> {
  const { path: segments } = await params;
  return segments;
}

export async function GET(request: NextRequest, context: RouteContext) {
  return handleFilesGet(request, await getSegments(context));
}

export async function PUT(request: NextRequest, context: RouteContext) {
  return handleFilePut(request, await getSegments(context));
}

export async function POST(request: NextRequest, context: RouteContext) {
  return handleFilePost(request, await getSegments(context));
}

export async function DELETE(_request: NextRequest, context: RouteContext) {
  return handleFileDelete(await getSegments(context));
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  return handleFilePatch(request, await getSegments(context));
}
