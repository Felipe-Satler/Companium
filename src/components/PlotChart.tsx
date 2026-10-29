import {
    ResponsiveContainer, ComposedChart, Bar, LineChart, Line, PieChart, Pie, Cell, XAxis,
    YAxis, CartesianGrid, Tooltip, Legend, LabelList
} from 'recharts';

// pt-BR number formatting for the value labels drawn on the chart.
const fmtNum = (v: unknown) =>
    typeof v === 'number' && Number.isFinite(v)
        ? v.toLocaleString('pt-BR', { maximumFractionDigits: 2 })
        : String(v ?? '');

type Series = { name?: string; data: number[] };
export type PlotSpec = {
    type: "bar" | "line" | "pie";
    x: string[];
    series: Series[];
    title?: string;
    // Bar-only options (all single-axis, backward-compatible):
    stacked?: boolean;                        // stack series per category
    orientation?: "vertical" | "horizontal";  // horizontal = ranking / long labels
    trend?: boolean;                          // overlay a linear trend of the totals
};

const COLORS = ["#2563eb", "#16a34a", "#ea580c", "#9333ea", "#0891b2", "#dc2626", "#ca8a04", "#4f46e5"];

// Theme-aware tooltip. The default is a white box whose label text inherits the
// modal's foreground color — light-on-white (invisible) in dark theme. Giving it a
// card background + explicit label color fixes that in both themes; item values keep
// their per-series colors. Matches the pattern used across the other charts.
const TOOLTIP_PROPS = {
  contentStyle: {
    backgroundColor: "hsl(var(--card))",
    border: "1px solid hsl(var(--border))",
    borderRadius: 8,
    fontSize: 12,
  },
  labelStyle: { color: "hsl(var(--foreground))" },
} as const;


