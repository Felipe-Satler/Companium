import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

const fases = ["Proposta", "Negociação", "Qualificação", "Fechamento", "Contrato", "Follow-up", "Lead"];
const faseColors: Record<string, string> = {
  "Proposta": "bg-yellow-500/20 text-yellow-600 dark:text-yellow-400",
  "Negociação": "bg-orange-500/20 text-orange-600 dark:text-orange-400",
  "Qualificação": "bg-blue-500/20 text-blue-600 dark:text-blue-400",
  "Fechamento": "bg-green-500/20 text-green-600 dark:text-green-400",
  "Contrato": "bg-purple-500/20 text-purple-600 dark:text-purple-400",
  "Follow-up": "bg-cyan-500/20 text-cyan-600 dark:text-cyan-400",
  "Lead": "bg-gray-500/20 text-gray-600 dark:text-gray-400",
};

const vendedores = [
  "João Silva", "Maria Santos", "Carlos Oliveira", "Ana Souza", "Pedro Lima",
  "Fernanda Alves", "Bruno Costa", "Luciana Pereira", "André Rodrigues", "Camila Ferreira",
];

const clientes = [
  "Empresa ABC Ltda", "Tech Solutions S.A.", "Global Commerce", "DataBR Corp",
  "Inova Sistemas", "Prime Logistics", "Smart Retail", "CloudNet Telecom",
  "Agro Digital", "Startup Hub", "Fintech Pay", "Saúde Connect",
  "EduTech Brasil", "Construtora Viva", "Auto Parts BR", "Green Energy Co",
  "Food Express", "Travel Corp", "Media Group", "Sports Analytics",
  "Banco Digital Plus", "InsurTech BR", "Pharma Solutions", "Real Estate Pro",
  "Marketplace One", "Logística Express", "Pet Care Plus", "Fashion Store",
  "Cyber Security BR", "IoT Solutions", "E-commerce Pro", "Delivery Fast",
  "Health Monitor", "Robo Invest", "Social Media Inc", "Game Studio BR",
  "Solar Energy", "Water Tech", "Air Quality", "Smart City Co",
];

const produtos = ["Enterprise", "Pro", "Business", "Starter", "Add-on", "Consultoria", "Premium"];

function randomDate() {
  const d = new Date(2025, Math.floor(Math.random() * 3) + 9, Math.floor(Math.random() * 28) + 1);
  return d.toLocaleDateString("pt-BR");
}

const deals = Array.from({ length: 50 }, (_, i) => {
  const prob = Math.round(Math.random() * 100);
  const valor = Math.round(5000 + Math.random() * 120000);
  return {
    id: i + 1,
    data: randomDate(),
    cliente: clientes[i % clientes.length],
    vendedor: vendedores[i % vendedores.length],
    produto: produtos[i % produtos.length],
    fase: fases[i % fases.length],
    probabilidade: prob,
    valor,
    prev: Math.round(valor * (prob / 100)),
    pace: `${(Math.random() * 3 + 0.5).toFixed(1)}x`,
  };
});

interface Props { loading: boolean }

export function ForecastDealsTable({ loading }: Props) {
  if (loading) return <div className="h-96 rounded-xl skeleton-loading" />;

  return (
    <Card className="neu-card p-5">
      <div className="mb-4">
        <h3 className="text-sm font-medium text-foreground">Detalhamento de Deals / Forecast</h3>
      </div>
      <div className="overflow-auto max-h-[500px] rounded-md border border-border">
        <Table>
          <TableHeader>
            <TableRow className="bg-secondary/30 hover:bg-secondary/30">
              <TableHead className="text-[10px] font-semibold uppercase text-muted-foreground">Data</TableHead>
              <TableHead className="text-[10px] font-semibold uppercase text-muted-foreground">Cliente / Lead</TableHead>
              <TableHead className="text-[10px] font-semibold uppercase text-muted-foreground">Vendedor</TableHead>
              <TableHead className="text-[10px] font-semibold uppercase text-muted-foreground">Produto</TableHead>
              <TableHead className="text-[10px] font-semibold uppercase text-muted-foreground">Fase</TableHead>
              <TableHead className="text-[10px] font-semibold uppercase text-muted-foreground text-right">Probabilidade</TableHead>
              <TableHead className="text-[10px] font-semibold uppercase text-muted-foreground text-right">Valor</TableHead>
              <TableHead className="text-[10px] font-semibold uppercase text-muted-foreground text-right">Prev.</TableHead>
              <TableHead className="text-[10px] font-semibold uppercase text-muted-foreground text-right">PACE</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {deals.map((deal) => (
              <TableRow key={deal.id} className="border-border/50 hover:bg-secondary/20">
                <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{deal.data}</TableCell>
                <TableCell className="text-xs text-foreground font-medium max-w-[180px] truncate">{deal.cliente}</TableCell>
                <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                  <div className="flex items-center gap-1.5">
                    <div className="h-1.5 w-1.5 rounded-full bg-primary" />
                    {deal.vendedor}
                  </div>
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">{deal.produto}</TableCell>
                <TableCell>
                  <Badge variant="outline" className={`text-[10px] px-1.5 py-0 border-0 ${faseColors[deal.fase] || ""}`}>
                    {deal.fase}
                  </Badge>
                </TableCell>
                <TableCell className="text-xs text-right">
                  <div className="flex items-center justify-end gap-1.5">
                    <div className="w-12 h-1.5 rounded-full bg-secondary overflow-hidden">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${deal.probabilidade}%`,
                          backgroundColor: deal.probabilidade >= 70 ? "hsl(var(--primary))" : deal.probabilidade >= 40 ? "hsl(var(--chart-line-forecast))" : "hsl(var(--destructive))",
                        }}
                      />
                    </div>
                    <span className="text-muted-foreground w-8 text-right">{deal.probabilidade}%</span>
                  </div>
                </TableCell>
                <TableCell className="text-xs text-right text-foreground font-medium">
                  R$ {deal.valor.toLocaleString("pt-BR")}
                </TableCell>
                <TableCell className="text-xs text-right text-primary">
                  R$ {deal.prev.toLocaleString("pt-BR")}
                </TableCell>
                <TableCell className="text-xs text-right text-chart-forecast font-medium">
                  {deal.pace}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </Card>
  );
}
