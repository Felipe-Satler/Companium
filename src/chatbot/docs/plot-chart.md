# `PlotChart.tsx` — the interactive chart

`src/components/PlotChart.tsx` is a single React component that renders a **plot
spec** with [Recharts](https://recharts.org). It's the on-screen twin of the
bridge's `render.js` (which draws the same spec as SVG for PDF export), so a chart
looks the same in the chat, in the Biblioteca, and in an exported PDF.

It's used in two places:

- the **chat plot modal** (`ChatbotHost.tsx`) — click a plot bubble → live chart;
- the **Biblioteca** dialog (`Biblioteca.tsx`) — open a saved plot.

Both pass the same `spec`.

---

## The spec

```ts
type Series = { name?: string; data: number[] };

export type PlotSpec = {
  type: "bar" | "line" | "pie";
  x: string[];        // category labels (X axis / pie slices)
  series: Series[];   // one entry per series; data aligns with x by index
  title?: string;
  // Bar-only options (all single-axis, backward-compatible):
  stacked?: boolean;                        // stack series per category
  orientation?: "vertical" | "horizontal";  // horizontal = ranking / long labels
  trend?: boolean;                          // overlay a linear trend of the totals
};
```

The three bar flags are **optional** — a spec written before they existed renders
exactly as before. They are validated (well, passed through) by the bridge and
stored on the plot row, so they survive a reload and a PDF export.

## Shared helpers

```ts
// pt-BR number formatting for the value labels drawn on the chart.
const fmtNum = (v: unknown) =>
  typeof v === 'number' && Number.isFinite(v)
    ? v.toLocaleString('pt-BR', { maximumFractionDigits: 2 })  // keep up to 2 decimals
    : String(v ?? '');

const COLORS = ["#2563eb", "#16a34a", "#ea580c", "#9333ea",
                "#0891b2", "#dc2626", "#ca8a04", "#4f46e5"];    // categorical palette
```

`fmtNum` is why exported/interactive charts show `1.234,5` instead of a rounded
integer — it matches `render.js`'s formatter.

## Guard

```ts
const x = Array.isArray(spec?.x) ? spec.x.map(String) : [];
const series = Array.isArray(spec?.series) ? spec.series : [];
if (!x.length || !series.length) {
  return <p className="text-sm text-muted-foreground">Gráfico indisponível</p>;
}
```

An empty or malformed spec degrades to a message instead of crashing.

## Pie

The pie uses only the **first** series; slices are the values, labelled
`name: value`:

```tsx
const data = x.map((label, i) => ({ name: label, value: Number(series[0].data?.[i] ?? 0) }));
return (
  <PieChart>
    <Pie data={data} dataKey="value" nameKey="name" outerRadius="80%"
         label={({ name, value }) => `${name}: ${fmtNum(value)}`}>
      {data.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
    </Pie>
    <Tooltip /><Legend />
  </PieChart>
);
```

## Data shaping (bar / line)

Recharts wants an array of **rows**, one per category, with a key per series:

```ts
const keys = series.map((s, i) => s.name || `Série ${i + 1}`);
const data = x.map((label, i) => {
  const row: Record<string, string | number> = { x: label };
  series.forEach((s, si) => { row[keys[si]] = Number(s.data?.[i] ?? 0); });
  return row;
});
```

So a `x: ["Jan","Fev"]`, two-series spec becomes
`[{ x:"Jan", Meta:120, Google:90 }, { x:"Fev", Meta:160, Google:110 }]`.

## The trend line

`trend` overlays a **linear least-squares regression of the per-category
totals** — a single-axis annotation, not a new series (so it never consumes a
categorical hue and doesn't violate the "one axis" rule). We compute it once and
attach a `__trend` value to each row:

```ts
const horizontal = spec.type === "bar" && spec.orientation === "horizontal";
const stacked    = spec.type === "bar" && !!spec.stacked;
const showTrend  = spec.type === "bar" && !!spec.trend && !horizontal; // N/A on horizontal

if (showTrend && x.length > 1) {
  const totals = x.map((_, i) => series.reduce((a, s) => a + Number(s.data?.[i] ?? 0), 0));
  let sx=0, sy=0, sxy=0, sxx=0;
  for (let i = 0; i < totals.length; i++) { sx+=i; sy+=totals[i]; sxy+=i*totals[i]; sxx+=i*i; }
  const denom = totals.length*sxx - sx*sx;
  const slope = denom === 0 ? 0 : (totals.length*sxy - sx*sy) / denom;
  const intercept = (sy - slope*sx) / totals.length;
  data.forEach((row, i) => { row.__trend = intercept + slope * i; });
}
```

Trend of the **totals** means: single series → trend of that series; stacked →
trend of the stack height. It's ignored on horizontal (a ranking has no time
axis) and needs ≥2 points.

## Line

```tsx
<LineChart data={data}>
  <CartesianGrid strokeDasharray="3 3" />
  <XAxis dataKey="x" /><YAxis /><Tooltip /><Legend />
  {keys.map((k, i) => (
    <Line key={k} dataKey={k} stroke={COLORS[i % COLORS.length]} strokeWidth={2} dot>
      <LabelList dataKey={k} position="top" formatter={fmtNum}
                 style={{ fill: 'currentColor', fontSize: 11 }} />
    </Line>
  ))}
</LineChart>
```

`LabelList` draws the value at each point; `fill: currentColor` keeps labels
legible in both light and dark themes.

## Bar — grouped / stacked / horizontal / trend

All bar variants use one `ComposedChart` (Recharts' bar-and-line container), so
the optional trend `Line` can sit on top of the bars:

```tsx
<ComposedChart data={data} layout={horizontal ? "vertical" : "horizontal"}>
  <CartesianGrid strokeDasharray="3 3" />
  {horizontal ? (
    <>
      <XAxis type="number" />
      <YAxis type="category" dataKey="x" width={110} />   {/* room for long labels */}
    </>
  ) : (
    <>
      <XAxis dataKey="x" /><YAxis />
    </>
  )}
  <Tooltip /><Legend />

  {keys.map((k, i) => (
    <Bar key={k} dataKey={k} fill={COLORS[i % COLORS.length]}
         stackId={stacked ? "stack" : undefined}>   {/* same stackId = stacked */}
      {!stacked && (                                  {/* skip labels on stacked (they'd overlap) */}
        <LabelList dataKey={k} position={horizontal ? "right" : "top"}
                   formatter={fmtNum} style={{ fill: 'currentColor', fontSize: 11 }} />
      )}
    </Bar>
  ))}

  {showTrend && (
    <Line dataKey="__trend" name="Tendência" stroke="#64748b" strokeWidth={2}
          strokeDasharray="5 4" dot={false} legendType="plainline" />
  )}
</ComposedChart>
```

The knobs, in plain terms:

| Flag | Recharts mechanism | Effect |
|------|--------------------|--------|
| `stacked` | shared `stackId` on every `<Bar>` | series stack per category |
| `orientation:"horizontal"` | `layout="vertical"` + swapped axis types | bars run left→right (ranking) |
| `trend` | an extra `<Line dataKey="__trend">` | dashed regression of the totals |

Notes:

- **`layout="vertical"` is Recharts-speak for horizontal bars** (the category
  axis becomes vertical). The `width={110}` on the category `YAxis` reserves space
  for long labels like client names.
- Value labels are **suppressed on stacked** bars (segment labels overlap); the
  totals are still legible from the axis.
- The trend line is named `"Tendência"`, so it appears in the legend — identity
  is never color-alone.

## Parity with the PDF export

`render.js`'s `chartSvg` implements the same four cases (grouped / stacked /
horizontal / trend), the same palette, the same `fmtNum`, and the same
totals-based trend. That parity is deliberate: **what you see in the chat is what
you get in the PDF.** If you change one renderer's behavior, change the other to
match — see `bridge-index-and-render.md` §2.2.