export function PlotChart({ spec, height = 300 }: { spec: PlotSpec; height?: number }) {
    const x = Array.isArray(spec?.x) ? spec.x.map(String) : [];
    const series = Array.isArray(spec?.series) ? spec.series : [];
    if (!x.length || !series.length) {
        return <p className="text-sm text-muted-foreground">Gráfico indisponível</p>;
    }

    // Pie: use the first series, slices are the values, labels are x.
    // Zeroed metrics have no slice to attach a label to, so their labels overlap
    // at the center — we pull them out into a side list instead. No <Legend>:
    // each slice's label already names it.
    if (spec.type === "pie") {
        const all = x.map((label, i) => ({ name: label, value: Number(series[0].data?.[i] ?? 0) }));
        const data = all.filter(d => d.value > 0);
        const zeros = all.filter(d => d.value <= 0);
        // Keep colors aligned with the original x order so a slice's hue is stable.
        const colorOf = (name: string) => COLORS[all.findIndex(d => d.name === name) % COLORS.length];
        const pieH = Math.max(height, 340); // taller block so labels have room

        // Auto-fit slice label: name over value (two lines shrink the horizontal
        // reach), colored by slice, and clamped to the room left to the container
        // edge so it never clips. The pie is centered, so cx*2 ≈ its own width;
        // the full text stays available on hover via <title>.
        const renderLabel = (p: {
            cx: number; cy: number; midAngle: number; outerRadius: number;
            name: string; value: number;
        }) => {
            const RAD = Math.PI / 180;
            const { cx, cy, midAngle, outerRadius, name, value } = p;
            const r = outerRadius + 10;
            const lx = cx + r * Math.cos(-midAngle * RAD);
            const ly = cy + r * Math.sin(-midAngle * RAD);
            const right = lx >= cx;
            const room = (right ? cx * 2 - lx : lx) - 8;      // px to the near edge
            const maxChars = Math.max(3, Math.floor(room / 6.6));
            let nameLine = String(name);
            if (nameLine.length > maxChars) nameLine = nameLine.slice(0, Math.max(1, maxChars - 1)) + '…';
            return (
                <text x={lx} y={ly} textAnchor={right ? 'start' : 'end'}
                    fill={colorOf(name)} fontSize={12} dominantBaseline="central">
                    <title>{`${name}: ${fmtNum(value)}`}</title>
                    <tspan x={lx} dy="-0.35em" fontWeight={600}>{nameLine}</tspan>
                    <tspan x={lx} dy="1.15em" fillOpacity={0.75}>{fmtNum(value)}</tspan>
                </text>
            );
        };

        return (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, height: pieH }}>
                <div style={{ flex: 1, minWidth: 0, height: '100%' }}>
                    <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                            <Pie data={data} dataKey="value" nameKey="name" outerRadius="62%"
                                labelLine={false} label={renderLabel} isAnimationActive={false}>
                                {data.map((d, i) => <Cell key={i} fill={colorOf(d.name)} />)}
                            </Pie>
                            <Tooltip {...TOOLTIP_PROPS} />
                        </PieChart>
                    </ResponsiveContainer>
                </div>
                {zeros.length > 0 && (
                    <ul style={{
                        flex: '0 0 auto', maxWidth: '35%', margin: 0, padding: 0,
                        listStyle: 'none', fontSize: 11, color: 'currentColor',
                        maxHeight: '100%', overflowY: 'auto',
                    }}>
                        {zeros.map((d, i) => (
                            <li key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, lineHeight: 1.6, whiteSpace: 'nowrap' }}>
                                <span style={{ flex: '0 0 auto', width: 8, height: 8, borderRadius: '50%', background: colorOf(d.name) }} />
                                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{d.name}: {fmtNum(d.value)}</span>
                            </li>
                        ))}
                    </ul>
                )}
            </div>
        )
    }

    // Bar / Line: one row per x category, one key per series.
  const keys = series.map((s, i) => s.name || `Série ${i + 1}`);
  const horizontal = spec.type === "bar" && spec.orientation === "horizontal";
  const stacked = spec.type === "bar" && !!spec.stacked;
  const showTrend = spec.type === "bar" && !!spec.trend && !horizontal;

  const data = x.map((label, i) => {
    const row: Record<string, string | number> = { x: label };
    series.forEach((s, si) => { row[keys[si]] = Number(s.data?.[i] ?? 0); });
    return row;
  });

  // Linear-regression trend of the per-category totals (single-axis annotation).
  if (showTrend && x.length > 1) {
    const totals = x.map((_, i) => series.reduce((a, s) => a + Number(s.data?.[i] ?? 0), 0));
    const nT = totals.length;
    let sx = 0, sy = 0, sxy = 0, sxx = 0;
    for (let i = 0; i < nT; i++) { sx += i; sy += totals[i]; sxy += i * totals[i]; sxx += i * i; }
    const denom = nT * sxx - sx * sx;
    const slope = denom === 0 ? 0 : (nT * sxy - sx * sy) / denom;
    const intercept = (sy - slope * sx) / nT;
    data.forEach((row, i) => { row.__trend = intercept + slope * i; });
  }

  if (spec.type === "line") {
    return (
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="x" tick={{ fontSize: 12 }} />
          <YAxis tick={{ fontSize: 12 }} />
          <Tooltip {...TOOLTIP_PROPS} />
          <Legend />
          {keys.map((k, i) => (
            <Line key={k} dataKey={k} stroke={COLORS[i % COLORS.length]} strokeWidth={2} dot>
              <LabelList dataKey={k} position="top" formatter={fmtNum}
                style={{ fill: 'currentColor', fontSize: 11 }} />
            </Line>
          ))}
        </LineChart>
      </ResponsiveContainer>
    );
  }

  // Bar: grouped/stacked, vertical/horizontal, optional trend — via ComposedChart.
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} layout={horizontal ? "vertical" : "horizontal"}
        margin={{ top: 8, right: showTrend ? 64 : 8, left: showTrend ? 8 : 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" />
        {horizontal ? (
          <>
            <XAxis type="number" tick={{ fontSize: 12 }} />
            <YAxis type="category" dataKey="x" tick={{ fontSize: 12 }} width={110} />
          </>
        ) : (
          <>
            <XAxis dataKey="x" tick={{ fontSize: 12 }} />
            <YAxis tick={{ fontSize: 12 }} />
          </>
        )}
        <Tooltip {...TOOLTIP_PROPS} />
        <Legend />
        {keys.map((k, i) => (
          <Bar key={k} dataKey={k} fill={COLORS[i % COLORS.length]} stackId={stacked ? "stack" : undefined}>
            {!stacked && (
              <LabelList dataKey={k} position={horizontal ? "right" : "top"} formatter={fmtNum}
                style={{ fill: 'currentColor', fontSize: 11 }} />
            )}
          </Bar>
        ))}
        {showTrend && (
          <Line dataKey="__trend" name="Tendência" stroke="#64748b" strokeWidth={2}
            strokeDasharray="5 4" dot={false} legendType="plainline">
            {/* Value only at the endpoints. Bar value labels are centered above each
                bar, so we push the trend value sideways past that label's width into
                the empty flank beside the end bar — it can never land on a bar label. */}
            <LabelList dataKey="__trend" content={(p: { x?: number; y?: number; index?: number; value?: number }) => {
              const { x, y, index, value } = p;
              if (x == null || y == null || value == null || index == null) return null;
              const last = data.length - 1;
              if (index !== 0 && index !== last) return null;
              const left = index === 0;
              const rowVals = keys.map(k => Number(data[index][k]) || 0);   // bar values here
              const barLabelW = Math.max(...rowVals.map(v => fmtNum(v).length)) * 6;
              const tx = left ? x - barLabelW / 2 - 8 : x + barLabelW / 2 + 8;
              return (
                <text x={tx} y={y} dy={-2} textAnchor={left ? 'end' : 'start'}
                  fill="currentColor" fillOpacity={0.85} fontSize={11} fontWeight={600}>{fmtNum(value)}</text>
              );
            }} />
          </Line>
        )}
      </ComposedChart>
    </ResponsiveContainer>
  );
}