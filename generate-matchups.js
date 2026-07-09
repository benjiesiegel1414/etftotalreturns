#!/usr/bin/env node
/**
 * ETF Matchup Page Generator — ETFTotalReturns.com
 * ------------------------------------------------
 * Generates static /vs/{a}-vs-{b}.html pages from the Google Sheets CSV,
 * plus /vs/index.html (hub page) and sitemap-matchups.xml.
 *
 * Zero dependencies. Requires Node 18+ (built-in fetch).
 * Run:  node generate-matchups.js
 */

'use strict';
const fs = require('fs');
const path = require('path');

/* ════════════════ CONFIG ════════════════ */

const CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vTxCiod-Cwry7E6k9Un9dgrM_ANymC36_IO_wLyNj-YDo2KI7mp_1ZzyNBnBGZOxT48QPM8TCwtsmA4/pub?gid=0&single=true&output=csv';

// The live domain — change once here if the domain ever changes.
const BASE_URL = 'https://etftotalreturns.com';

// Generate every pair among the top N funds by AUM.
// 25 → 300 pages. 30 → 435. 40 → 780. Start moderate; raise later.
const TOP_N_BY_AUM = 25;

// Always-generate matchups (added on top of the AUM pairs, deduped).
// Great for hot rivalries even if one fund is small.
const PRIORITY_PAIRS = [
  ['SCHD', 'VYM'],
  ['SCHD', 'DGRO'],
  ['SCHD', 'JEPI'],
  ['JEPI', 'JEPQ'],
  ['JEPI', 'DIVO'],
  ['JEPQ', 'QYLD'],
  ['QYLD', 'XYLD'],
  ['QYLD', 'RYLD'],
  ['VYM', 'HDV'],
  ['DGRO', 'DGRW'],
  ['SPYI', 'JEPI'],
  ['SPYI', 'JEPQ'],
];

const OUT_DIR = path.join(__dirname, 'vs');
const SITEMAP_FILE = path.join(__dirname, 'sitemap-matchups.xml');

/* ════════════════ DATA ════════════════ */

function parseCSV(text) {
  const lines = text.trim().split('\n');
  return lines.slice(1).map(line => {
    const cols = line.split(',').map(c => c.trim().replace(/^"|"$/g, ''));
    return {
      symbol: cols[0] || '', name: cols[1] || '', provider: cols[2] || '', yieldStr: cols[3] || '',
      taxGrade: cols[4] || '', expenseRatio: cols[5] || '', aum: cols[6] || '', totalReturnStr: cols[7] || '',
      priceDecay: cols[8] || '', inceptionStr: cols[9] || '', payoutFreq: cols[10] || '', rating: cols[11] || ''
    };
  }).filter(f => f.symbol);
}

function parseNum(s) { return parseFloat(String(s).replace(/[%,$]/g, '')) || 0; }

function parseAUM(s) {
  if (!s) return 0;
  const clean = s.toUpperCase().replace(/[^0-9.BMK]/g, '');
  let n = parseFloat(clean) || 0;
  if (clean.includes('B')) n *= 1e9; else if (clean.includes('M')) n *= 1e6; else if (clean.includes('K')) n *= 1e3;
  return n;
}

function normalizeDate(str) {
  if (!str) return null;
  const slash = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (slash) { let [, m, d, y] = slash; if (y.length === 2) y = '20' + y; return new Date(`${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`); }
  const dash = str.match(/^(\d{1,2})-(\d{1,2})-(\d{2,4})$/);
  if (dash) { let [, m, d, y] = dash; if (y.length === 2) y = '20' + y; return new Date(`${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`); }
  const d = new Date(str);
  return isNaN(d.getTime()) ? null : d;
}

function yearsSince(dateStr) {
  const d = normalizeDate(dateStr);
  if (!d) return null;
  return (Date.now() - d.getTime()) / (1000 * 60 * 60 * 24 * 365.25);
}

function avgAnnualReturn(f) {
  const totalReturn = parseNum(f.totalReturnStr);
  const years = yearsSince(f.inceptionStr);
  if (years === null || years <= 0) return totalReturn;
  const mult = 1 + (totalReturn / 100);
  if (mult <= 0) return -100;
  return (Math.pow(mult, 1 / years) - 1) * 100;
}

