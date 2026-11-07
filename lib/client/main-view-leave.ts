import type { MainViewKind } from "@/lib/shared/mainView";
import {
  selectMainViewLeaveConfirm,
  type MainViewLeaveConfirm,
  type MainViewLeaveIntent,
} from "@/lib/shared/main-view-leave";

export interface MainViewLeaveGuard {
  dirty(): boolean;
  changes?(): number;
  discard(): void;
}

export interface MainViewLeaveRequest {
  view: MainViewKind;
  intent: MainViewLeaveIntent;
}

export type MainViewLeaveConfirmFn = (confirm: MainViewLeaveConfirm) => boolean | Promise<boolean>;

const guardByKind = new Map<MainViewKind, MainViewLeaveGuard>();
let confirmFn: MainViewLeaveConfirmFn | null = null;

export function registerMainViewLeaveGuard(kind: MainViewKind, guard: MainViewLeaveGuard): void {
  guardByKind.set(kind, guard);
}

export function setMainViewLeaveConfirm(confirm: MainViewLeaveConfirmFn | null): void {
  confirmFn = confirm;
}

export async function requestMainViewLeave(request: MainViewLeaveRequest): Promise<boolean> {
  const guard = guardByKind.get(request.view);
  const confirm = selectMainViewLeaveConfirm({
    intent: request.intent,
    dirty: guard?.dirty() ?? false,
    changeCount: guard?.changes?.() ?? 0,
  });
  if (confirm) {
    if (!confirmFn) return false;
    if (!(await confirmFn(confirm))) return false;
  }
  if (confirm) guard?.discard();
  return true;
}
