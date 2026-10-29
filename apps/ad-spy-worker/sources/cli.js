#!/usr/bin/env node
/**
 * Run one source provider in isolation, with no DB, no worker, no transcription and no agent.
 *
 * This is the fastest way to answer the two questions that actually matter before trusting a run:
 *   1. Does the scraper still work against the live Ad Library from THIS machine/IP?
 *   2. Do the two Meta providers really produce the same shape?
 *
 * Running both and diffing the output is what PROVES the adapter is swappable, rather than assuming
 * it from the fact that they share an interface.
 *
 * Usage:
 *   node sources/cli.js --tema "harmonização facial" --limit 5
 *   node sources/cli.js --tema "implante dentário" --limit 5 --json > playwright.json
 *   SPY_META_PROVIDER=scrapecreators node sources/cli.js --tema "implante dentário" -n 5 --json > sc.json
 *   diff <(jq -S 'map(keys)|unique' playwright.json) <(jq -S 'map(keys)|unique' sc.json)
 */

import { metaProvider } from "./index.js";

function parseArgs(argv) {
  const out = {
    tema: "",
    limit: 5,
    country: "BR",
    status: "ACTIVE",
    mediaType: "video",
    minDaysRunning: 0,
    maxPerAdvertiser: 0,
    minCopyChars: 0,
    sortBy: "impressions",
    json: false,
  };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    const next = () => argv[++i];
    switch (a) {
      case "--tema":
      case "-t":
        out.tema = next();
        break;
      case "--limit":
      case "-n":
        out.limit = Number(next()) || 5;
        break;
      case "--country":
      case "-c":
        out.country = next();
        break;
      case "--status":
        out.status = next();
        break;
      case "--media":
        out.mediaType = next();
        break;
      case "--min-days":
        out.minDaysRunning = Number(next()) || 0;
        break;
      case "--json":
        out.json = true;
        break;
      case "--help":
      case "-h":
        console.log(
          "uso: node sources/cli.js --tema <termo> [--limit 5] [--country BR] " +
            "[--status ACTIVE|ALL] [--media video|image|all] [--min-days N] [--json]"
        );
        process.exit(0);
        break;
      default:
        if (!out.tema && !a.startsWith("-")) out.tema = a;
    }
  }
  return out;
}

const args = parseArgs(process.argv);
if (!args.tema) {
  console.error('erro: informe --tema "<termo>"  (use --help)');
  process.exit(2);
}

const provider = metaProvider();
const log = (msg) => console.error(`  · ${msg}`);

console.error(`provider: ${provider.implName}`);
console.error(`tema:     "${args.tema}"  limite: ${args.limit}  país: ${args.country}`);
console.error("");

const collected = [];
const started = Date.now();

try {
  for await (const ad of provider.search(args, { log })) {
    collected.push(ad);
    if (!args.json) {
      const days = Number.isFinite(ad.daysRunning) ? `${ad.daysRunning}d` : "?d";
      const copy = (ad.adCopy || "").replace(/\s+/g, " ").slice(0, 70);
      console.log(
        `${String(collected.length).padStart(2)}. [${days.padStart(5)}] ` +
          `${(ad.pageName || "?").slice(0, 28).padEnd(28)} ${ad.mediaType || "-"}  ${copy}`
      );
    }
    if (collected.length >= args.limit) break;
  }
} catch (err) {
  console.error(`\nFALHOU: ${err.message}`);
  process.exit(1);
}

const secs = ((Date.now() - started) / 1000).toFixed(1);

if (args.json) {
  console.log(JSON.stringify(collected, null, 2));
} else {
  // A sanity summary, because "5 rows came back" is not the same as "5 USABLE rows came back":
  // an empty body or a missing media URL means the scraper matched the wrapper but not the payload.
  const withCopy = collected.filter((a) => (a.adCopy || "").trim().length > 0).length;
  const withMedia = collected.filter((a) => a.mediaUrl).length;
  const withDays = collected.filter((a) => Number.isFinite(a.daysRunning)).length;
  const advertisers = new Set(collected.map((a) => a.pageName || "?")).size;
  console.error("");
  console.error(`${collected.length} anúncios em ${secs}s, de ${advertisers} anunciantes`);
  console.error(`  com texto:       ${withCopy}/${collected.length}`);
  console.error(`  com mídia:       ${withMedia}/${collected.length}`);
  console.error(`  com longevidade: ${withDays}/${collected.length}`);
  if (collected.length && (withCopy === 0 || withMedia === 0)) {
    console.error(
      "\nAVISO: os nós foram encontrados mas vieram sem texto/mídia — provável mudança no " +
        "payload da Meta. Revise pickMedia()/normalize() antes de confiar numa run."
    );
  }
}