function fmtYears(years) {
  if (!years) return '—';
  return years < 1 ? Math.round(years * 12) + ' months' : years.toFixed(1) + ' years';
}

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function pct(n) { return (n >= 0 ? '+' : '') + n.toFixed(1) + '%'; }

/* ════════════════ VERDICT COPY (data-driven, unique per page) ════════════════ */

function marginPhrase(margin) {
  if (margin >= 8) return 'decisively outperforms';
  if (margin >= 4) return 'holds a clear edge over';
  if (margin >= 1.5) return 'edges out';
  if (margin >= 0.5) return 'narrowly leads';
  return 'is virtually tied with';
}

function buildVerdict(winner, loser, wR, lR) {
  const margin = wR - lR;
  const wYears = yearsSince(winner.inceptionStr);
  const lYears = yearsSince(loser.inceptionStr);
  const wYield = parseNum(winner.yieldStr);
  const lYield = parseNum(loser.yieldStr);

  const paras = [];

  if (margin < 0.5) {
    paras.push(`On average annual total return since inception, <strong>${esc(winner.symbol)}</strong> ${marginPhrase(margin)} <strong>${esc(loser.symbol)}</strong> — ${pct(wR)} vs ${pct(lR)}. With a gap this small, the deciding factors are more likely to be yield, payout schedule, and how each strategy fits your goals than raw performance.`);
  } else {
    paras.push(`On average annual total return since inception, <strong>${esc(winner.symbol)}</strong> ${marginPhrase(margin)} <strong>${esc(loser.symbol)}</strong>: ${pct(wR)} per year vs ${pct(lR)} per year — a gap of ${margin.toFixed(1)} percentage points annually. Total return counts both price movement and dividends, so this is the whole picture of each fund's performance, not just yield.`);
  }

  // Age caveat — important honesty and adds unique text
  if (wYears !== null && lYears !== null) {
    const younger = wYears < lYears ? winner : loser;
    const older = wYears < lYears ? loser : winner;
    const yY = Math.min(wYears, lYears);
    const oY = Math.max(wYears, lYears);
    if (oY - yY >= 3) {
      paras.push(`Keep the track records in mind: ${esc(older.symbol)} has been trading for ${fmtYears(oY)}, while ${esc(younger.symbol)} has only ${fmtYears(yY)} of history. A shorter track record means the younger fund's average has been shaped by fewer market environments — one strong or weak stretch moves the needle more.`);
    }
  }

  // Yield trade-off
  if (wYield && lYield && Math.abs(wYield - lYield) >= 1) {
    const higherYield = wYield > lYield ? winner : loser;
    const lowerYield = wYield > lYield ? loser : winner;
    paras.push(`Income investors will notice the yield gap: ${esc(higherYield.symbol)} currently yields ${esc(higherYield.yieldStr)} vs ${esc(lowerYield.symbol)}'s ${esc(lowerYield.yieldStr)}. Higher yield often comes with trade-offs in price appreciation, which is exactly why total return is the fairer scoreboard.`);
  }

  return paras;
}

/* ════════════════ PAGE TEMPLATE ════════════════ */

