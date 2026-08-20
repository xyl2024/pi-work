import { Suspense } from "react";
import { AppShell } from "@/components/app-shell/AppShell";
import { I18nProvider } from "@/hooks/useI18n";
import { ToastProvider } from "@/components/ui/Toast";
import { ConfirmProvider } from "@/components/ui/ConfirmDialog";
import { ContextMenuProvider } from "@/components/ui/ContextMenu";
import { TodoProvider } from "@/hooks/useTodos";
import { PermissionProvider } from "@/hooks/usePendingPermissions";

export default function Home() {
  return (
    <Suspense>
      <I18nProvider>
        <ToastProvider>
          <ConfirmProvider>
            <PermissionProvider>
              <ContextMenuProvider>
                <TodoProvider>
                  <AppShell />
                </TodoProvider>
              </ContextMenuProvider>
            </PermissionProvider>
          </ConfirmProvider>
        </ToastProvider>
      </I18nProvider>
    </Suspense>
  );
}
