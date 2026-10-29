import { useLocation } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ShieldCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/external-supabase/client";
import { AVISO_VERSAO, fraseDesempenho } from "@/lib/usage/aviso";

// Telas onde o popup não abre: login e a própria página de privacidade.
const SEM_AVISO = new Set(["/auth", "/reset-password", "/privacidade"]);

/**
 * Aviso da coleta de uso, uma vez por usuário e por versão do texto. Fechar ("Entendi" ou ✕)
 * grava em usage_notice_acks — prova de que a pessoa foi informada, e o popup não volta em outro
 * computador. A coleta em si não depende disto (decisão: legítimo interesse, segue para todos).
 */
export function AvisoUsoDialog() {
  const { user, isApproved } = useAuth();
  const { pathname } = useLocation();
  const qc = useQueryClient();
  const uid = user?.id ?? null;
  const chave = ["uso-aviso", uid, AVISO_VERSAO] as const;

  const { data: visto } = useQuery({
    queryKey: chave,
    enabled: !!uid && isApproved,
    staleTime: Infinity,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("usage_notice_acks")
        .select("version")
        .eq("user_id", uid!)
        .eq("version", AVISO_VERSAO)
        .maybeSingle();
      // Erro de leitura (tabela ainda não criada, rede): não abre — melhor que abrir sempre.
      if (error) return true;
      return !!data;
    },
  });

  const aberto = visto === false && !SEM_AVISO.has(pathname);

  const fechar = async () => {
    qc.setQueryData(chave, true);
    const { error } = await supabase.from("usage_notice_acks").insert({ user_id: uid, version: AVISO_VERSAO });
    if (error && !error.message.includes("duplicate")) console.debug("[aviso-uso] falha ao gravar:", error.message);
  };

  const desempenho = fraseDesempenho();

  return (
    <Dialog open={aberto} onOpenChange={(o) => !o && void fechar()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <div className="mb-1 flex size-10 items-center justify-center rounded-full bg-primary/10 text-primary">
            <ShieldCheck className="size-5" aria-hidden="true" />
          </div>
          <DialogTitle>Como medimos o uso do Companium</DialogTitle>
          <DialogDescription asChild>
            <div className="space-y-3 text-sm text-muted-foreground">
              <p>
                Para melhorar a plataforma, o Companium registra quais telas você acessa, por quanto tempo elas ficam
                em uso e quais botões você clica. Nos assistentes de IA, contamos o tempo de uso e quantas perguntas e
                respostas houve.
              </p>
              {desempenho && <p>{desempenho}</p>}
              <p>
                Não registramos o que você digita nos campos, nem capturamos sua tela, câmera ou teclado.
              </p>
            </div>
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" asChild>
            <a href="/privacidade" target="_blank" rel="noopener">
              Saiba mais
            </a>
          </Button>
          <Button onClick={() => void fechar()}>Entendi</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