const SHARED_CSS = `
* { margin: 0; padding: 0; box-sizing: border-box; }
:root {
  --dark-bg:#0A1F1E; --surface-dark:#0F2A28; --surface-light:#152D2A;
  --green-primary:#10B981; --green-light:#34D399; --green-dark:#059669;
  --white:#FFFFFF; --text-primary:#FFFFFF; --text-secondary:#E5E7EB; --text-muted:#9CA3AF;
  --border-color:rgba(16,185,129,0.2); --border-light:rgba(16,185,129,0.15);
  --danger:#EF4444; --accent-gold:#F59E0B;
}
html, body { margin:0; padding:0; overflow-x:hidden; }
body {
  font-family:'Sora',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
  background:linear-gradient(135deg,var(--dark-bg) 0%,var(--surface-dark) 50%,var(--dark-bg) 100%);
  background-attachment:fixed; color:var(--text-primary);
  display:flex; flex-direction:column; min-height:100vh; line-height:1.6; position:relative;
}
body::before { content:''; position:fixed; inset:0;
  background:radial-gradient(circle at 20% 50%,rgba(16,185,129,0.08) 0%,transparent 50%),radial-gradient(circle at 80% 80%,rgba(16,185,129,0.05) 0%,transparent 50%);
  pointer-events:none; z-index:0; }
.container { width:100%; max-width:1100px; margin:0 auto; padding:0 32px; position:relative; z-index:1; }
header { position:sticky; top:0; z-index:1000; background:rgba(10,31,30,0.9); backdrop-filter:blur(20px);
  border-bottom:1px solid var(--border-color); padding:16px 0; box-shadow:0 8px 32px rgba(0,0,0,0.4); }
.header-content { display:flex; justify-content:space-between; align-items:center; }
.logo { font-size:20px; font-weight:800; letter-spacing:-0.5px;
  background:linear-gradient(135deg,var(--green-light) 0%,var(--green-primary) 100%);
  -webkit-background-clip:text; -webkit-text-fill-color:transparent; background-clip:text; text-decoration:none; }
.premium-btn { display:inline-block; padding:10px 20px; background:linear-gradient(135deg,#F59E0B,#FBBF24);
  color:var(--dark-bg); font-weight:800; font-size:14px; text-decoration:none; border-radius:8px;
  box-shadow:0 0 20px rgba(245,158,11,0.4); white-space:nowrap; }
.hero { padding:40px 0 8px; text-align:center; max-width:900px; margin:0 auto; }
.hero h1 { font-size:clamp(30px,5vw,44px); font-weight:800; letter-spacing:-1px; margin-bottom:12px; line-height:1.15;
  background:linear-gradient(135deg,var(--green-light) 0%,var(--white) 100%);
  -webkit-background-clip:text; -webkit-text-fill-color:transparent; background-clip:text; }
.hero-subtitle { font-size:15px; color:var(--text-secondary); margin-bottom:12px; max-width:700px; margin-left:auto; margin-right:auto; }
.hero-subtitle strong { color:var(--green-light); }
.hero-subtitle em { color:var(--accent-gold); font-style:italic; font-size:13px; margin-top:8px; display:block; }
.back-link { display:inline-block; margin-bottom:18px; color:var(--text-muted); font-size:13px; text-decoration:none; }
.back-link:hover { color:var(--green-light); }
.updated-tag { font-family:'JetBrains Mono',monospace; font-size:11px; color:var(--text-muted); letter-spacing:1px; text-transform:uppercase; }
.banner { width:90%; max-width:1000px; margin:24px auto 32px; display:flex; flex-direction:column; align-items:center; gap:8px; }
.banner img { display:block; max-width:100%; height:auto; }
.banner small { color:var(--text-muted); font-size:0.78em; font-weight:600; }
.section { margin:12px 0 40px; }
.section h2 { font-size:22px; font-weight:700; margin-bottom:20px; color:var(--white); }
.chart-card { background:linear-gradient(135deg,rgba(16,185,129,0.06),rgba(16,185,129,0.02));
  border:1px solid var(--border-color); border-radius:14px; padding:30px 26px 22px; margin:20px 0;
  box-shadow:0 8px 32px rgba(0,0,0,0.2); }
.kicker { font-size:12px; letter-spacing:1.5px; text-transform:uppercase; color:var(--green-light); font-weight:700; margin-bottom:18px; text-align:center; }
.compare-wrap { position:relative; }
.compare-versus { display:grid; grid-template-columns:1fr 1fr; gap:16px; }
.compare-side { background:var(--surface-dark); border:1.5px solid var(--border-light); border-radius:12px; padding:24px 18px; text-align:center; }
.compare-side.leader { border-color:var(--green-primary); box-shadow:0 0 0 1px var(--green-primary),0 8px 24px rgba(16,185,129,.15); }
.leader-tag { font-size:11px; text-transform:uppercase; letter-spacing:1px; color:var(--green-light); font-weight:700; margin-bottom:10px; }
.compare-badge { width:42px; height:42px; border-radius:10px; margin:0 auto 12px; display:flex; align-items:center; justify-content:center;
  font-family:'JetBrains Mono',monospace; font-weight:900; font-size:1rem; background:var(--surface-light);
  border:1px solid var(--border-color); color:var(--green-light); }
.compare-ticker { font-weight:800; font-size:1.1rem; font-family:'JetBrains Mono',monospace; }
.compare-name { color:var(--text-muted); font-size:0.75rem; margin:3px 0 16px; }
.compare-metric { font-family:'JetBrains Mono',monospace; font-size:2.3rem; font-weight:900; line-height:1; }
.compare-metric.pos { color:var(--green-light); }
.compare-metric.neg { color:var(--danger); }
.compare-metric-label { font-size:11px; text-transform:uppercase; letter-spacing:1px; color:var(--text-muted); margin:6px 0 16px; }
.compare-substats { display:flex; justify-content:center; gap:16px; font-size:0.75rem; color:var(--text-secondary); border-top:1px solid var(--border-light); padding-top:14px; }
.compare-substats b { color:var(--white); display:block; font-size:0.85rem; font-family:'JetBrains Mono',monospace; }
.vs-divider { position:absolute; left:50%; top:50%; transform:translate(-50%,-50%); z-index:2;
  background:var(--dark-bg); border:1.5px solid var(--accent-gold); color:var(--accent-gold);
  font-weight:800; font-size:12px; padding:5px 11px; border-radius:999px; text-transform:uppercase;
  box-shadow:0 0 16px rgba(245,158,11,.35); }
.chart-watermark { display:flex; align-items:center; justify-content:space-between; margin-top:24px; padding-top:16px; border-top:1px solid var(--border-light); }
.wm-brand { font-weight:800; font-size:0.85rem; background:linear-gradient(135deg,var(--green-light),var(--green-primary));
  -webkit-background-clip:text; -webkit-text-fill-color:transparent; background-clip:text; }
.wm-note { font-family:'JetBrains Mono',monospace; font-size:0.68rem; color:var(--text-muted); }
.verdict { max-width:800px; margin:0 auto; }
.verdict p { color:var(--text-secondary); font-size:14.5px; margin-bottom:14px; }
.verdict strong { color:var(--green-light); }
.cta-row { display:flex; gap:12px; justify-content:center; flex-wrap:wrap; margin:26px 0 8px; }
.btn { display:inline-flex; align-items:center; gap:8px; padding:12px 24px; border-radius:10px;
  font-weight:800; font-size:0.88rem; text-decoration:none; }
.btn-primary { background:linear-gradient(135deg,var(--green-primary),var(--green-light)); color:var(--dark-bg);
  box-shadow:0 0 24px rgba(16,185,129,.4); }
.btn-outline { background:transparent; border:1.5px solid var(--green-primary); color:var(--green-light); }
.table-container { background:linear-gradient(135deg,rgba(16,185,129,0.06),rgba(16,185,129,0.02));
  border:1px solid var(--border-color); border-radius:14px; overflow-x:auto; box-shadow:0 8px 32px rgba(0,0,0,0.2); }
.table-header-label { font-size:12px; letter-spacing:1.5px; text-transform:uppercase; color:var(--green-light); font-weight:700;
  padding:20px 24px 16px; border-bottom:1px solid var(--border-color); display:block; }
table.detail-table { width:100%; border-collapse:collapse; min-width:640px; }
.detail-table th { padding:14px 12px; text-align:left; font-weight:700; font-size:11.5px; letter-spacing:0.6px;
  color:var(--green-light); text-transform:uppercase; border-right:1px solid var(--border-light);
  background:rgba(16,185,129,.04); white-space:nowrap; }
.detail-table th:last-child { border-right:none; }
.detail-table td { padding:12px; color:var(--text-primary); border-bottom:1px solid var(--border-light); font-size:0.86rem; }
.detail-table tr:last-child td { border-bottom:none; }
.mono { font-family:'JetBrains Mono',monospace; }
.faq-item { border:1px solid var(--border-color); border-radius:12px; padding:18px 20px; margin-bottom:12px;
  background:linear-gradient(135deg,rgba(16,185,129,0.06),rgba(16,185,129,0.02)); max-width:800px; margin-left:auto; margin-right:auto; }
.faq-item h3 { font-size:15px; font-weight:700; color:var(--green-light); margin-bottom:6px; }
.faq-item p { font-size:13.5px; color:var(--text-secondary); margin:0; }
.related-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(200px,1fr)); gap:12px; }
.related-link { display:block; padding:14px 16px; background:linear-gradient(135deg,rgba(16,185,129,0.08),rgba(16,185,129,0.04));
  border:1px solid var(--border-color); border-radius:10px; text-decoration:none; color:var(--text-primary);
  font-family:'JetBrains Mono',monospace; font-weight:700; font-size:0.85rem; text-align:center; }
.related-link:hover { border-color:var(--green-primary); color:var(--green-light); }
footer { background:linear-gradient(135deg,rgba(16,185,129,0.08),rgba(16,185,129,0.04));
  border-top:1px solid var(--border-color); padding:44px 0 26px; margin-top:auto; }
.footer-content { display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:24px;
  max-width:1100px; margin:0 auto; padding:0 32px; }
.footer-links { display:flex; gap:22px; flex-wrap:wrap; }
.footer-links a { color:var(--text-secondary); text-decoration:none; font-size:13px; }
.footer-links a:hover { color:var(--green-light); }
.footer-disclaimer { font-size:12.5px; color:var(--text-muted); max-width:640px; line-height:1.5; }
.footer-copyright { color:var(--text-muted); font-size:12.5px; white-space:nowrap; }
@media (max-width:768px) {
  .container { padding:0 16px; }
  .header-content { flex-direction:column; gap:8px; }
  .compare-versus { grid-template-columns:1fr; }
  .footer-content { flex-direction:column; text-align:center; }
}
`;

