import { I18nProvider } from "@/hooks/useI18n";
import { LoginForm } from "@/components/auth/LoginForm";

export default function LoginPage() {
  return (
    <I18nProvider>
      <LoginForm />
    </I18nProvider>
  );
}
