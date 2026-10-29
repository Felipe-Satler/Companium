import { Lightbulb, TrendingUp, BarChart3, Hash, PieChart, FileText, AlertTriangle } from "lucide-react";
import { Card } from "@/components/ui/card";

export function SocialInsights() {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Lightbulb className="h-4 w-4 text-yellow-600 dark:text-yellow-400" />
        <span className="text-sm font-bold text-foreground">Insights de Conteúdo</span>
        <span className="px-2 py-0.5 rounded text-[9px] font-medium bg-primary text-primary-foreground">Gerado via Inteligência Artificial</span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Card className="p-4 neu-card space-y-2">
          <div className="flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-primary" />
            <span className="text-xs font-bold text-foreground">Conta Destaque</span>
          </div>
          <p className="text-[10px] text-muted-foreground">O Rafael Mendonça lidera em engajamento por conteúdo</p>
          <p className="text-xl font-bold text-primary">+170% <span className="text-xs font-normal text-muted-foreground">vs. média das demais</span></p>
        </Card>

        <Card className="p-4 neu-card space-y-2">
          <div className="flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-cyan-600 dark:text-cyan-400" />
            <span className="text-xs font-bold text-foreground">Taxa de Engajamento ⓘ</span>
          </div>
          <p className="text-[10px] text-muted-foreground">Engajamento médio sobre alcance obtido no período</p>
          <p className="text-xl font-bold text-foreground">7.0% <span className="text-xs font-normal text-muted-foreground">(Excelente)</span></p>
        </Card>

        <Card className="p-4 neu-card space-y-2">
          <div className="flex items-center gap-2">
            <Hash className="h-4 w-4 text-purple-600 dark:text-purple-400" />
            <span className="text-xs font-bold text-foreground">Palavras-chave de Sucesso</span>
          </div>
          <p className="text-[10px] text-muted-foreground">Termos mais presentes em posts de maior impacto</p>
          <div className="flex flex-wrap gap-1 mt-1">
            {["graça", "tudo", "jogo", "inteligência", "artifícios"].map((w) => (
              <span key={w} className="px-2 py-0.5 rounded bg-secondary text-[10px] text-foreground">{w}</span>
            ))}
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Card className="p-4 neu-card space-y-2">
          <div className="flex items-center gap-2">
            <PieChart className="h-4 w-4 text-pink-600 dark:text-pink-400" />
            <span className="text-xs font-bold text-foreground">Mix de Conteúdo</span>
          </div>
          <p className="text-[10px] text-muted-foreground">Distribuição da frequência entre os seus formatos</p>
          <div className="space-y-1.5 mt-2">
            {[
              { label: "Carrossel", pct: 51, color: "bg-primary" },
              { label: "Imagens", pct: 12, color: "bg-pink-500" },
              { label: "Vídeo", pct: 37, color: "bg-purple-500" },
            ].map((m) => (
              <div key={m.label} className="flex items-center gap-2">
                <div className="w-24 h-1.5 rounded-full bg-secondary overflow-hidden">
                  <div className={`h-full rounded-full ${m.color}`} style={{ width: `${m.pct}%` }} />
                </div>
                <span className="text-[10px] text-muted-foreground">{m.label} {m.pct}%</span>
              </div>
            ))}
          </div>
        </Card>

        <Card className="p-4 neu-card space-y-2">
          <div className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-cyan-600 dark:text-cyan-400" />
            <span className="text-xs font-bold text-foreground">Volume Analisado</span>
          </div>
          <p className="text-[10px] text-muted-foreground">Total de posts analisados no período</p>
          <p className="text-xl font-bold text-foreground">795 <span className="text-xs font-normal text-muted-foreground">posts</span></p>
        </Card>
      </div>

      {/* Recomendação */}
      <div className="p-4 rounded-xl bg-purple-500/10 border border-purple-500/20">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-purple-600 dark:text-purple-400" />
          <span className="text-xs font-bold text-purple-700 dark:text-purple-300">Recomendação</span>
        </div>
        <p className="text-[10px] text-muted-foreground mt-1">
          Mantenha um mix equilibrado de formatos e monitore quais ressoam melhor com sua audiência. Teste diferentes tipos de conteúdo para identificar padrões.
        </p>
      </div>
    </div>
  );
}