function headBlock({ title, description, canonicalPath }) {
  return `<head>
 <script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-9929351005136304" crossorigin="anonymous"></script>
 <!-- Google tag (gtag.js) -->
<script async src="https://www.googletagmanager.com/gtag/js?id=G-VYCX30S0EC"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  gtag('config', 'G-VYCX30S0EC');
</script>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="description" content="${esc(description)}">
    <title>${esc(title)}</title>
    <link rel="canonical" href="${BASE_URL}${canonicalPath}">
    <meta property="og:title" content="${esc(title)}">
    <meta property="og:description" content="${esc(description)}">
    <meta property="og:image" content="https://raw.githubusercontent.com/benjiesiegel1414/etftotalreturns/main/etf.png">
    <meta property="og:type" content="website">
    <meta property="og:url" content="${BASE_URL}${canonicalPath}">
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="${esc(title)}">
    <meta name="twitter:description" content="${esc(description)}">
    <meta name="twitter:image" content="https://raw.githubusercontent.com/benjiesiegel1414/etftotalreturns/main/etf.png">
    <meta name="twitter:site" content="@TopDividendETFs">
    <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">
    <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png">
    <link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png">
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Sora:wght@400;500;600;700;800&family=JetBrains+Mono:wght@500;600;700;900&display=swap" rel="stylesheet">
    <style>${SHARED_CSS}</style>
</head>`;
}

