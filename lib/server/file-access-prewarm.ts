import { getAllowedRoots } from "./file-access";

export function bootstrap(): void {
  void getAllowedRoots().catch(() => {});
}
