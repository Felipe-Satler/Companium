// DEV ONLY. Fakes the OpenClaw bridge surface (/api/openclaw/*) so the widget
// AND the /biblioteca library page can be exercised locally without the real
// server. Holds a little in-memory state so rename/delete actually work here.
// Delete — or swap for a proxy to the real server — once you test against prod.
import type { Plugin } from 'vite';

function buildReply(text: string) {
  const t = text.toLowerCase();
  if (t.includes('pdf')) {
    return {
      type: 'service_request',
      service: 'export',
      content: 'Here is your PDF ✓',
      artifact: {
        kind: 'pdf',
        filename: 'report.pdf',
        mimeType: 'application/pdf',
        source: 'data:application/pdf;base64,JVBERi0xLjQK',
      },
    };
  }
  if (t.includes('plot') || t.includes('chart')) {
    return {
      type: 'service_request',
      service: 'plot',
      content: 'I created a plot for you.',
      plot: { id: 'demo-1', title: 'Sample plot' },
    };
  }
  // Markdown sample so the sanitized-Markdown rendering is visible locally.
  return {
    type: 'message',
    content: [
      `Você disse: **${text}**`,
      '',
      'Exemplo de **Markdown** renderizado:',
      '',
      '- item **um**',
      '- item _dois_ com `código inline`',
      '- um [link](https://groohub.com)',
      '',
      '### Um subtítulo',
      '',
      '| Métrica | Valor |',
      '| --- | --- |',
      '| Leads | 1.234 |',
      '| CPA | R$ 12,50 |',
      '',
      '> E um bloco de citação pra fechar.',
    ].join('\n'),
  };
}

