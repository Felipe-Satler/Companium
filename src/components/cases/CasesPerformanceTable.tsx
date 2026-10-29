import { useState } from "react";
import { Users, BarChart3, TrendingUp, Eye, Target } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const csmData = [
  { rank: 1, name: "Bruna Matos Barreira", email: "bruna.barboza@viverdei...", meta: 32, emAnalise: 0, pontos: 14, pctMeta: 42 },
  { rank: 2, name: "Joana Siqueira", email: "joana@perfil.exemplo", meta: 32, emAnalise: 0, pontos: 12, pctMeta: 38 },
  { rank: 3, name: "Carlos Mendes", email: "carlos@perfil.exemplo", meta: 28, emAnalise: 2, pontos: 10, pctMeta: 36 },
  { rank: 4, name: "Mariana Costa", email: "mariana@perfil.exemplo", meta: 30, emAnalise: 1, pontos: 8, pctMeta: 27 },
  { rank: 5, name: "Rafael Souza", email: "rafael@perfil.exemplo", meta: 26, emAnalise: 0, pontos: 6, pctMeta: 23 },
  { rank: 6, name: "Ana Paula Lima", email: "ana.paula@perfil.exemplo", meta: 24, emAnalise: 1, pontos: 4, pctMeta: 17 },
];

export function CasesPerformanceTable() {
  const [activeTab, setActiveTab] = useState<"csm" | "distribuicoes">("csm");

  return (
    <div className="space-y-4">
      {/* Tabs */}
      <div className="flex items-center gap-0.5 rounded-md border border-border bg-secondary/50 p-0.5 w-fit">
        <button
          onClick={() => setActiveTab("csm")}
          className={`flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded transition-colors ${
            activeTab === "csm" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"
          }`}
        >
          <Users className="h-3.5 w-3.5" />
          Por CSM
        </button>
        <button
          onClick={() => setActiveTab("distribuicoes")}
          className={`flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded transition-colors ${
            activeTab === "distribuicoes" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"
          }`}
        >
          <BarChart3 className="h-3.5 w-3.5" />
          Distribuições
        </button>
      </div>

      {activeTab === "csm" && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold text-foreground">Performance por CSM</h3>
          </div>

          <div className="rounded-lg border border-border/50 overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="border-border/50 hover:bg-transparent">
                  <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">CSM</TableHead>
                  <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground text-center">Meta</TableHead>
                  <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground text-center">Em Análise</TableHead>
                  <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground text-center">Pontos</TableHead>
                  <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground text-center">% Meta</TableHead>
                  <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Progresso</TableHead>
                  <TableHead className="w-8"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {csmData.map((csm) => (
                  <TableRow key={csm.rank} className="border-border/50 hover:bg-secondary/30">
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <div className="flex h-7 w-7 items-center justify-center rounded-full bg-secondary text-xs font-bold text-muted-foreground">
                          {csm.rank}
                        </div>
                        <div>
                          <p className="text-sm font-medium text-foreground">{csm.name}</p>
                          <p className="text-[11px] text-muted-foreground">{csm.email}</p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="text-center">
                      <div className="flex items-center justify-center gap-1">
                        <Target className="h-3.5 w-3.5 text-muted-foreground" />
                        <span className="text-sm font-medium text-foreground">{csm.meta}</span>
                        <Eye className="h-3 w-3 text-muted-foreground" />
                      </div>
                    </TableCell>
                    <TableCell className="text-center">
                      <div className="flex items-center justify-center gap-1">
                        <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/20 px-2 py-0.5 text-xs font-semibold text-amber-600 dark:text-amber-400">
                          ⏳ {csm.emAnalise}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="text-center">
                      <span className="text-sm font-semibold text-primary">{csm.pontos}</span>
                    </TableCell>
                    <TableCell className="text-center">
                      <span className={`text-sm font-semibold ${csm.pctMeta >= 40 ? "text-primary" : "text-amber-600 dark:text-amber-400"}`}>
                        {csm.pctMeta}%
                      </span>
                    </TableCell>
                    <TableCell>
                      <div className="w-full max-w-[120px]">
                        <div className="w-full h-2 rounded-full bg-secondary">
                          <div
                            className="h-full rounded-full bg-primary transition-all"
                            style={{ width: `${csm.pctMeta}%` }}
                          />
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <TrendingUp className="h-4 w-4 text-muted-foreground cursor-pointer hover:text-foreground transition-colors" />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      {activeTab === "distribuicoes" && (
        <div className="neu-card rounded-lg p-8 flex items-center justify-center min-h-[200px]">
          <p className="text-sm text-muted-foreground">Distribuições — Em breve</p>
        </div>
      )}
    </div>
  );
}
