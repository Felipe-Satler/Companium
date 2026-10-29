// Server-side rendering for the bridge.
//
// The agent produces *content* (markdown for reports, a chart spec for plots);
// the bridge renders deterministic artifacts from it. This removes the agent's
// unreliable file-creation step from the export path entirely.
//
//   markdownToHtml() : a small, safe markdown subset (headings, bold/italic,
//                      lists, GFM pipe tables, hr, inline code, paragraphs).
//   reportHtml()     : wrap body HTML in a styled, print-friendly document.
//   chartSvg()       : a self-contained SVG bar/line/pie chart from a spec
//                      (no external JS/CDN — Chrome renders it offline).
//   renderPdf()      : HTML -> PDF (headless Chrome --print-to-pdf).
//   renderPng()      : HTML -> PNG (headless Chrome --screenshot).

import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHROME_BIN =
  process.env.CHROME_BIN ||
  process.env.GOOGLE_CHROME_BIN ||
  "google-chrome";
const RENDER_TIMEOUT_MS = Number(process.env.RENDER_TIMEOUT_MS || 60000);

// ---------------------------------------------------------------------------
// HTML escaping
// ---------------------------------------------------------------------------

export function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ---------------------------------------------------------------------------
// Markdown -> HTML (small, deterministic subset; escape first, then format)
// ---------------------------------------------------------------------------

