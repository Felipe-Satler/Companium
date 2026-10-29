import { useEffect, useRef, useState } from "react";
import { ImagePlus, Loader2, Sparkles, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useToken } from "@/hooks/useArtes";
import { enviarFotoDaArte, type FotoDaArte, type TipoDeFoto } from "@/lib/artesApi";
import {
  ELEMENTOS_DA_ARTE,
  MAX_BYTES_IMAGEM,
  MIMES_DE_IMAGEM,
  TIPOS_DE_FOTO,
  kitTemElemento,
  type BrandKit,
  type ElementoDaArteId,
} from "../../../../shared/brand-kit";
import {
  escolhasPermitidas,
  exigenciaDeIdentificacao,
  type OndeIdentificar,
  type UsoDaArte,
} from "../../../../shared/regras-identificacao";

/**
 * A pré-etapa de uma arte nova: o que entra nela.
 *
 * Uso (orgânico ou pago), se vai circular fora do Instagram, onde a identificação do médico entra
 * (a regra do CFM trava as opções que não pode), a chave "incluir / não incluir" de cada elemento do
 * Brand kit e as fotos reais. Nada aqui é gerado por IA: foto é sempre a que a equipe envia.
 */

const MAX_FOTOS_ENVIADAS = 9;

const ROTULO_ONDE: Record<OndeIdentificar, string> = {
  arte: "Na arte",
  legenda: "Na legenda",
  nenhum: "Não incluir",
};

export type OpcoesDaPreEtapa = {
  uso: UsoDaArte;
  circula_fora: boolean;
  onde_identificar: OndeIdentificar;
  elementos: Partial<Record<ElementoDaArteId, boolean>>;
  fotos: FotoDaArte[];
};

type FotoEnviada = FotoDaArte & { previa: string };

