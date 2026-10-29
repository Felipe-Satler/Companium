import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { z } from "zod";
import { supabase } from "@/integrations/external-supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import logo from "@/assets/logo.png";
import logoLight from "@/assets/logo-light.png";
import { useTheme } from "@/contexts/ThemeContext";

const schema = z.object({
  password: z.string().min(8, "Senha deve ter ao menos 8 caracteres").max(72),
});

export default function ResetPassword() {
  const navigate = useNavigate();
  const { theme } = useTheme();
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [ready, setReady] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    document.title = "Redefinir senha | Companium";

    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY" || event === "SIGNED_IN") setReady(true);
    });

    (async () => {
      // Formato novo: ?code=... (PKCE) — precisa trocar por sessão
      const url = new URL(window.location.href);
      const code = url.searchParams.get("code");
      const errorDescription =
        url.searchParams.get("error_description") ||
        new URLSearchParams(window.location.hash.slice(1)).get("error_description");

      if (errorDescription) {
        setErrorMsg(decodeURIComponent(errorDescription));
        return;
      }

      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        if (error) {
          setErrorMsg(error.message);
        } else {
          setReady(true);
          // Limpa o code da URL
          window.history.replaceState({}, "", "/reset-password");
        }
        return;
      }

      // Formato antigo (#access_token=...) — getSession já estará preenchida
      const { data } = await supabase.auth.getSession();
      if (data.session) setReady(true);
    })();

    return () => sub.subscription.unsubscribe();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = schema.safeParse({ password });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0].message);
      return;
    }
    setSubmitting(true);
    const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
    setSubmitting(false);
    if (error) {
      toast.error(error.message);
    } else {
      toast.success("Senha atualizada!");
      await supabase.auth.signOut();
      navigate("/auth", { replace: true });
    }
  };

  return (
    <main className="min-h-screen flex items-center justify-center bg-ambient bg-noise p-4">
      <Card className="neu-card w-full max-w-md p-8 space-y-6 border-0 bg-transparent shadow-none">
        <header className="flex flex-col items-center gap-3 text-center">
          <img src={theme === "dark" ? logo : logoLight} alt="Companium" className="h-12 w-auto object-contain" />
          <h1 className="text-lg font-semibold text-foreground">Redefinir senha</h1>
        </header>

        {errorMsg ? (
          <div className="space-y-3 text-center">
            <p className="text-sm text-destructive">{errorMsg}</p>
            <Button
              variant="outline"
              className="w-full h-11"
              onClick={() => navigate("/auth", { replace: true })}
            >
              Voltar para o login
            </Button>
          </div>
        ) : !ready ? (
          <p className="text-sm text-muted-foreground text-center">
            Abra esta página pelo link enviado no seu e-mail para redefinir a senha.
          </p>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="password">Nova senha</Label>
              <Input
                id="password"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="neu-inset border-0 bg-transparent"
              />
            </div>
            <Button type="submit" className="neu-button-primary w-full h-11 text-base" disabled={submitting}>
              {submitting ? "Salvando..." : "Salvar nova senha"}
            </Button>
          </form>
        )}
      </Card>
    </main>
  );
}