/** Inline formatting on already-escaped text: code, bold, italic, links. */
function inlineMd(escaped) {
  let s = escaped;
  // `code`
  s = s.replace(/`([^`]+)`/g, (_m, c) => `<code>${c}</code>`);
  // **bold** / __bold__
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/__([^_]+)__/g, "<strong>$1</strong>");
  // *italic* / _italic_
  s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
  s = s.replace(/(^|[^_])_([^_\n]+)_/g, "$1<em>$2</em>");
  // [text](http...) — only http(s) URLs
  s = s.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
    (_m, t, u) => `<a href="${u}">${t}</a>`
  );
  return s;
}

function tableRowCells(line) {
  // Split on unescaped pipes; drop leading/trailing empties from border pipes.
  let cells = line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|");
  return cells.map((c) => c.trim());
}

function isTableSeparator(line) {
  return /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line);
}

/**
 * Convert a markdown subset to HTML. Input is treated as untrusted text and
 * HTML-escaped before any formatting is applied.
 */
export function markdownToHtml(md) {
  const lines = String(md).replace(/\r\n?/g, "\n").split("\n");
  const out = [];
  let i = 0;
  let para = [];

  const flushPara = () => {
    if (para.length) {
      out.push(`<p>${inlineMd(escapeHtml(para.join(" ")))}</p>`);
      para = [];
    }
  };

  while (i < lines.length) {
    const line = lines[i];

    // Blank line -> paragraph break.
    if (/^\s*$/.test(line)) {
      flushPara();
      i++;
      continue;
    }

    // Horizontal rule.
    if (/^\s*([-*_])\1\1+\s*$/.test(line)) {
      flushPara();
      out.push("<hr>");
      i++;
      continue;
    }

    // Heading.
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      flushPara();
      const level = h[1].length;
      out.push(`<h${level}>${inlineMd(escapeHtml(h[2].trim()))}</h${level}>`);
      i++;
      continue;
    }

    // GFM table: header row + separator + body rows.
    if (line.includes("|") && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
      flushPara();
      const header = tableRowCells(line);
      i += 2; // skip header + separator
      const rows = [];
      while (i < lines.length && lines[i].includes("|") && !/^\s*$/.test(lines[i])) {
        rows.push(tableRowCells(lines[i]));
        i++;
      }
      const th = header
        .map((c) => `<th>${inlineMd(escapeHtml(c))}</th>`)
        .join("");
      const body = rows
        .map(
          (r) =>
            `<tr>${r
              .map((c) => `<td>${inlineMd(escapeHtml(c))}</td>`)
              .join("")}</tr>`
        )
        .join("");
      out.push(`<table><thead><tr>${th}</tr></thead><tbody>${body}</tbody></table>`);
      continue;
    }

    // Unordered list.
    if (/^\s*[-*+]\s+/.test(line)) {
      flushPara();
      const items = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*+]\s+/, ""));
        i++;
      }
      out.push(
        `<ul>${items
          .map((t) => `<li>${inlineMd(escapeHtml(t))}</li>`)
          .join("")}</ul>`
      );
      continue;
    }

    // Ordered list.
    if (/^\s*\d+[.)]\s+/.test(line)) {
      flushPara();
      const items = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+[.)]\s+/, ""));
        i++;
      }
      out.push(
        `<ol>${items
          .map((t) => `<li>${inlineMd(escapeHtml(t))}</li>`)
          .join("")}</ol>`
      );
      continue;
    }

    // Otherwise: accumulate into the current paragraph.
    para.push(line.trim());
    i++;
  }
  flushPara();
  return out.join("\n");
}

// ---------------------------------------------------------------------------
// Document template (simple, print-friendly; branding can be layered later)
// ---------------------------------------------------------------------------

const BASE_CSS = `
  * { box-sizing: border-box; }
  body { font-family: -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
         color: #1a1a1a; line-height: 1.5; margin: 0; padding: 48px; }
  h1 { font-size: 24px; margin: 0 0 4px; }
  h2 { font-size: 18px; margin: 24px 0 8px; }
  h3 { font-size: 15px; margin: 18px 0 6px; }
  p { margin: 8px 0; }
  ul, ol { margin: 8px 0; padding-left: 22px; }
  li { margin: 2px 0; }
  hr { border: none; border-top: 1px solid #e2e2e2; margin: 20px 0; }
  code { background: #f4f4f5; padding: 1px 5px; border-radius: 4px;
         font-family: "SF Mono", Menlo, Consolas, monospace; font-size: 12px; }
  table { border-collapse: collapse; width: 100%; margin: 12px 0; font-size: 13px; }
  th, td { border: 1px solid #e2e2e2; padding: 6px 10px; text-align: left; }
  thead th { background: #f7f7f8; font-weight: 600; }
  tbody tr:nth-child(even) { background: #fbfbfc; }
  a { color: #2563eb; text-decoration: none; }
`;

/** Wrap rendered body HTML in a full, styled document. */
export function reportHtml(title, bodyHtml) {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<title>${escapeHtml(title || "Relatório")}</title>
<style>${BASE_CSS}</style></head><body>${bodyHtml}</body></html>`;
}

/** Convenience: markdown + title -> full styled document HTML. */
export function markdownReportHtml(title, markdown) {
  return reportHtml(title, markdownToHtml(markdown));
}

// ---------------------------------------------------------------------------
// Charts — self-contained SVG (no JS) from a {type,x,series} spec
// ---------------------------------------------------------------------------

const CHART_COLORS = [
  "#2563eb", "#16a34a", "#ea580c", "#9333ea",
  "#0891b2", "#dc2626", "#ca8a04", "#4f46e5",
];

function fmtNum(n) {
  // pt-BR grouping (e.g. 1.813,50); keeps up to 2 decimals, no trailing zeros
  // on integers (1.813 stays 1.813, not 1.813,00).
  return Number(n).toLocaleString("pt-BR", { maximumFractionDigits: 2 });
}

/**
 * Build a standalone SVG chart from a validated spec.
 * @param {{type:string,x:string[],series:{name:string,data:number[]}[],title?:string,xLabel?:string,yLabel?:string}} spec
 * @param {{width?:number,height?:number}} [opts]
 */
export function chartSvg(spec, opts = {}) {
  const W = opts.width || 900;
  const H = opts.height || 540;
  const type = String(spec.type || "bar").toLowerCase();
  const x = Array.isArray(spec.x) ? spec.x.map(String) : [];
  const series = Array.isArray(spec.series) ? spec.series : [];
  const title = spec.title ? String(spec.title) : "";

  const esc = escapeHtml;
  // Bar variants (all single-axis). Horizontal transposes the axes; stacked sums
  // series per category; trend overlays a linear regression of category totals.
  const horizontal = type === "bar" && spec.orientation === "horizontal";
  const stacked = type === "bar" && !!spec.stacked;
  const showTrend = type === "bar" && !!spec.trend && !horizontal;
  // Vertical bar charts with long category labels angle them (transversal) instead of
  // letting them overlap — decided here so we can reserve the extra bottom margin.
  const vBarLabels = !horizontal && type !== "line" && x.length > 0;
  const catMaxChars = vBarLabels ? Math.max(...x.map((l) => l.length)) : 0;
  const catLabelPx = catMaxChars * 7 + 8;              // widest label footprint (font ~12)
  const vSlotEst = (W - 96) / (x.length || 1);         // plotW/n for vertical (pad.left 72 + right 24)
  const vStepEst = Math.max(1, Math.ceil(24 / vSlotEst));
  const rotateXLabels = vBarLabels && catLabelPx > vSlotEst * vStepEst;
  const needsLegendRow = series.length > 1 || showTrend;
  const pad = {
    top: title ? 56 : 28,
    right: 24,
    bottom: rotateXLabels ? Math.min(200, Math.round(catLabelPx * 0.6) + (needsLegendRow ? 46 : 22)) : 64,
    left: horizontal ? 140 : 72,
  };
  const plotW = W - pad.left - pad.right;
  const plotH = H - pad.top - pad.bottom;

  const parts = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="-apple-system, Segoe UI, Roboto, Arial, sans-serif">`
  );
  parts.push(`<rect width="${W}" height="${H}" fill="#ffffff"/>`);
  if (title && !opts.hideTitle) {
    parts.push(
      `<text x="${W / 2}" y="32" text-anchor="middle" font-size="20" font-weight="600" fill="#1a1a1a">${esc(
        title
      )}</text>`
    );
  }

  if (type === "pie") {
    // Single series pie (first series); slices labelled by x. Zeroed metrics have
    // no slice to attach a label to (their labels would pile up at one angle), so
    // we skip them in the pie and list them beside it instead. No legend — each
    // slice label already names it.
    const data = (series[0] && series[0].data) || [];
    const total = data.reduce((a, b) => a + (Number(b) || 0), 0) || 1;
    const zeros = []; // { label, color }
    data.forEach((vRaw, idx) => {
      if ((Number(vRaw) || 0) <= 0)
        zeros.push({ label: x[idx] || "", color: CHART_COLORS[idx % CHART_COLORS.length] });
    });
    // Reserve room on the right for the zero list so the pie doesn't overlap it.
    const listW = zeros.length ? Math.min(180, plotW * 0.35) : 0;
    const pieW = plotW - listW;
    const cx = pad.left + pieW / 2;
    const cy = pad.top + plotH / 2;
    const r = Math.min(pieW, plotH) / 2 - 10;
    let a0 = -Math.PI / 2;
    data.forEach((vRaw, idx) => {
      const v = Number(vRaw) || 0;
      if (v <= 0) return; // listed to the side, not drawn
      const a1 = a0 + (v / total) * Math.PI * 2;
      const large = a1 - a0 > Math.PI ? 1 : 0;
      const x0 = cx + r * Math.cos(a0);
      const y0 = cy + r * Math.sin(a0);
      const x1 = cx + r * Math.cos(a1);
      const y1 = cy + r * Math.sin(a1);
      const color = CHART_COLORS[idx % CHART_COLORS.length];
      parts.push(
        `<path d="M ${cx} ${cy} L ${x0.toFixed(1)} ${y0.toFixed(1)} A ${r} ${r} 0 ${large} 1 ${x1.toFixed(
          1
        )} ${y1.toFixed(1)} Z" fill="${color}"/>`
      );
      const mid = (a0 + a1) / 2;
      const rightSide = Math.cos(mid) >= 0;
      const lx = cx + (r + 12) * Math.cos(mid);
      const ly = cy + (r + 12) * Math.sin(mid);
      const anchor = rightSide ? "start" : "end";
      // Auto-fit: name over value (two lines), colored by slice, and shrunk to the
      // room left to the pie region's edge so it never clips or hits the zero list.
      const edge = rightSide ? pad.left + pieW : 0;
      const room = Math.abs(edge - lx) - 4;
      const maxChars = Math.max(3, Math.floor(room / 6.6));
      let nameLine = x[idx] || "";
      if (nameLine.length > maxChars) nameLine = nameLine.slice(0, Math.max(1, maxChars - 1)) + "…";
      parts.push(
        `<text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="${anchor}" font-size="12" fill="${color}">` +
          `<tspan x="${lx.toFixed(1)}" dy="-0.1em" font-weight="600">${esc(nameLine)}</tspan>` +
          `<tspan x="${lx.toFixed(1)}" dy="1.15em" fill-opacity="0.75">${esc(fmtNum(v))}</tspan>` +
          `</text>`
      );
      a0 = a1;
    });
    // Zero list, one metric per line, beside the pie.
    if (zeros.length) {
      const lx = pad.left + pieW + 12;
      let ly = cy - (zeros.length - 1) * 9;
      zeros.forEach(({ label, color }) => {
        parts.push(`<circle cx="${lx.toFixed(1)}" cy="${(ly - 4).toFixed(1)}" r="4" fill="${color}"/>`);
        parts.push(
          `<text x="${(lx + 10).toFixed(1)}" y="${ly.toFixed(1)}" font-size="12" fill="#444">${esc(
            label
          )} (0)</text>`
        );
        ly += 18;
      });
    }
    parts.push("</svg>");
    return parts.join("");
  }

  // Cartesian value scale (shared). Stacked height / trend use category totals.
  const totals = x.map((_, i) =>
    series.reduce((a, s) => a + (Number((s.data || [])[i]) || 0), 0)
  );
  let singleMax = 0;
  for (const s of series)
    for (const v of s.data || []) singleMax = Math.max(singleMax, Number(v) || 0);
  let maxV = stacked ? Math.max(0, ...totals) : singleMax;
  if (showTrend) maxV = Math.max(maxV, ...totals);
  if (maxV <= 0) maxV = 1;
  const niceTop = (() => {
    const p = Math.pow(10, Math.floor(Math.log10(maxV)));
    for (const st of [1, 2, 2.5, 5, 10]) if (p * st >= maxV) return p * st;
    return p * 10;
  })();
  const n = x.length || 1;

  if (horizontal) {
    // Categories down the Y axis, values along X (ranking / long labels).
    const xOf = (v) => pad.left + (Number(v) / niceTop) * plotW;
    const slotY = plotH / n;
    const ns = series.length || 1;
    // Thin labels when rows are shorter than a line of text (~14px) so they don't
    // stack on top of each other. step === 1 leaves normal rankings untouched.
    const labelStepY = Math.max(1, Math.ceil(14 / slotY));
    const showLblY = (i) => i % labelStepY === 0;
    parts.push(`<line x1="${pad.left}" y1="${pad.top}" x2="${pad.left}" y2="${pad.top + plotH}" stroke="#cfcfcf"/>`);
    parts.push(`<line x1="${pad.left}" y1="${pad.top + plotH}" x2="${pad.left + plotW}" y2="${pad.top + plotH}" stroke="#cfcfcf"/>`);
    for (let t = 0; t <= 5; t++) {
      const val = (niceTop / 5) * t;
      const xx = xOf(val);
      parts.push(`<line x1="${xx.toFixed(1)}" y1="${pad.top}" x2="${xx.toFixed(1)}" y2="${(pad.top + plotH).toFixed(1)}" stroke="#efefef"/>`);
      parts.push(`<text x="${xx.toFixed(1)}" y="${(pad.top + plotH + 18).toFixed(1)}" text-anchor="middle" font-size="11" fill="#666">${fmtNum(val)}</text>`);
    }
    x.forEach((lab, idx) => {
      if (!showLblY(idx)) return; // sampled out to avoid overlap
      const cy = pad.top + slotY * idx + slotY / 2;
      parts.push(`<text x="${(pad.left - 8).toFixed(1)}" y="${(cy + 4).toFixed(1)}" text-anchor="end" font-size="12" fill="#444">${esc(lab)}</text>`);
    });
    x.forEach((_, idx) => {
      if (stacked) {
        let cursor = pad.left;
        const barH = slotY * 0.62;
        const by = pad.top + slotY * idx + (slotY - barH) / 2;
        series.forEach((s, si) => {
          const v = Number((s.data || [])[idx]) || 0;
          const w = xOf(v) - pad.left;
          parts.push(`<rect x="${cursor.toFixed(1)}" y="${by.toFixed(1)}" width="${Math.max(0, w - 2).toFixed(1)}" height="${barH.toFixed(1)}" fill="${CHART_COLORS[si % CHART_COLORS.length]}"/>`);
          cursor += w;
        });
        if (showLblY(idx)) parts.push(`<text x="${(xOf(totals[idx]) + 4).toFixed(1)}" y="${(by + barH / 2 + 3).toFixed(1)}" font-size="10" fill="#333">${fmtNum(totals[idx])}</text>`);
      } else {
        const groupH = slotY * 0.7;
        const barH = groupH / ns;
        series.forEach((s, si) => {
          const v = Number((s.data || [])[idx]) || 0;
          const w = xOf(v) - pad.left;
          const by = pad.top + slotY * idx + (slotY - groupH) / 2 + barH * si;
          parts.push(`<rect x="${pad.left.toFixed(1)}" y="${by.toFixed(1)}" width="${Math.max(0, w).toFixed(1)}" height="${Math.max(1, barH - 2).toFixed(1)}" fill="${CHART_COLORS[si % CHART_COLORS.length]}"/>`);
          if (showLblY(idx)) parts.push(`<text x="${(pad.left + w + 4).toFixed(1)}" y="${(by + barH / 2 + 3).toFixed(1)}" font-size="10" fill="#333">${fmtNum(v)}</text>`);
        });
      }
    });
  } else {
    // Vertical: value on Y, categories on X.
    const yOf = (v) => pad.top + plotH - (Number(v) / niceTop) * plotH;
    const slot = plotW / n;
    // Label density: time-series lines are sampled to fit horizontally; bar charts keep
    // every category label (angled when long — see rotateXLabels) and only sample when
    // extremely dense. step === 1 leaves normal charts untouched. Also gates value labels.
    const maxChars = Math.max(...x.map((l) => String(l).length));
    const labelStep =
      type === "line"
        ? Math.max(1, Math.ceil((maxChars * 7 + 8) / slot)) // fit horizontally
        : Math.max(1, Math.ceil(24 / slot));                // bars: only if ultra-dense
    const showLbl = (i) => i % labelStep === 0;
    // Line value labels are numbers (narrower than the date labels), so pack in as many
    // as fit on their own — independent of the sparser axis-label sampling above.
    const valChars = Math.max(
      1,
      ...series.flatMap((s) => (s.data || []).map((v) => fmtNum(Number(v) || 0).length))
    );
    const valueStep = Math.max(1, Math.ceil((valChars * 5.5 + 6) / slot));
    const showVal = (i) => i % valueStep === 0;
    parts.push(`<line x1="${pad.left}" y1="${pad.top}" x2="${pad.left}" y2="${pad.top + plotH}" stroke="#cfcfcf"/>`);
    parts.push(`<line x1="${pad.left}" y1="${pad.top + plotH}" x2="${pad.left + plotW}" y2="${pad.top + plotH}" stroke="#cfcfcf"/>`);
    for (let t = 0; t <= 5; t++) {
      const val = (niceTop / 5) * t;
      const yy = yOf(val);
      parts.push(`<line x1="${pad.left}" y1="${yy.toFixed(1)}" x2="${(pad.left + plotW).toFixed(1)}" y2="${yy.toFixed(1)}" stroke="#efefef"/>`);
      parts.push(`<text x="${(pad.left - 8).toFixed(1)}" y="${(yy + 4).toFixed(1)}" text-anchor="end" font-size="11" fill="#666">${fmtNum(val)}</text>`);
    }
    x.forEach((lab, idx) => {
      if (!showLbl(idx)) return; // sampled out to avoid overlap
      const xx = pad.left + slot * idx + slot / 2;
      if (rotateXLabels) {
        const yy = pad.top + plotH + 16;
        parts.push(`<text x="${xx.toFixed(1)}" y="${yy.toFixed(1)}" transform="rotate(-30 ${xx.toFixed(1)} ${yy.toFixed(1)})" text-anchor="end" font-size="12" fill="#444">${esc(lab)}</text>`);
      } else {
        parts.push(`<text x="${xx.toFixed(1)}" y="${(pad.top + plotH + 20).toFixed(1)}" text-anchor="middle" font-size="12" fill="#444">${esc(lab)}</text>`);
      }
    });

    if (type === "line") {
      series.forEach((s, si) => {
        const color = CHART_COLORS[si % CHART_COLORS.length];
        const pts = (s.data || [])
          .map((v, idx) => `${(pad.left + slot * idx + slot / 2).toFixed(1)},${yOf(v).toFixed(1)}`)
          .join(" ");
        parts.push(`<polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2.5"/>`);
        (s.data || []).forEach((v, idx) => {
          const cx = pad.left + slot * idx + slot / 2;
          const cy = yOf(v);
          parts.push(`<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="3.5" fill="${color}"/>`);
          if (showVal(idx)) parts.push(`<text x="${cx.toFixed(1)}" y="${(cy - 8).toFixed(1)}" text-anchor="middle" font-size="10" fill="#333">${fmtNum(v)}</text>`);
        });
      });
    } else if (stacked) {
      const barW = slot * 0.6;
      x.forEach((_, idx) => {
        let cursorY = pad.top + plotH;
        const bx = pad.left + slot * idx + (slot - barW) / 2;
        series.forEach((s, si) => {
          const v = Number((s.data || [])[idx]) || 0;
          const segH = (v / niceTop) * plotH;
          const by = cursorY - segH;
          parts.push(`<rect x="${bx.toFixed(1)}" y="${by.toFixed(1)}" width="${barW.toFixed(1)}" height="${Math.max(0, segH - 2).toFixed(1)}" fill="${CHART_COLORS[si % CHART_COLORS.length]}"/>`);
          if (segH > 16) parts.push(`<text x="${(bx + barW / 2).toFixed(1)}" y="${(by + segH / 2 + 3).toFixed(1)}" text-anchor="middle" font-size="10" fill="#fff">${fmtNum(v)}</text>`);
          cursorY = by;
        });
        if (showLbl(idx)) parts.push(`<text x="${(pad.left + slot * idx + slot / 2).toFixed(1)}" y="${(cursorY - 4).toFixed(1)}" text-anchor="middle" font-size="10" fill="#333">${fmtNum(totals[idx])}</text>`);
      });
    } else {
      const ns = series.length || 1;
      const groupW = slot * 0.7;
      const barW = groupW / ns;
      series.forEach((s, si) => {
        const color = CHART_COLORS[si % CHART_COLORS.length];
        (s.data || []).forEach((v, idx) => {
          const bx = pad.left + slot * idx + (slot - groupW) / 2 + barW * si;
          const by = yOf(v);
          const bh = pad.top + plotH - by;
          parts.push(`<rect x="${bx.toFixed(1)}" y="${by.toFixed(1)}" width="${barW.toFixed(1)}" height="${Math.max(0, bh).toFixed(1)}" fill="${color}"/>`);
          if (showLbl(idx)) parts.push(`<text x="${(bx + barW / 2).toFixed(1)}" y="${(by - 4).toFixed(1)}" text-anchor="middle" font-size="10" fill="#333">${fmtNum(v)}</text>`);
        });
      });
    }

    // Trend line: linear regression of the category totals (dashed annotation).
    if (showTrend && n > 1) {
      let sx = 0, sy = 0, sxy = 0, sxx = 0;
      for (let i = 0; i < n; i++) { sx += i; sy += totals[i]; sxy += i * totals[i]; sxx += i * i; }
      const denom = n * sxx - sx * sx;
      const slope = denom === 0 ? 0 : (n * sxy - sx * sy) / denom;
      const intercept = (sy - slope * sx) / n;
      const pts = totals
        .map((_, i) => `${(pad.left + slot * i + slot / 2).toFixed(1)},${yOf(intercept + slope * i).toFixed(1)}`)
        .join(" ");
      parts.push(`<polyline points="${pts}" fill="none" stroke="#64748b" stroke-width="2" stroke-dasharray="6 4"/>`);
      // Value only at the endpoints. Bar value labels are centered above each bar,
      // so we push the trend value sideways past that label's width into the empty
      // flank beside the end bar — it can never land on a bar's value label. A white
      // halo keeps it legible if it grazes a gridline.
      [0, n - 1].forEach((i) => {
        const px = pad.left + slot * i + slot / 2;
        const py = yOf(intercept + slope * i);
        const left = i === 0;
        // Width of the widest bar value label at this category (font ~10 → ~5.5px/char).
        const endVals = stacked ? [totals[i]] : series.map((s) => Number((s.data || [])[i]) || 0);
        const barLabelW = Math.max(...endVals.map((v) => fmtNum(v).length)) * 5.5;
        const tx = left ? px - barLabelW / 2 - 8 : px + barLabelW / 2 + 8;
        parts.push(
          `<text x="${tx.toFixed(1)}" y="${(py - 2).toFixed(1)}" text-anchor="${
            left ? "end" : "start"
          }" font-size="11" font-weight="600" fill="#64748b" paint-order="stroke" stroke="#ffffff" stroke-width="3" stroke-linejoin="round">${fmtNum(
            intercept + slope * i
          )}</text>`
        );
      });
    }
  }

  // Legend (when >1 series, plus a trend entry when shown).
  const legendItems = series.map((s, si) => ({
    color: CHART_COLORS[si % CHART_COLORS.length],
    label: s.name || `Série ${si + 1}`,
    dashed: false,
  }));
  if (showTrend) legendItems.push({ color: "#64748b", label: "Tendência", dashed: true });
  if (legendItems.length > 1) {
    let lx = pad.left;
    // Angled labels fill the bottom margin, so drop the legend to the very bottom.
    const ly = rotateXLabels ? pad.top + plotH + pad.bottom - 10 : pad.top + plotH + (horizontal ? 40 : 44);
    for (const it of legendItems) {
      if (it.dashed)
        parts.push(`<line x1="${lx}" y1="${ly - 4}" x2="${lx + 12}" y2="${ly - 4}" stroke="${it.color}" stroke-width="2" stroke-dasharray="4 3"/>`);
      else parts.push(`<rect x="${lx}" y="${ly - 10}" width="12" height="12" fill="${it.color}"/>`);
      const label = esc(it.label);
      parts.push(`<text x="${lx + 18}" y="${ly}" font-size="12" fill="#444">${label}</text>`);
      lx += 28 + label.length * 7;
    }
  }

  parts.push("</svg>");
  return parts.join("");
}