const HEADER_HTML = `<header><div class="container"><div class="header-content">
  <a href="/" class="logo">📈 ETF Total Returns</a>
  <a href="https://TopDividendETFsPRO.com" target="_blank" class="premium-btn">🌟 Premium</a>
</div></div></header>`;

const BANNER_HTML = `<div class="banner">
  <a href="https://vegasharesetfs.com/VAIE" target="_blank">
    <img src="https://raw.githubusercontent.com/benjiesiegel1414/etftotalreturns/main/vaie-ad-728x90px.png" alt="VAIE - Sponsored Advertisement">
  </a>
  <small>Sponsored by VegaShares</small>
</div>`;

const FOOTER_HTML = `<footer><div class="container"><div class="footer-content">
  <div class="footer-links">
    <a href="/terms.html">Terms of Use</a>
    <a href="/privacy.html">Privacy Policy</a>
    <a href="/faq.html">FAQ</a>
    <a href="/disclaimer.html">Disclaimer</a>
  </div>
  <div class="footer-disclaimer">
    This site is 100% free and for entertainment purposes only. All data is curated from public sources and may be inaccurate or delayed.
    Not financial advice. Past performance does not guarantee future results.
  </div>
  <p class="footer-copyright">© ${new Date().getFullYear()} ETF Total Returns. All rights reserved.</p>
</div></div></footer>`;

function sideCard(f, metric, isLeader) {
  const years = yearsSince(f.inceptionStr);
  return `<div class="compare-side ${isLeader ? 'leader' : ''}">
    ${isLeader ? '<div class="leader-tag">Higher Return</div>' : '<div class="leader-tag" style="visibility:hidden;">spacer</div>'}
    <div class="compare-badge">${esc(f.symbol.charAt(0))}</div>
    <div class="compare-ticker">${esc(f.symbol)}</div>
    <div class="compare-name">${esc(f.name || f.provider)}</div>
    <div class="compare-metric ${metric >= 0 ? 'pos' : 'neg'}">${pct(metric)}</div>
    <div class="compare-metric-label">Avg Annual Return</div>
    <div class="compare-substats">
      <div><b>${esc(f.yieldStr || '—')}</b>Yield</div>
      <div><b>${years ? esc(fmtYears(years)) : '—'}</b>Age</div>
      <div><b>${esc(f.taxGrade || f.rating || '—')}</b>Grade</div>
    </div>
  </div>`;
}

