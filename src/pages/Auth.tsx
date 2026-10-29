import { useEffect, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { z } from "zod";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Eye, EyeOff, Check, X } from "lucide-react";
import logo from "@/assets/logo.png";
import logoLight from "@/assets/logo-light.png";
import { useTheme } from "@/contexts/ThemeContext";
import { toast } from "sonner";
import { supabase } from "@/integrations/external-supabase/client";

const schema = z.object({
  email: z.string().trim().email("E-mail inválido").max(255),
  password: z.string().min(8, "Senha deve ter ao menos 8 caracteres").max(72),
});

type PasswordChecks = {
  length: boolean;
  lower: boolean;
  upper: boolean;
  number: boolean;
  symbol: boolean;
};

function evaluatePassword(pw: string): { checks: PasswordChecks; score: number } {
  const checks: PasswordChecks = {
    length: pw.length >= 8,
    lower: /[a-z]/.test(pw),
    upper: /[A-Z]/.test(pw),
    number: /\d/.test(pw),
    symbol: /[^A-Za-z0-9]/.test(pw),
  };
  const score = Object.values(checks).filter(Boolean).length;
  return { checks, score };
}

const STRENGTH_LABELS = ["Muito fraca", "Fraca", "Razoável", "Boa", "Forte", "Excelente"];
const STRENGTH_COLORS = [
  "bg-destructive",
  "bg-destructive",
  "bg-orange-500",
  "bg-yellow-500",
  "bg-primary",
  "bg-primary",
];

