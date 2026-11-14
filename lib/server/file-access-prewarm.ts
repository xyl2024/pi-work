import { getAllowedRoots } from "./file-access";

export function bootstrap(): void {
  void getAllowedRoots().catch(() => {});
  void import("./sessions/index-store")
    .then(({ warmSessionIndex }) => warmSessionIndex())
    .catch(() => {});
}