function detailRow(f) {
  const totalReturn = parseNum(f.totalReturnStr);
  const years = yearsSince(f.inceptionStr);
  const avg = avgAnnualReturn(f);
  return `<tr>
    <td class="mono" style="color:var(--green-light); font-weight:700;">${esc(f.symbol)}</td>
    <td>${esc(f.name)}</td>
    <td>${esc(f.provider)}</td>
    <td class="mono">${esc(f.inceptionStr || '—')}</td>
    <td class="mono">${years ? years.toFixed(1) + 'y' : '—'}</td>
    <td class="mono">${pct(totalReturn)}</td>
    <td class="mono" style="color:${avg >= 0 ? 'var(--green-light)' : 'var(--danger)'};">${pct(avg)}</td>
    <td class="mono">${esc(f.yieldStr || '—')}</td>
    <td class="mono">${esc(f.expenseRatio || '—')}</td>
    <td class="mono">${esc(f.taxGrade || f.rating || '—')}</td>
  </tr>`;
}

function matchupPage(a, b, relatedSlugs) {
  // a, b sorted alphabetically already; winner determined by metric
  const aR = avgAnnualReturn(a), bR = avgAnnualReturn(b);
  const [winner, loser] = aR >= bR ? [a, b] : [b, a];
  const [wR, lR] = aR >= bR ? [aR, bR] : [bR, aR];
  const slug = `${a.symbol.toLowerCase()}-vs-${b.symbol.toLowerCase()}`;
  const canonicalPath = `/vs/${slug}.html`;
  const year = new Date().getFullYear();
  const updated = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  const title = `${a.symbol} vs ${b.symbol}: Which ETF Has Better Total Returns? (${year})`;
  const description = `${a.symbol} vs ${b.symbol} compared side by side: ${winner.symbol} averages ${pct(wR)} per year since inception vs ${loser.symbol}'s ${pct(lR)}. Yield, age, and total return comparison.`;

  const verdictParas = buildVerdict(winner, loser, wR, lR);

  const faq = [
    {
      q: `Which is better, ${a.symbol} or ${b.symbol}?`,
      aHtml: `By average annual total return since inception, ${esc(winner.symbol)} ${marginPhrase(wR - lR)} ${esc(loser.symbol)} (${pct(wR)} vs ${pct(lR)} per year). "Better" depends on your goals — yield, payout frequency, and strategy differ between the two funds.`,
    },
    {
      q: `What is the difference between ${a.symbol} and ${b.symbol}?`,
      aHtml: `${esc(a.symbol)} (${esc(a.name)}) is offered by ${esc(a.provider)} and currently yields ${esc(a.yieldStr || 'N/A')}. ${esc(b.symbol)} (${esc(b.name)}) is offered by ${esc(b.provider)} and yields ${esc(b.yieldStr || 'N/A')}. Their average annual total returns since inception are ${pct(aR)} and ${pct(bR)} respectively.`,
    },
    {
      q: `Does ${winner.symbol} pay a higher dividend than ${loser.symbol}?`,
      aHtml: `${esc(winner.symbol)} currently yields ${esc(winner.yieldStr || 'N/A')} and ${esc(loser.symbol)} yields ${esc(loser.yieldStr || 'N/A')}. Remember that yield alone doesn't capture performance — total return (price + dividends) is the fairer comparison.`,
    },
  ];

  const faqSchema = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faq.map(x => ({
      '@type': 'Question',
      name: x.q,
      acceptedAnswer: { '@type': 'Answer', text: x.aHtml.replace(/<[^>]+>/g, '') },
    })),
  };

  const relatedHtml = relatedSlugs.length
    ? `<section class="section"><div class="container">
        <h2>Related ETF Comparisons</h2>
        <div class="related-grid">
          ${relatedSlugs.map(r => `<a class="related-link" href="/vs/${r.slug}.html">${esc(r.label)}</a>`).join('\n          ')}
        </div>
      </div></section>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
${headBlock({ title, description, canonicalPath })}
<body>
${HEADER_HTML}
<main>
  <section class="hero"><div class="container">
    <a href="/vs/" class="back-link">← All ETF Comparisons</a>
    <h1>${esc(a.symbol)} vs ${esc(b.symbol)}: ETF Comparison</h1>
    <p class="hero-subtitle">
      Compare <strong>${esc(a.symbol)}</strong> (${esc(a.name)}) and <strong>${esc(b.symbol)}</strong> (${esc(b.name)}) side by side by
      <strong>average annual total return since inception</strong> — one fair number covering price and dividends.
    </p>
    <p class="updated-tag">Updated ${updated}</p>
    <p class="hero-subtitle"><em>*For entertainment purposes ONLY! NOT financial advice! Data may be inaccurate.*</em></p>
  </div></section>

  <div class="container">${BANNER_HTML}</div>

  <section class="section"><div class="container">
    <div class="chart-card">
      <div class="kicker">Average Annual Total Return · Since Inception</div>
      <div class="compare-wrap">
        <div class="compare-versus">
          ${sideCard(winner, wR, true)}
          ${sideCard(loser, lR, false)}
        </div>
        <div class="vs-divider">vs</div>
      </div>
      <div class="chart-watermark">
        <div class="wm-brand">📈 ETF Total Returns</div>
        <div class="wm-note">${updated}</div>
      </div>
    </div>
    <div class="cta-row">
      <a class="btn btn-primary" href="/compare.html?tickers=${a.symbol},${b.symbol}">⚡ Open in Interactive Tool</a>
      <a class="btn btn-outline" href="/vs/">Browse All Matchups</a>
    </div>
  </div></section>

  <section class="section"><div class="container"><div class="verdict">
    <h2>${esc(a.symbol)} vs ${esc(b.symbol)}: The Verdict</h2>
    ${verdictParas.map(p => `<p>${p}</p>`).join('\n    ')}
  </div></div></section>

  <div class="container">${BANNER_HTML}</div>

  <section class="section"><div class="container">
    <h2>${esc(a.symbol)} vs ${esc(b.symbol)} Side-by-Side Data</h2>
    <div class="table-container">
      <span class="table-header-label">Comparison Breakdown</span>
      <div style="overflow-x:auto;">
        <table class="detail-table">
          <thead><tr>
            <th>Symbol</th><th>Name</th><th>Provider</th><th>Inception</th><th>Age</th>
            <th>Total Return</th><th>Avg. Annual Return</th><th>Yield</th><th>Expense Ratio</th><th>Grade</th>
          </tr></thead>
          <tbody>
            ${detailRow(a)}
            ${detailRow(b)}
          </tbody>
        </table>
      </div>
    </div>
  </section></div>

  <section class="section"><div class="container">
    <h2 style="text-align:center;">${esc(a.symbol)} vs ${esc(b.symbol)} — Frequently Asked Questions</h2>
    ${faq.map(x => `<div class="faq-item"><h3>${esc(x.q)}</h3><p>${x.aHtml}</p></div>`).join('\n    ')}
  </div></section>

  ${relatedHtml}
</main>
${FOOTER_HTML}
<script type="application/ld+json">${JSON.stringify(faqSchema)}</script>
</body>
</html>`;
}