export default function Auth() {
  const { user, loading, signIn, signUp } = useAuth();
  const navigate = useNavigate();
  const { theme } = useTheme();
  const [tab, setTab] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const { checks: pwChecks, score: pwScore } = evaluatePassword(password);

  useEffect(() => {
    document.title = "Entrar | Companium";
  }, []);

  if (loading) return null;
  if (user) return <Navigate to="/" replace />;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = schema.safeParse({ email, password });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0].message);
      return;
    }
    setSubmitting(true);
    if (tab === "signin") {
      const { error } = await signIn(parsed.data.email, parsed.data.password);
      if (error) toast.error(error);
      else toast.success("Bem-vindo!");
    } else {
      const { error } = await signUp(parsed.data.email, parsed.data.password);
      if (error) {
        toast.error(error);
      } else {
        toast.success("Cadastro recebido. Aguarde aprovação do administrador.");
        await supabase.auth.signOut();
        setTab("signin");
      }
    }
    setSubmitting(false);
    navigate("/", { replace: false });
  };

  const handleForgotPassword = async () => {
    const emailParsed = z.string().trim().email().safeParse(email);
    if (!emailParsed.success) {
      toast.error("Digite seu e-mail no campo acima para receber o link de recuperação.");
      return;
    }
    setSubmitting(true);
    const { error } = await supabase.auth.resetPasswordForEmail(emailParsed.data, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setSubmitting(false);
    if (error) {
      toast.error(error.message);
    } else {
      toast.success(
        "Se o e-mail estiver cadastrado, você receberá o link em alguns minutos. Verifique também a caixa de spam/promoções.",
        { duration: 8000 }
      );
    }
  };

  return (
    <main className="min-h-screen flex items-center justify-center bg-ambient bg-noise p-4">
      <Card className="neu-card w-full max-w-md p-8 space-y-6 border-0 bg-transparent shadow-none">
        <header className="flex flex-col items-center gap-3 text-center">
          <img src={theme === "dark" ? logo : logoLight} alt="Companium" className="h-12 w-auto object-contain" />
          <p className="text-sm text-muted-foreground">Acesse seu painel</p>
        </header>

        <Tabs value={tab} onValueChange={(v) => setTab(v as "signin" | "signup")}>
          <div className="neu-inset relative h-11 p-1 rounded-xl">
            {/* Pill deslizante */}
            <div
              aria-hidden
              className="absolute top-1 bottom-1 left-1 w-[calc(50%-0.25rem)] rounded-lg bg-primary shadow-[0_2px_10px_hsl(156_64%_30%/0.5),inset_0_1px_0_hsl(156_70%_70%/0.55)] transition-transform duration-300 ease-[cubic-bezier(0.34,1.3,0.64,1)]"
              style={{ transform: tab === "signup" ? "translateX(100%)" : "translateX(0%)" }}
            />
            <TabsList className="relative grid w-full h-full grid-cols-2 bg-transparent p-0 gap-0">
              <TabsTrigger
                value="signin"
                className="relative z-10 h-full rounded-lg text-sm font-medium text-muted-foreground transition-colors duration-300 data-[state=active]:text-primary-foreground data-[state=active]:bg-transparent data-[state=active]:shadow-none"
              >
                Entrar
              </TabsTrigger>
              <TabsTrigger
                value="signup"
                className="relative z-10 h-full rounded-lg text-sm font-medium text-muted-foreground transition-colors duration-300 data-[state=active]:text-primary-foreground data-[state=active]:bg-transparent data-[state=active]:shadow-none"
              >
                Criar conta
              </TabsTrigger>
            </TabsList>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4 pt-6">
            <div className="space-y-2">
              <Label htmlFor="email">E-mail</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="neu-inset border-0 bg-transparent"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Senha</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete={tab === "signin" ? "current-password" : "new-password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="neu-inset border-0 bg-transparent pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {tab === "signup" && (
              <div className="space-y-2 animate-fade-in">
                <div className="flex items-center gap-2">
                  <div className="neu-inset h-2 flex-1 rounded-full overflow-hidden">
                    <div
                      className={`h-full transition-all duration-300 ${STRENGTH_COLORS[pwScore]}`}
                      style={{ width: `${(pwScore / 5) * 100}%` }}
                    />
                  </div>
                  <span className="text-xs text-muted-foreground min-w-[70px] text-right">
                    {password ? STRENGTH_LABELS[pwScore] : ""}
                  </span>
                </div>
                <ul className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                  {[
                    { ok: pwChecks.length, label: "Mínimo 8 caracteres" },
                    { ok: pwChecks.lower, label: "Letra minúscula" },
                    { ok: pwChecks.upper, label: "Letra maiúscula" },
                    { ok: pwChecks.number, label: "Número" },
                    { ok: pwChecks.symbol, label: "Símbolo" },
                  ].map((item) => (
                    <li
                      key={item.label}
                      className={`flex items-center gap-1.5 transition-colors ${
                        item.ok ? "text-primary" : "text-muted-foreground"
                      }`}
                    >
                      {item.ok ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
                      {item.label}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <TabsContent
              value="signin"
              className="m-0 p-0 space-y-3 data-[state=active]:animate-fade-in"
            >
              <button
                type="button"
                onClick={handleForgotPassword}
                disabled={submitting}
                className="block ml-auto text-xs text-muted-foreground hover:text-primary transition-colors disabled:opacity-50"
              >
                Esqueci minha senha
              </button>
              <Button type="submit" className="neu-button-primary w-full h-11 text-base" disabled={submitting}>
                {submitting ? "Entrando..." : "Entrar"}
              </Button>
            </TabsContent>
            <TabsContent
              value="signup"
              className="m-0 p-0 space-y-2 data-[state=active]:animate-fade-in"
            >
              <Button
                type="submit"
                className="neu-button-primary w-full h-11 text-base"
                disabled={submitting || pwScore < 3}
              >
                {submitting ? "Enviando..." : "Criar conta"}
              </Button>
              <p className="text-xs text-muted-foreground text-center">
                Novos cadastros precisam ser aprovados por um administrador antes do primeiro acesso.
              </p>
            </TabsContent>
          </form>
        </Tabs>
        <p className="mt-4 text-center text-[11px] text-muted-foreground">
          <a href="/privacidade" className="underline-offset-2 hover:text-foreground hover:underline">
            Privacidade e dados de uso
          </a>
        </p>
      </Card>
    </main>
  );
}