/** Full HTML page wrapping an SVG chart (for Chrome screenshot). */
export function chartHtml(spec, opts = {}) {
  const W = opts.width || 900;
  const H = opts.height || 540;
  const svg = chartSvg(spec, { width: W, height: H });
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;padding:0;background:#fff;} svg{display:block;}
  </style></head><body>${svg}</body></html>`;
}

/**
 * HTML for the PDF export: the chart (internal title hidden) + the title shown
 * as a caption below, as a description. Values are drawn on the chart itself.
 */
export function chartReportHtml(spec, opts = {}) {
  const W = opts.width || 680;
  const H = opts.height || 420;
  const svg = chartSvg(spec, { width: W, height: H, hideTitle: true });
  const caption = opts.caption ? escapeHtml(opts.caption) : "";
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><style>
    html,body{margin:0;padding:0;background:#fff;
      font-family:-apple-system,"Segoe UI",Roboto,Arial,sans-serif;}
    .wrap{padding:20px;}
    svg{display:block;margin:0 auto;max-width:100%;}
    figcaption{margin-top:12px;text-align:center;color:#444;font-size:14px;font-weight:600;}
  </style></head><body>
    <div class="wrap">${svg}${caption ? `<figcaption>${caption}</figcaption>` : ""}</div>
  </body></html>`;
}