/* ════════════════ HUB PAGE ════════════════ */

function hubPage(pairs) {
  const year = new Date().getFullYear();
  const updated = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const title = `ETF Comparisons: ${pairs.length} Head-to-Head Matchups (${year}) | ETF Total Returns`;
  const description = `Browse ${pairs.length} ETF vs ETF comparisons — SCHD vs VYM, JEPI vs JEPQ, and more — ranked by average annual total return since inception.`;

  // Group by first ticker for scannability
  const byFirst = {};
  pairs.forEach(p => {
    const key = p.a.symbol;
    (byFirst[key] = byFirst[key] || []).push(p);
  });
  const groups = Object.keys(byFirst).sort();

  return `<!DOCTYPE html>
<html lang="en">
${headBlock({ title, description, canonicalPath: '/vs/' })}
<body>
${HEADER_HTML}
<main>
  <section class="hero"><div class="container">
    <a href="/compare.html" class="back-link">← Interactive Comparison Tool</a>
    <h1>ETF vs ETF: Every Comparison</h1>
    <p class="hero-subtitle">
      ${pairs.length} head-to-head ETF matchups, each compared by <strong>average annual total return since inception</strong>.
      Pick a matchup or build your own in the <a href="/compare.html" style="color:var(--green-light);">interactive tool</a>.
    </p>
    <p class="updated-tag">Updated ${updated}</p>
  </div></section>

  <div class="container">${BANNER_HTML}</div>

  ${groups.map(g => `<section class="section"><div class="container">
    <h2>${esc(g)} Comparisons</h2>
    <div class="related-grid">
      ${byFirst[g].map(p => `<a class="related-link" href="/vs/${p.slug}.html">${esc(p.a.symbol)} vs ${esc(p.b.symbol)}</a>`).join('\n      ')}
    </div>
  </div></section>`).join('\n')}
</main>
${FOOTER_HTML}
</body>
</html>`;
}