// A tiny bar-chart SVG served (as image/svg+xml) for the plot thumbnails.
function thumbSvg(label?: string) {
  const t = String(label || 'Plot').slice(0, 24).replace(/[<&>]/g, '');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="540">
    <rect width="900" height="540" fill="#eceef1"/>
    <rect x="90"  y="360" width="120" height="140" fill="#4f46e5"/>
    <rect x="270" y="280" width="120" height="220" fill="#16a34a"/>
    <rect x="450" y="200" width="120" height="300" fill="#ea580c"/>
    <rect x="630" y="320" width="120" height="180" fill="#9333ea"/>
    <text x="450" y="70" text-anchor="middle" font-family="sans-serif" font-size="30" fill="#111">${t}</text>
  </svg>`;
}

function readJsonBody(req: { on: (e: string, cb: (c?: unknown) => void) => void }): Promise<any> {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      try {
        resolve(JSON.parse(raw || '{}'));
      } catch {
        resolve({});
      }
    });
  });
}

export function openClawDevStub(): Plugin {
  // In-memory library so rename/delete persist during the dev session.
  const now = Date.now();
  const h = (n: number) => new Date(now - n * 3600e3).toISOString();
  let plots = [
    {
      id: 'plot-1',
      title: 'Leads por mês',
      created_at: h(1),
      spec: {
        type: 'bar',
        title: 'Leads por mês',
        x: ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun'],
        series: [
          { name: 'Meta Ads', data: [120, 160, 140, 200, 180, 240] },
          { name: 'Google Ads', data: [90, 110, 130, 100, 150, 170] },
        ],
      },
    },
    {
      id: 'plot-2',
      title: 'Investimento vs Retorno',
      created_at: h(26),
      spec: {
        type: 'line',
        title: 'Investimento vs Retorno',
        x: ['S1', 'S2', 'S3', 'S4', 'S5', 'S6'],
        series: [
          { name: 'Investimento', data: [1000, 1200, 1100, 1500, 1400, 1800] },
          { name: 'Retorno', data: [1500, 1900, 1700, 2600, 2400, 3400] },
        ],
      },
    },
    {
      id: 'plot-3',
      title: 'Share por canal',
      created_at: h(70),
      spec: {
        type: 'pie',
        title: 'Share por canal',
        x: ['Meta', 'Google', 'Orgânico', 'Indicação'],
        series: [{ name: 'Leads', data: [420, 310, 180, 90] }],
      },
    },
  ];
  let artifacts = [
    { id: 'art-1', kind: 'pdf', filename: 'relatorio-maio.pdf', mime_type: 'application/pdf', created_at: h(2) },
    { id: 'art-2', kind: 'md', filename: 'resumo.md', mime_type: 'text/markdown', created_at: h(50) },
  ];

  const json = (res: any, code: number, obj: unknown) => {
    res.statusCode = code;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(obj));
  };

  return {
    name: 'openclaw-dev-stub',
    configureServer(server) {
      server.middlewares.use('/api/openclaw', async (req: any, res: any, next: () => void) => {
        const url = (req.url || '').split('?')[0]; // relative to /api/openclaw
        const method = req.method || 'GET';
        let m: RegExpMatchArray | null;

        // POST /chat — the widget transport.
        if (method === 'POST' && url === '/chat') {
          const body = await readJsonBody(req);
          const text = String(body?.message?.content ?? '');
          if (text.toLowerCase().includes('fail')) {
            return json(res, 500, { error: 'Simulated OpenClaw error' });
          }
          setTimeout(() => json(res, 200, buildReply(text)), 500);
          return;
        }

        // GET /library — the biblioteca page.
        if (method === 'GET' && url === '/library') {
          return json(res, 200, {
            plots: plots.map((p) => ({
              id: p.id,
              name: p.title,
              createdAt: p.created_at,
              spec: p.spec,                                       // p/ render interativo
              pdfUrl: `/api/openclaw/plots/${p.id}/export.pdf`,   // botão "Baixar PDF"
              thumbnailUrl: `/api/openclaw/plots/${p.id}/thumb.png`,
            })),
            artifacts: artifacts.map((a) => ({
              id: a.id,
              name: a.filename,
              kind: a.kind,
              mimeType: a.mime_type,
              createdAt: a.created_at,
              downloadUrl: `/api/openclaw/files/${a.id}`,
            })),
          });
        }

        // GET /plots/:id/thumb.png — placeholder chart.
        if (method === 'GET' && (m = url.match(/^\/plots\/([^/]+)\/thumb\.png$/))) {
          const p = plots.find((x) => x.id === m![1]);
          res.statusCode = 200;
          res.setHeader('Content-Type', 'image/svg+xml');
          res.end(thumbSvg(p?.title));
          return;
        }

        // GET /plots/:id/export.pdf — placeholder. O PDF real (chartHtml->renderPdf
        // via Chrome headless) só roda no servidor; aqui é só pra testar o botão.
        if (method === 'GET' && (m = url.match(/^\/plots\/([^/]+)\/export\.pdf$/))) {
          const p = plots.find((x) => x.id === m![1]);
          const name = (p?.title || 'grafico').replace(/[^a-zA-Z0-9._-]/g, '_');
          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/pdf');
          res.setHeader('Content-Disposition', `attachment; filename="${name}.pdf"`);
          res.end(`Stub PDF para "${p?.title || m![1]}" — o PDF real é gerado no servidor.`);
          return;
        }

        // GET /files/:id — placeholder download.
        if (method === 'GET' && (m = url.match(/^\/files\/([^/]+)$/))) {
          const a = artifacts.find((x) => x.id === m![1]);
          res.statusCode = 200;
          res.setHeader('Content-Type', a?.mime_type || 'text/plain');
          res.setHeader('Content-Disposition', `attachment; filename="${a?.filename || 'download'}"`);
          res.end(`Stub file for ${a?.filename || m![1]}`);
          return;
        }

        // PATCH /plots/:id — rename (title).
        if (method === 'PATCH' && (m = url.match(/^\/plots\/([^/]+)$/))) {
          const body = await readJsonBody(req);
          const p = plots.find((x) => x.id === m![1]);
          if (!p) return json(res, 404, { error: 'Not found' });
          if (typeof body.title === 'string' && body.title.trim()) p.title = body.title.trim();
          return json(res, 200, { ok: true, id: p.id, name: p.title });
        }

        // PATCH /artifacts/:id — rename (filename).
        if (method === 'PATCH' && (m = url.match(/^\/artifacts\/([^/]+)$/))) {
          const body = await readJsonBody(req);
          const a = artifacts.find((x) => x.id === m![1]);
          if (!a) return json(res, 404, { error: 'Not found' });
          if (typeof body.filename === 'string' && body.filename.trim()) a.filename = body.filename.trim();
          return json(res, 200, { ok: true, id: a.id, name: a.filename });
        }

        // DELETE /plots/:id
        if (method === 'DELETE' && (m = url.match(/^\/plots\/([^/]+)$/))) {
          plots = plots.filter((x) => x.id !== m![1]);
          return json(res, 200, { ok: true, id: m![1] });
        }

        // DELETE /artifacts/:id
        if (method === 'DELETE' && (m = url.match(/^\/artifacts\/([^/]+)$/))) {
          artifacts = artifacts.filter((x) => x.id !== m![1]);
          return json(res, 200, { ok: true, id: m![1] });
        }

        return next();
      });
    },
  };
}
