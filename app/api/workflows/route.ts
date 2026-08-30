/**
 * /api/workflows — CRUD on workflows (with their node lists).
 *
 * Mirrors app/api/scheduled-tasks/route.ts: single route file with GET,
 * POST, PATCH, DELETE. Each mutation calls `rescheduleWorkflowLoop()` so a
 * new/edited cron workflow is picked up without waiting for the timer.
 * PATCH/DELETE use the body id / query id, matching the scheduler API.
 */
import { NextResponse } from "next/server";
import { createLogger, elapsedMs } from "@/lib/server/logger";
import {
  createWorkflow,
  deleteWorkflow,
  listWorkflows,
  updateWorkflow,
  WorkflowNotFoundError,
  WorkflowValidationError,
} from "@/lib/server/workflow/store";
import { rescheduleWorkflowLoop } from "@/lib/server/workflow/trigger";
import type {
  WorkflowCreateInput,
  WorkflowUpdateInput,
} from "@/lib/shared/workflow";

const log = createLogger("api/workflows");

export async function GET() {
  const startedAt = Date.now();
  try {
    const workflows = listWorkflows();
    log.info("workflows listed", { count: workflows.length, durationMs: elapsedMs(startedAt) });
    return NextResponse.json({ workflows });
  } catch (error) {
    log.error("workflows list failed", { error, durationMs: elapsedMs(startedAt) });
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

/** Read payload as a WorkflowCreateInput (loose) and create. */
export async function POST(req: Request) {
  const startedAt = Date.now();
  try {
    const body = (await req.json()) as WorkflowCreateInput;
    const workflow = createWorkflow(body);
    rescheduleWorkflowLoop();
    log.info("workflow created via api", { id: workflow.id, durationMs: elapsedMs(startedAt) });
    return NextResponse.json({ workflow });
  } catch (error) {
    if (error instanceof WorkflowValidationError) {
      return NextResponse.json({ error: error.message, field: error.field }, { status: 400 });
    }
    log.error("workflow create failed", { error, durationMs: elapsedMs(startedAt) });
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  const startedAt = Date.now();
  try {
    const body = (await req.json()) as WorkflowUpdateInput;
    if (!body.id || typeof body.id !== "string") {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }
    const workflow = updateWorkflow(body);
    rescheduleWorkflowLoop();
    log.info("workflow updated via api", { id: body.id, durationMs: elapsedMs(startedAt) });
    return NextResponse.json({ workflow });
  } catch (error) {
    if (error instanceof WorkflowValidationError) {
      return NextResponse.json({ error: error.message, field: error.field }, { status: 400 });
    }
    if (error instanceof WorkflowNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    log.error("workflow update failed", { error, durationMs: elapsedMs(startedAt) });
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  const startedAt = Date.now();
  try {
    const url = new URL(req.url);
    const id = url.searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "id query param is required" }, { status: 400 });
    }
    deleteWorkflow(id);
    rescheduleWorkflowLoop();
    log.info("workflow deleted via api", { id, durationMs: elapsedMs(startedAt) });
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof WorkflowNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    log.error("workflow delete failed", { error, durationMs: elapsedMs(startedAt) });
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}