/* ════════════════ MAIN ════════════════ */

async function main() {
  console.log('Fetching CSV…');
  let text;
  if (process.env.LOCAL_CSV) {
    text = fs.readFileSync(process.env.LOCAL_CSV, 'utf8');
    console.log('(using LOCAL_CSV file for testing)');
  } else {
    const res = await fetch(CSV_URL + '&t=' + Date.now());
    if (!res.ok) throw new Error('CSV fetch failed: ' + res.status);
    text = await res.text();
  }

  const funds = parseCSV(text);
  console.log(`Parsed ${funds.length} funds.`);

  const bySym = {};
  funds.forEach(f => { bySym[f.symbol.toUpperCase()] = f; });

  // Build pair set: top-N-by-AUM pairs + priority pairs, deduped, alphabetical order
  const topN = [...funds].sort((x, y) => parseAUM(y.aum) - parseAUM(x.aum)).slice(0, TOP_N_BY_AUM);
  const pairKeys = new Set();
  const pairs = [];

  function addPair(s1, s2) {
    const A = bySym[s1.toUpperCase()], B = bySym[s2.toUpperCase()];
    if (!A || !B || A.symbol === B.symbol) return;
    const [a, b] = [A, B].sort((x, y) => x.symbol.localeCompare(y.symbol));
    const key = a.symbol + '|' + b.symbol;
    if (pairKeys.has(key)) return;
    pairKeys.add(key);
    pairs.push({ a, b, slug: `${a.symbol.toLowerCase()}-vs-${b.symbol.toLowerCase()}` });
  }

  for (let i = 0; i < topN.length; i++)
    for (let j = i + 1; j < topN.length; j++)
      addPair(topN[i].symbol, topN[j].symbol);

  PRIORITY_PAIRS.forEach(([s1, s2]) => addPair(s1, s2));

  console.log(`Generating ${pairs.length} matchup pages…`);

  // Wipe and recreate output dir so removed funds don't leave stale pages
  fs.rmSync(OUT_DIR, { recursive: true, force: true });
  fs.mkdirSync(OUT_DIR, { recursive: true });

  // Related matchups: other pairs sharing a ticker, capped at 12
  function related(pair) {
    return pairs
      .filter(p => p !== pair && (p.a.symbol === pair.a.symbol || p.b.symbol === pair.a.symbol || p.a.symbol === pair.b.symbol || p.b.symbol === pair.b.symbol))
      .slice(0, 12)
      .map(p => ({ slug: p.slug, label: `${p.a.symbol} vs ${p.b.symbol}` }));
  }

  pairs.forEach(pair => {
    const html = matchupPage(pair.a, pair.b, related(pair));
    fs.writeFileSync(path.join(OUT_DIR, pair.slug + '.html'), html);
  });

  fs.writeFileSync(path.join(OUT_DIR, 'index.html'), hubPage(pairs));

  // Sitemap
  const today = new Date().toISOString().slice(0, 10);
  const urls = [`${BASE_URL}/vs/`, ...pairs.map(p => `${BASE_URL}/vs/${p.slug}.html`)];
  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(u => `  <url><loc>${u}</loc><lastmod>${today}</lastmod><changefreq>daily</changefreq></url>`).join('\n')}
</urlset>
`;
  fs.writeFileSync(SITEMAP_FILE, sitemap);

  console.log(`Done. ${pairs.length} pages + hub + sitemap-matchups.xml`);
}

main().catch(e => { console.error(e); process.exit(1); });