// ---------------------------------------------------------------------------
// Headless Chrome rendering
// ---------------------------------------------------------------------------

function runChrome(args, timeoutMs) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(CHROME_BIN, args, {
        shell: false,
        timeout: timeoutMs,
        killSignal: "SIGKILL",
        stdio: ["ignore", "ignore", "pipe"],
      });
    } catch (err) {
      return reject(err);
    }
    let stderr = "";
    child.stderr.on("data", (d) => {
      stderr += d;
    });
    child.on("error", reject);
    child.on("close", (code, signal) => {
      if (code === 0) return resolve();
      reject(
        new Error(
          `chrome exited code=${code} signal=${signal}: ${stderr.slice(-300)}`
        )
      );
    });
  });
}

const CHROME_BASE = [
  "--headless=new",
  "--no-sandbox",
  "--disable-gpu",
  "--disable-dev-shm-usage",
  "--no-first-run",
  "--no-default-browser-check",
];

/** Render an HTML string to a PDF Buffer. */
export async function renderPdf(html) {
  const dir = mkdtempSync(join(tmpdir(), "bridge-pdf-"));
  try {
    const inPath = join(dir, "in.html");
    const outPath = join(dir, "out.pdf");
    writeFileSync(inPath, html, "utf8");
    await runChrome(
      [
        ...CHROME_BASE,
        `--user-data-dir=${join(dir, "profile")}`,
        "--no-pdf-header-footer",
        `--print-to-pdf=${outPath}`,
        `file://${inPath}`,
      ],
      RENDER_TIMEOUT_MS
    );
    return readFileSync(outPath);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Render an HTML string to a PNG Buffer at the given window size. */
export async function renderPng(html, { width = 900, height = 540 } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "bridge-png-"));
  try {
    const inPath = join(dir, "in.html");
    const outPath = join(dir, "out.png");
    writeFileSync(inPath, html, "utf8");
    await runChrome(
      [
        ...CHROME_BASE,
        `--user-data-dir=${join(dir, "profile")}`,
        "--hide-scrollbars",
        "--default-background-color=FFFFFFFF",
        `--window-size=${width},${height}`,
        `--screenshot=${outPath}`,
        `file://${inPath}`,
      ],
      RENDER_TIMEOUT_MS
    );
    return readFileSync(outPath);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
