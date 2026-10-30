import { NextRequest } from "next/server";
import { handleFilesGet } from "@/lib/server/files";

export function GET(request: NextRequest) {
  return handleFilesGet(request, []);
}
