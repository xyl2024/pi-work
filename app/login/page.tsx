import { I18nProvider } from "@/hooks/useI18n";
import { LoginForm } from "@/components/auth/LoginForm";

// Standalone login route. Normally the proxy redirects unauthenticated page
// visits here; authenticated visitors get bounced back to "/" by the proxy.
// After a successful login, LoginForm navigates to "/".
export default function LoginPage() {
  return (
    <I18nProvider>
      <LoginForm />
    </I18nProvider>
  );
}