export function PreEtapaArte({
  kit,
  cliente,
  formato,
  enviando,
  onGerar,
}: {
  kit: BrandKit;
  cliente: string;
  formato: string;
  enviando: boolean;
  onGerar: (opcoes: OpcoesDaPreEtapa) => void;
}) {
  const token = useToken();
  const [uso, setUso] = useState<UsoDaArte>(formato === "meta_ads" ? "pago" : "organico");
  const [circulaFora, setCirculaFora] = useState(false);
  const [onde, setOnde] = useState<OndeIdentificar>("arte");
  // Liga por padrão o que o kit tem e costuma ir numa arte; contato e endereço ficam para a pessoa.
  const [elementos, setElementos] = useState<Partial<Record<ElementoDaArteId, boolean>>>(() => ({
    logo: kitTemElemento(kit, "logo"),
    nome_clinica: !kitTemElemento(kit, "logo") && kitTemElemento(kit, "nome_clinica"),
  }));
  const [fotos, setFotos] = useState<FotoEnviada[]>([]);
  const [subindo, setSubindo] = useState(false);
  const entrada = useRef<HTMLInputElement>(null);

  const { exigencia, motivo } = exigenciaDeIdentificacao({ uso, circulaFora, bioConferida: kit.bio_conferida });
  const permitidas = escolhasPermitidas(exigencia);
  // A escolha anterior pode ter ficado proibida (marcou "pago" depois de "não incluir").
  useEffect(() => {
    if (!permitidas.includes(onde)) setOnde(permitidas[0]);
  }, [permitidas, onde]);

  const enviar = async (lista: FileList | null) => {
    if (!lista?.length) return;
    const arquivos = Array.from(lista).slice(0, Math.max(0, MAX_FOTOS_ENVIADAS - fotos.length));
    setSubindo(true);
    try {
      for (const arquivo of arquivos) {
        if (!MIMES_DE_IMAGEM.includes(arquivo.type) || arquivo.size > MAX_BYTES_IMAGEM) {
          toast.error(`"${arquivo.name}" não é PNG, JPEG ou WebP de até 8 MB.`);
          continue;
        }
        const { caminho } = await enviarFotoDaArte(token, cliente, arquivo);
        setFotos((f) => [...f, { caminho, tipo: "procedimento", descricao: "", previa: URL.createObjectURL(arquivo) }]);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não foi possível enviar a foto.");
    } finally {
      setSubindo(false);
      if (entrada.current) entrada.current.value = "";
    }
  };

  return (
    <div className="space-y-4 rounded-lg border border-border p-4">
      <div>
        <h3 className="text-sm font-semibold">Antes de gerar</h3>
        <p className="text-xs text-muted-foreground">
          O que entra nesta arte. Os dados vêm do Brand kit do cliente; o que não estiver cadastrado lá fica
          desligado.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label className="text-xs">Uso</Label>
          <RadioGroup value={uso} onValueChange={(v) => setUso(v as UsoDaArte)} className="flex gap-4">
            <label className="flex items-center gap-1.5 text-xs">
              <RadioGroupItem value="organico" /> Orgânico (feed)
            </label>
            <label className="flex items-center gap-1.5 text-xs">
              <RadioGroupItem value="pago" /> Pago (anúncio)
            </label>
          </RadioGroup>
          <label className="flex items-center gap-2 text-xs">
            <Checkbox checked={circulaFora} onCheckedChange={(v) => setCirculaFora(v === true)} />
            Vai circular fora do Instagram (WhatsApp, Telegram)
          </label>
        </div>

        <div className="space-y-2">
          <Label className="text-xs">Nome, CRM e RQE do médico</Label>
          <RadioGroup value={onde} onValueChange={(v) => setOnde(v as OndeIdentificar)} className="flex flex-wrap gap-4">
            {(["arte", "legenda", "nenhum"] as const).map((o) => (
              <label key={o} className={`flex items-center gap-1.5 text-xs ${permitidas.includes(o) ? "" : "opacity-40"}`}>
                <RadioGroupItem value={o} disabled={!permitidas.includes(o)} /> {ROTULO_ONDE[o]}
              </label>
            ))}
          </RadioGroup>
          <p className="text-[11px] text-muted-foreground">{motivo}</p>
        </div>
      </div>

      <div className="space-y-2">
        <Label className="text-xs">Elementos do Brand kit</Label>
        <div className="grid gap-2 sm:grid-cols-3">
          {ELEMENTOS_DA_ARTE.filter((e) => e.id !== "identificacao").map((e) => {
            const tem = kitTemElemento(kit, e.id);
            return (
              <label key={e.id} className={`flex items-center justify-between gap-2 rounded-md border border-border px-2.5 py-1.5 text-xs ${tem ? "" : "opacity-50"}`}>
                <span>
                  {e.label}
                  {!tem && <span className="block text-[10px] text-muted-foreground">não cadastrado</span>}
                </span>
                <Switch
                  checked={Boolean(elementos[e.id]) && tem}
                  disabled={!tem}
                  onCheckedChange={(v) => setElementos((x) => ({ ...x, [e.id]: v }))}
                  aria-label={`Incluir ${e.label}`}
                />
              </label>
            );
          })}
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-xs">Fotos</Label>
          <input
            ref={entrada}
            type="file"
            multiple
            accept={MIMES_DE_IMAGEM.join(",")}
            className="hidden"
            onChange={(e) => enviar(e.target.files)}
            aria-label="Enviar fotos"
          />
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-[11px]"
            disabled={subindo || fotos.length >= MAX_FOTOS_ENVIADAS}
            onClick={() => entrada.current?.click()}
          >
            {subindo ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <ImagePlus className="mr-1 h-3 w-3" />}
            Enviar fotos
          </Button>
        </div>
        <p className="text-[11px] text-muted-foreground">
          Só fotos reais — de procedimento, da estrutura, da equipe. Antes/depois e resultado de paciente não entram, e
          nenhuma imagem é gerada por IA. A foto do médico vem do Brand kit, pela chave acima.
        </p>
        {fotos.length > 0 && (
          <div className="grid gap-2 sm:grid-cols-3">
            {fotos.map((f, i) => (
              <div key={f.caminho} className="space-y-1.5 rounded-md border border-border p-2">
                <img src={f.previa} alt="" className="h-24 w-full rounded object-cover" />
                <div className="flex gap-1.5">
                  <Select
                    value={f.tipo}
                    onValueChange={(v) => setFotos((l) => l.map((x, j) => (j === i ? { ...x, tipo: v as TipoDeFoto } : x)))}
                  >
                    <SelectTrigger className="h-7 text-[11px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TIPOS_DE_FOTO.map((t) => (
                        <SelectItem key={t.id} value={t.id} className="text-xs">
                          {t.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 shrink-0"
                    onClick={() => setFotos((l) => l.filter((_, j) => j !== i))}
                    aria-label="Tirar a foto"
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
                <Input
                  value={f.descricao}
                  placeholder="O que aparece (ajuda o agente a escolher a página)"
                  onChange={(e) => setFotos((l) => l.map((x, j) => (j === i ? { ...x, descricao: e.target.value } : x)))}
                  className="h-7 text-[11px]"
                />
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex justify-end">
        <Button
          size="sm"
          disabled={enviando || subindo}
          onClick={() =>
            onGerar({
              uso,
              circula_fora: circulaFora,
              onde_identificar: onde,
              elementos,
              fotos: fotos.map(({ caminho, tipo, descricao }) => ({ caminho, tipo, descricao })),
            })
          }
        >
          {enviando ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-1.5 h-3.5 w-3.5" />}
          Gerar arte
        </Button>
      </div>
    </div>
  );
}

