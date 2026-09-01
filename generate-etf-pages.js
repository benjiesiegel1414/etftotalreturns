/**
 * generate-etf-pages.js
 * ---------------------------------------------------------------
 * Builds a static scorecard page for every ETF in the Google Sheet.
 *
 *   Output:  /etf/spyi.html, /etf/schd.html, ... plus /etf/index.html
 *
 * Run:      node generate-etf-pages.js
 * ---------------------------------------------------------------
 */

const fs = require('fs');
const path = require('path');

const CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vTxCiod-Cwry7E6k9Un9dgrM_ANymC36_IO_wLyNj-YDo2KI7mp_1ZzyNBnBGZOxT48QPM8TCwtsmA4/pub?gid=0&single=true&output=csv';

const OUT_DIR = path.join(__dirname, 'etf');
const SITE = 'https://etftotalreturns.com';

/* ═══════════════════════════════════════════════════════════════
   MATCHUP TICKERS
   Only tickers listed here will get /vs/ links generated, so we
   never link to a matchup page that doesn't exist.
   Add tickers here as you add matchup pages in /vs/.
   ═══════════════════════════════════════════════════════════════ */
const VS_TICKERS = [
  'SCHD','VYM','VIG','DGRO','VOO','SPY','JEPI','JEPQ','QYLD','XYLD',
  'RYLD','SPYI','QQQI','DIVO','GPIX','GPIQ','SCHY','HDV','DVY','SDY',
  'NOBL','FDVV','SPHD','JEPY','QQQ','VTI','DGRW','PEY','SPYD'
];

/* ═══════════════════════════════════════════════════════════════
   PROMO SLOT
   House promo for TopDividendETFsPRO.com. No paid display ads.
   Set enabled:false to strip the slot from every generated page at once.
   ═══════════════════════════════════════════════════════════════ */
const PROMO = {
  enabled: true,
  href: 'https://TopDividendETFsPRO.com'
};

/* ───────────────────────────── helpers ───────────────────────── */

function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { cur += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      out.push(cur.trim());
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur.trim());
  return out;
}

function num(v) {
  if (v === undefined || v === null) return NaN;
  const n = parseFloat(String(v).replace(/[%$,\s]/g, ''));
  return isNaN(n) ? NaN : n;
}

function esc(s) {
  return String(s === undefined || s === null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function slug(sym) {
  return String(sym).toLowerCase().replace(/[^a-z0-9]/g, '');
}

function yearsSince(inceptionStr) {
  if (!inceptionStr || inceptionStr === 'N/A') return NaN;
  const p = String(inceptionStr).trim().split('/');
  if (p.length !== 3) return NaN;
  const d = new Date(parseInt(p[2], 10), parseInt(p[0], 10) - 1, parseInt(p[1], 10));
  if (isNaN(d.getTime())) return NaN;
  const yrs = (Date.now() - d.getTime()) / (1000 * 60 * 60 * 24 * 365.25);
  return yrs > 0 ? yrs : NaN;
}

function annualizedFrom(totalReturn, inceptionStr) {
  const t = num(totalReturn);
  const yrs = yearsSince(inceptionStr);
  if (isNaN(t) || isNaN(yrs)) return NaN;
  return (Math.pow(1 + t / 100, 1 / yrs) - 1) * 100;
}

function fmtPct(v, dp = 2) {
  return isNaN(v) ? 'N/A' : v.toFixed(dp) + '%';
}

/* ───────────────────────── scoring model ─────────────────────── */
/*
   Three components, 100 points total. The model deliberately
   rewards funds whose annualized return exceeds their yield —
   that's the whole thesis of the site.
*/
function scoreReturn(a) {
  if (isNaN(a)) return 0;
  if (a >= 20) return 50;
  if (a >= 15) return 45;
  if (a >= 12) return 40;
  if (a >= 10) return 35;
  if (a >= 8) return 29;
  if (a >= 6) return 23;
  if (a >= 4) return 17;
  if (a >= 2) return 11;
  if (a > 0) return 5;
  return 0;
}

function scoreTotal(t) {
  if (isNaN(t)) return 0;
  if (t >= 200) return 25;
  if (t >= 120) return 22;
  if (t >= 70) return 19;
  if (t >= 40) return 16;
  if (t >= 20) return 13;
  if (t >= 10) return 10;
  if (t >= 5) return 7;
  if (t > 0) return 4;
  return 0;
}

function scoreSustain(a, y) {
  if (isNaN(a)) return 0;
  if (isNaN(y) || y <= 0) return 12;
  const ratio = a / y;
  if (ratio >= 1.5) return 25;
  if (ratio >= 1.2) return 22;
  if (ratio >= 1.0) return 18;
  if (ratio >= 0.8) return 13;
  if (ratio >= 0.6) return 8;
  if (ratio >= 0.4) return 4;
  return 0;
}

function gradeFor(score) {
  if (score >= 90) return { letter: 'A+', tone: 'elite' };
  if (score >= 82) return { letter: 'A',  tone: 'elite' };
  if (score >= 75) return { letter: 'A-', tone: 'strong' };
  if (score >= 68) return { letter: 'B+', tone: 'strong' };
  if (score >= 60) return { letter: 'B',  tone: 'strong' };
  if (score >= 53) return { letter: 'B-', tone: 'fair' };
  if (score >= 46) return { letter: 'C+', tone: 'fair' };
  if (score >= 38) return { letter: 'C',  tone: 'fair' };
  if (score >= 30) return { letter: 'C-', tone: 'weak' };
  if (score >= 22) return { letter: 'D',  tone: 'weak' };
  return { letter: 'F', tone: 'weak' };
}

function verdictFor(e) {
  const a = e.annual, y = e.yieldNum;
  if (isNaN(a)) return 'Not enough history to judge this fund on total return yet.';
  if (!isNaN(y) && y > 0 && a >= y * 1.2) {
    return 'Total return is comfortably ahead of the distribution rate — this fund has been growing capital while paying you.';
  }
  if (!isNaN(y) && y > 0 && a >= y) {
    return 'Total return edges out the distribution rate. The income has not been coming out of your principal.';
  }
  if (!isNaN(y) && y > 0 && a > 0) {
    return 'The distribution rate is higher than the annualized total return — part of that yield is being funded by NAV decay.';
  }
  if (a > 0) return 'Positive total return since inception.';
  return 'Negative total return since inception. The headline yield has not made investors whole.';
}

/* ───────────────────────── shared chrome ─────────────────────── */

const STYLES = `
    *{margin:0;padding:0;box-sizing:border-box}
    :root{--dark-bg:#0A1F1E;--surface-dark:#0F2A28;--surface-light:#152D2A;--green-primary:#10B981;--green-light:#34D399;--green-dark:#059669;--white:#fff;--text-primary:#fff;--text-secondary:#E5E7EB;--text-muted:#9CA3AF;--border-color:rgba(16,185,129,.2);--border-light:rgba(16,185,129,.15);--danger:#EF4444;--accent-gold:#F59E0B}
    html,body{margin:0;padding:0;overflow-x:hidden}
    body{font-family:'Sora',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:linear-gradient(135deg,var(--dark-bg) 0%,var(--surface-dark) 50%,var(--dark-bg) 100%);background-attachment:fixed;color:var(--text-primary);display:flex;flex-direction:column;min-height:100vh;line-height:1.6}
    body::before{content:'';position:fixed;inset:0;background:radial-gradient(circle at 20% 50%,rgba(16,185,129,.08) 0%,transparent 50%),radial-gradient(circle at 80% 80%,rgba(16,185,129,.05) 0%,transparent 50%);pointer-events:none;z-index:0}
    .container{width:100%;max-width:1200px;margin:0 auto;padding:0 32px;position:relative;z-index:1}
    a{color:inherit}
    header{position:sticky;top:0;z-index:1000;background:rgba(10,31,30,.9);backdrop-filter:blur(20px);border-bottom:1px solid var(--border-color);padding:16px 0;box-shadow:0 8px 32px rgba(0,0,0,.4)}
    .header-content{display:flex;justify-content:space-between;align-items:center;gap:16px}
    .header-buttons{display:flex;gap:12px;align-items:center}
    .logo{font-size:20px;font-weight:800;letter-spacing:-.5px;background:linear-gradient(135deg,var(--green-light),var(--green-primary));-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;text-decoration:none}
    .compare-btn{padding:10px 20px;background:linear-gradient(135deg,var(--green-primary),var(--green-light));color:var(--dark-bg);font-weight:800;font-size:14px;text-decoration:none;border-radius:8px;box-shadow:0 0 20px rgba(16,185,129,.4);white-space:nowrap;transition:all .3s}
    .compare-btn:hover{transform:translateY(-2px);box-shadow:0 0 35px rgba(16,185,129,.6)}
    .matchups-btn{padding:10px 20px;background:transparent;color:var(--green-light);font-weight:800;font-size:14px;text-decoration:none;border-radius:8px;border:1.5px solid var(--green-primary);white-space:nowrap;transition:all .3s}
    .matchups-btn:hover{transform:translateY(-2px);background:rgba(16,185,129,.1)}
    .premium-btn{padding:10px 20px;background:linear-gradient(135deg,#F59E0B,#FBBF24);color:var(--dark-bg);font-weight:800;font-size:14px;text-decoration:none;border-radius:8px;box-shadow:0 0 20px rgba(245,158,11,.4);white-space:nowrap;transition:all .3s}
    .premium-btn:hover{transform:translateY(-2px);box-shadow:0 0 35px rgba(245,158,11,.6)}
    .pro-bar{width:90%;max-width:1000px;margin:24px auto 32px;padding:18px 24px;display:flex;align-items:center;justify-content:space-between;gap:20px;background:linear-gradient(135deg,rgba(245,158,11,.12),rgba(16,185,129,.05));border:1.5px solid rgba(245,158,11,.3);border-radius:14px;text-decoration:none;color:var(--text-primary);transition:all .3s}
    .pro-bar:hover{border-color:var(--accent-gold);box-shadow:0 8px 32px rgba(245,158,11,.18);transform:translateY(-2px)}
    .pro-bar-left{display:flex;align-items:center;gap:16px;min-width:0}
    .pro-badge{flex-shrink:0;background:var(--accent-gold);color:var(--dark-bg);font-size:11px;font-weight:900;letter-spacing:1.5px;padding:5px 12px;border-radius:20px}
    .pro-bar-copy strong{display:block;font-size:16px;font-weight:800;color:var(--accent-gold);line-height:1.3;margin-bottom:3px}
    .pro-bar-copy span{display:block;font-size:13.5px;color:var(--text-secondary);line-height:1.45}
    .pro-bar-cta{flex-shrink:0;padding:11px 22px;background:linear-gradient(135deg,#F59E0B,#FBBF24);color:var(--dark-bg);font-weight:800;font-size:14px;border-radius:10px;white-space:nowrap;box-shadow:0 0 20px rgba(245,158,11,.35);transition:all .3s}
    .pro-bar:hover .pro-bar-cta{box-shadow:0 0 32px rgba(245,158,11,.55)}
    .pro-card-promo{width:90%;max-width:1000px;margin:24px auto 32px;padding:34px 28px;display:block;text-align:center;background:linear-gradient(135deg,rgba(245,158,11,.1),rgba(16,185,129,.05));border:1.5px solid rgba(245,158,11,.3);border-radius:14px;text-decoration:none;color:var(--text-primary);transition:all .3s}
    .pro-card-promo:hover{border-color:var(--accent-gold);box-shadow:0 8px 32px rgba(245,158,11,.18);transform:translateY(-3px)}
    .pro-card-promo h3{font-size:24px;font-weight:800;margin:14px 0 10px;line-height:1.25;color:#FBBF24}
    .pro-card-promo p{font-size:14px;color:var(--text-secondary);max-width:620px;margin:0 auto 20px;line-height:1.6}
    .pro-chips{display:flex;flex-wrap:wrap;gap:9px;justify-content:center;margin-bottom:24px}
    .pro-chips span{padding:8px 15px;background:var(--surface-dark);border:1px solid rgba(245,158,11,.25);border-radius:999px;color:#FBBF24;font-family:'JetBrains Mono',monospace;font-size:12.5px;font-weight:700}
    .pro-card-cta{display:inline-block;padding:13px 30px;background:linear-gradient(135deg,#F59E0B,#FBBF24);color:var(--dark-bg);font-weight:800;font-size:15px;border-radius:10px;box-shadow:0 0 24px rgba(245,158,11,.4);transition:all .3s}
    .pro-card-promo:hover .pro-card-cta{box-shadow:0 0 38px rgba(245,158,11,.6)}
    @media (max-width:760px){.pro-bar,.pro-card-promo{width:100%;max-width:none;margin:16px auto 24px}.pro-bar{flex-direction:column;align-items:stretch;text-align:center;gap:14px;padding:18px}.pro-bar-left{flex-direction:column;gap:10px}.pro-bar-cta{text-align:center}.pro-card-promo{padding:26px 18px}.pro-card-promo h3{font-size:19px}.pro-chips span{font-size:11.5px;padding:7px 12px}}
    .crumbs{padding:20px 0 0;font-size:13px;color:var(--text-muted)}
    .crumbs a{color:var(--green-light);text-decoration:none}
    .crumbs a:hover{text-decoration:underline}
    .scorecard-hero{display:grid;grid-template-columns:auto 1fr;gap:32px;align-items:center;padding:32px 0 8px}
    .grade-orb{width:150px;height:150px;border-radius:50%;display:flex;flex-direction:column;align-items:center;justify-content:center;font-weight:900;border:4px solid;position:relative}
    .grade-orb .letter{font-size:56px;line-height:1;letter-spacing:-2px}
    .grade-orb .out-of{font-size:12px;font-weight:700;letter-spacing:1px;text-transform:uppercase;opacity:.85;margin-top:6px}
    .tone-elite{border-color:var(--green-primary);color:var(--green-light);background:radial-gradient(circle,rgba(16,185,129,.22),rgba(16,185,129,.05));box-shadow:0 0 50px rgba(16,185,129,.35)}
    .tone-strong{border-color:var(--green-dark);color:var(--green-light);background:radial-gradient(circle,rgba(16,185,129,.14),rgba(16,185,129,.03));box-shadow:0 0 40px rgba(16,185,129,.22)}
    .tone-fair{border-color:var(--accent-gold);color:var(--accent-gold);background:radial-gradient(circle,rgba(245,158,11,.14),rgba(245,158,11,.03));box-shadow:0 0 40px rgba(245,158,11,.22)}
    .tone-weak{border-color:var(--danger);color:var(--danger);background:radial-gradient(circle,rgba(239,68,68,.14),rgba(239,68,68,.03));box-shadow:0 0 40px rgba(239,68,68,.22)}
    .ticker-line{font-family:'JetBrains Mono',monospace;font-size:clamp(38px,6vw,60px);font-weight:900;letter-spacing:-1px;line-height:1;background:linear-gradient(135deg,var(--green-light),var(--white));-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}
    .fund-name{font-size:18px;color:var(--text-secondary);margin-top:8px;font-weight:500}
    .verdict{margin-top:16px;padding:14px 18px;border-left:3px solid var(--green-primary);background:rgba(16,185,129,.07);border-radius:0 10px 10px 0;font-size:15px;color:var(--text-secondary)}
    .metrics-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(165px,1fr));gap:16px;margin:36px 0 8px}
    .metric{background:linear-gradient(135deg,rgba(16,185,129,.08),rgba(16,185,129,.03));border:1px solid var(--border-color);border-radius:14px;padding:20px 18px;text-align:center}
    .metric .lbl{font-size:11px;letter-spacing:1.2px;text-transform:uppercase;color:var(--text-muted);font-weight:700;margin-bottom:10px}
    .metric .val{font-family:'JetBrains Mono',monospace;font-size:26px;font-weight:900;line-height:1.1}
    .metric .sub{font-size:11px;color:var(--text-muted);margin-top:6px}
    .pos{color:var(--green-light)}.neg{color:var(--danger)}.neutral{color:var(--white)}.gold{color:var(--accent-gold)}
    .section{margin:56px 0}
    .sec-title{font-size:24px;font-weight:800;margin-bottom:8px;display:flex;align-items:center;gap:10px}
    .sec-sub{color:var(--text-muted);font-size:14px;margin-bottom:24px;max-width:720px}
    .panel{background:linear-gradient(135deg,rgba(16,185,129,.06),rgba(16,185,129,.02));border:1px solid var(--border-color);border-radius:16px;padding:28px}
    .bar-row{margin-bottom:22px}
    .bar-row:last-child{margin-bottom:0}
    .bar-head{display:flex;justify-content:space-between;font-size:13px;font-weight:700;margin-bottom:8px}
    .bar-head .pts{font-family:'JetBrains Mono',monospace;color:var(--green-light)}
    .bar-track{height:10px;background:rgba(255,255,255,.07);border-radius:999px;overflow:hidden}
    .bar-fill{height:100%;border-radius:999px;background:linear-gradient(90deg,var(--green-dark),var(--green-light))}
    .bar-note{font-size:12px;color:var(--text-muted);margin-top:7px}
    .calc-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:18px;margin-bottom:26px}
    .calc-field label{display:block;font-size:11px;letter-spacing:1.2px;text-transform:uppercase;color:var(--text-muted);font-weight:700;margin-bottom:9px}
    .calc-field input,.calc-field select{width:100%;padding:13px 15px;background:var(--surface-dark);border:1.5px solid var(--border-light);color:var(--text-primary);border-radius:10px;font-family:'JetBrains Mono',monospace;font-size:16px;outline:none;transition:all .3s}
    .calc-field input:focus,.calc-field select:focus{border-color:var(--green-primary);box-shadow:0 0 0 3px rgba(16,185,129,.15)}
    .calc-out{display:grid;grid-template-columns:repeat(auto-fit,minmax(155px,1fr));gap:14px}
    .calc-cell{background:rgba(16,185,129,.08);border:1px solid var(--border-color);border-radius:12px;padding:18px 14px;text-align:center}
    .calc-cell .k{font-size:10.5px;letter-spacing:1.1px;text-transform:uppercase;color:var(--text-muted);font-weight:700;margin-bottom:9px}
    .calc-cell .v{font-family:'JetBrains Mono',monospace;font-size:22px;font-weight:900;color:var(--green-light)}
    .calc-disclaim{margin-top:18px;font-size:12px;color:var(--text-muted);line-height:1.6}
    .vs-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(215px,1fr));gap:12px}
    .vs-card{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:15px 17px;background:var(--surface-dark);border:1px solid var(--border-color);border-radius:12px;text-decoration:none;transition:all .25s}
    .vs-card:hover{border-color:var(--green-primary);background:rgba(16,185,129,.1);transform:translateY(-3px)}
    .vs-card .pair{font-family:'JetBrains Mono',monospace;font-weight:800;font-size:13.5px;color:var(--green-light)}
    .vs-card .go{color:var(--text-muted);font-size:15px}
    .peer-table{width:100%;border-collapse:collapse;font-size:15px}
    .peer-table th{text-align:left;padding:14px 12px;font-size:11.5px;letter-spacing:.9px;text-transform:uppercase;color:var(--green-light);font-weight:700;border-bottom:2px solid var(--border-color)}
    .peer-table th.c,.peer-table td.c{text-align:center}
    .peer-table td{padding:13px 12px;border-bottom:1px solid rgba(16,185,129,.1)}
    .peer-table tr:last-child td{border-bottom:none}
    .peer-table tbody tr{transition:background .25s;cursor:pointer}
    .peer-table tbody tr:hover{background:rgba(16,185,129,.08)}
    .peer-table a{text-decoration:none;font-family:'JetBrains Mono',monospace;font-weight:900;color:var(--white)}
    .peer-table tbody tr:hover a{color:var(--green-light)}
    .peer-name{color:var(--text-secondary);font-size:13.5px}
    .az-wrap{display:flex;flex-wrap:wrap;gap:8px}
    .az-chip{padding:8px 14px;background:var(--surface-dark);border:1px solid var(--border-light);border-radius:999px;font-family:'JetBrains Mono',monospace;font-weight:700;font-size:12.5px;color:var(--green-light);text-decoration:none;transition:all .2s}
    .az-chip:hover{border-color:var(--green-primary);background:rgba(16,185,129,.12);transform:translateY(-2px)}
    .faq-item{border-bottom:1px solid var(--border-light);padding:20px 0}
    .faq-item:last-child{border-bottom:none}
    .faq-q{font-weight:800;font-size:16px;margin-bottom:9px;color:var(--white)}
    .faq-a{color:var(--text-secondary);font-size:14.5px;line-height:1.7}
    .site-cards-grid{display:grid;grid-template-columns:1fr;gap:16px}
    @media(min-width:640px){.site-cards-grid{grid-template-columns:repeat(2,1fr)}}
    @media(min-width:1024px){.site-cards-grid{grid-template-columns:repeat(auto-fit,minmax(240px,1fr))}}
    .network-card{background:linear-gradient(135deg,rgba(16,185,129,.08),rgba(16,185,129,.04));border:1.5px solid var(--border-color);border-radius:14px;padding:22px 18px;text-decoration:none;color:var(--text-primary);display:flex;flex-direction:column;align-items:center;text-align:center;transition:all .3s}
    .network-card:hover{border-color:var(--green-primary);transform:translateY(-4px);box-shadow:0 8px 32px rgba(16,185,129,.2)}
    .network-card.pro-card{background:linear-gradient(135deg,rgba(245,158,11,.1),rgba(245,158,11,.05));border-color:rgba(245,158,11,.3)}
    .network-card.pro-card:hover{border-color:var(--accent-gold)}
    .card-icon{font-size:30px;margin-bottom:10px}
    .card-name{font-weight:800;font-size:14.5px;color:var(--green-light);margin-bottom:7px}
    .network-card.pro-card .card-name{color:var(--accent-gold)}
    .card-desc{font-size:12.5px;color:var(--text-secondary);line-height:1.5;flex:1}
    footer{background:linear-gradient(135deg,rgba(16,185,129,.08),rgba(16,185,129,.04));border-top:1px solid var(--border-color);padding:50px 0 30px;margin-top:auto}
    .footer-content{display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:26px}
    .footer-links{display:flex;gap:22px;flex-wrap:wrap}
    .footer-links a{color:var(--text-secondary);text-decoration:none;font-size:13.5px}
    .footer-links a:hover{color:var(--green-light)}
    .footer-disclaimer{font-size:12.5px;color:var(--text-muted);max-width:640px;line-height:1.55}
    .footer-copyright{color:var(--text-muted);font-size:12.5px;white-space:nowrap}
    @media(max-width:820px){
      .container{padding:0 16px}
      .header-content{flex-direction:column;gap:8px}
      .header-buttons{width:100%;flex-direction:column;gap:8px}
      .compare-btn,.matchups-btn,.premium-btn{width:100%;text-align:center;font-size:12px;padding:9px 14px}
      .scorecard-hero{grid-template-columns:1fr;justify-items:center;text-align:center;gap:20px}
      .grade-orb{width:120px;height:120px}
      .grade-orb .letter{font-size:44px}
      .verdict{text-align:left}
      .peer-table{font-size:13.5px}
      .peer-table th,.peer-table td{padding:11px 8px}
      .footer-content{flex-direction:column;text-align:center}
    }
`;

function headerHtml() {
  return `<header>
    <div class="container">
      <div class="header-content">
        <a href="/" class="logo">📈 ETF Total Returns</a>
        <div class="header-buttons">
          <a href="/vs/" class="matchups-btn">🥊 ETF Matchups</a>
          <a href="/compare.html" class="compare-btn">⚖️ Compare ETFs</a>
          <a href="https://TopDividendETFsPRO.com" target="_blank" rel="noopener" class="premium-btn">🌟 Premium</a>
        </div>
      </div>
    </div>
  </header>`;
}

function proBarHtml() {
  if (!PROMO.enabled) return '';
  return `<a href="${PROMO.href}" target="_blank" rel="noopener" class="pro-bar">
  <div class="pro-bar-left">
    <span class="pro-badge">PRO</span>
    <div class="pro-bar-copy">
      <strong>See the numbers this page doesn't show</strong>
      <span>Tax treatment, AUM, price decay, and advanced filtering &mdash; updated daily.</span>
    </div>
  </div>
  <span class="pro-bar-cta">Go PRO &rarr;</span>
</a>`;
}

function proCardHtml() {
  if (!PROMO.enabled) return '';
  return `<a href="${PROMO.href}" target="_blank" rel="noopener" class="pro-card-promo">
  <span class="pro-badge">PRO</span>
  <h3>The full ETF terminal, updated every day</h3>
  <p>This page gives you yields and total returns. TopDividendETFsPRO.com gives you everything else &mdash; the data set behind the whole network, in one filterable, sortable terminal.</p>
  <div class="pro-chips">
    <span>Dividend Yield</span><span>Total Return</span><span>Tax Treatment</span><span>AUM</span>
    <span>Inception Date</span><span>Price Decay</span><span>Advanced Filtering</span><span>Daily Updates</span>
  </div>
  <span class="pro-card-cta">Explore PRO &rarr;</span>
</a>`;
}

function networkHtml() {
  return `<section class="section">
    <h2 class="sec-title">🌐 More Dividend Research</h2>
    <p class="sec-sub">Built by dividend investors. For dividend investors.</p>
    <div class="site-cards-grid">
      <a href="https://topdividendetfs.com" target="_blank" rel="noopener" class="network-card">
        <div class="card-icon">📊</div><div class="card-name">TopDividendETFs.com</div>
        <div class="card-desc">Rankings of the top dividend ETFs by yield, growth, and reliability.</div>
      </a>
      <a href="https://weeklyetfs.com" target="_blank" rel="noopener" class="network-card">
        <div class="card-icon">📅</div><div class="card-name">WeeklyETFs.com</div>
        <div class="card-desc">Every ETF that pays a dividend each and every week.</div>
      </a>
      <a href="https://monthlyetfs.com" target="_blank" rel="noopener" class="network-card">
        <div class="card-icon">📆</div><div class="card-name">MonthlyETFs.com</div>
        <div class="card-desc">Match your dividend income to your monthly bills.</div>
      </a>
      <a href="https://topdividendtools.com" target="_blank" rel="noopener" class="network-card">
        <div class="card-icon">🛠️</div><div class="card-name">TopDividendTools.com</div>
        <div class="card-desc">Free calculators, screeners, and planning tools.</div>
      </a>
      <a href="https://topdividendetfspro.com" target="_blank" rel="noopener" class="network-card pro-card">
        <div class="card-icon">⭐</div><div class="card-name">TopDividendETFsPro.com</div>
        <div class="card-desc">Deep data, advanced filters, tax grades, daily pro insights.</div>
      </a>
    </div>
  </section>`;
}

function footerHtml() {
  return `<footer>
    <div class="container">
      <div class="footer-content">
        <div class="footer-links">
          <a href="/">Home</a>
          <a href="/etf/">All ETFs</a>
          <a href="/vs/">ETF Comparisons</a>
          <a href="/terms.html">Terms of Use</a>
          <a href="/privacy.html">Privacy Policy</a>
          <a href="/faq.html">FAQ</a>
          <a href="/disclaimer.html">Disclaimer</a>
        </div>
        <div class="footer-disclaimer">
          This site is 100% free and for entertainment purposes only. All data is curated from public sources and may be inaccurate or delayed. Not financial advice. Past performance does not guarantee future results.
        </div>
        <p class="footer-copyright">© ${new Date().getFullYear()} ETF Total Returns. All rights reserved.</p>
      </div>
    </div>
  </footer>`;
}

/* ─────────────────── scorecard page builder ──────────────────── */

function buildEtfPage(e, all) {
  const s = slug(e.symbol);
  const url = `${SITE}/etf/${s}.html`;
  const g = e.grade;
  const yrs = yearsSince(e.inception);

  /* --- head-to-head matchups (only tickers that have /vs/ pages) --- */
  let vsCards = '';
  if (VS_TICKERS.includes(e.symbol.toUpperCase())) {
    const me = e.symbol.toUpperCase();
    const opponents = VS_TICKERS.filter(t => t !== me).slice(0, 24);
    vsCards = opponents.map(op => {
      const pair = [me.toLowerCase(), op.toLowerCase()].sort();
      return `<a class="vs-card" href="/vs/${pair[0]}-vs-${pair[1]}.html">
        <span class="pair">${esc(me)} vs ${esc(op)}</span><span class="go">→</span></a>`;
    }).join('\n');
  }

  const vsSection = vsCards ? `<section class="section">
    <h2 class="sec-title">🥊 ${esc(e.symbol)} Head-to-Head</h2>
    <p class="sec-sub">See how ${esc(e.symbol)} stacks up against the funds investors compare it with most, measured on average annual total return since inception.</p>
    <div class="vs-grid">${vsCards}</div>
    <p style="margin-top:20px"><a href="/vs/" class="compare-btn">Browse all 300+ ETF matchups →</a></p>
  </section>` : `<section class="section">
    <h2 class="sec-title">🥊 Compare ETFs Head-to-Head</h2>
    <p class="sec-sub">Put ${esc(e.symbol)} up against another fund on total return, yield, and annualized performance.</p>
    <p><a href="/vs/" class="compare-btn">Browse all 300+ ETF matchups →</a></p>
  </section>`;

  /* --- similar yield band --- */
  const band = isNaN(e.yieldNum) ? null : (e.yieldNum < 3 ? [0, 3] : e.yieldNum < 6 ? [3, 6] : e.yieldNum < 10 ? [6, 10] : [10, 999]);
  const similar = band ? all.filter(x => x.symbol !== e.symbol && !isNaN(x.yieldNum) && x.yieldNum >= band[0] && x.yieldNum < band[1])
    .sort((a, b) => (b.score - a.score)).slice(0, 12) : [];

  const similarSection = similar.length ? `<section class="section">
    <h2 class="sec-title">💵 Similar Yield to ${esc(e.symbol)}</h2>
    <p class="sec-sub">Other funds paying in the ${band[1] === 999 ? '10%+' : band[0] + '–' + band[1] + '%'} range, ranked by our scorecard.</p>
    <div class="panel" style="padding:8px 20px">
      <table class="peer-table">
        <thead><tr><th>Symbol</th><th>Name</th><th class="c">Yield</th><th class="c">Annualized</th><th class="c">Grade</th></tr></thead>
        <tbody>
        ${similar.map(x => `<tr onclick="location.href='/etf/${slug(x.symbol)}.html'">
          <td><a href="/etf/${slug(x.symbol)}.html">${esc(x.symbol)}</a></td>
          <td class="peer-name">${esc(x.name)}</td>
          <td class="c">${esc(x.yieldRaw)}</td>
          <td class="c ${x.annual >= 0 ? 'pos' : 'neg'}">${fmtPct(x.annual)}</td>
          <td class="c gold"><strong>${x.grade.letter}</strong></td></tr>`).join('\n')}
        </tbody>
      </table>
    </div>
  </section>` : '';

  /* --- top performers --- */
  const top = all.filter(x => x.symbol !== e.symbol && !isNaN(x.annual))
    .sort((a, b) => b.annual - a.annual).slice(0, 15);

  const topSection = `<section class="section">
    <h2 class="sec-title">🏆 Highest Annualized Returns</h2>
    <p class="sec-sub">The strongest average annual total returns since inception across every fund we track.</p>
    <div class="panel" style="padding:8px 20px">
      <table class="peer-table">
        <thead><tr><th>#</th><th>Symbol</th><th>Name</th><th class="c">Yield</th><th class="c">Annualized</th></tr></thead>
        <tbody>
        ${top.map((x, i) => `<tr onclick="location.href='/etf/${slug(x.symbol)}.html'">
          <td class="c" style="color:var(--text-muted)">${i + 1}</td>
          <td><a href="/etf/${slug(x.symbol)}.html">${esc(x.symbol)}</a></td>
          <td class="peer-name">${esc(x.name)}</td>
          <td class="c">${esc(x.yieldRaw)}</td>
          <td class="c ${x.annual >= 0 ? 'pos' : 'neg'}">${fmtPct(x.annual)}</td></tr>`).join('\n')}
        </tbody>
      </table>
    </div>
  </section>`;

  /* --- A-Z chips --- */
  const azChips = all.filter(x => x.symbol !== e.symbol)
    .map(x => `<a class="az-chip" href="/etf/${slug(x.symbol)}.html">${esc(x.symbol)}</a>`).join('');

  /* --- FAQ + schema --- */
  const faqs = [
    { q: `What is the dividend yield of ${e.symbol}?`,
      a: `${e.symbol} currently shows a distribution yield of ${e.yieldRaw || 'N/A'}. Yield reflects the most recent distribution annualized and can change with every payment.` },
    { q: `What is the total return of ${e.symbol} since inception?`,
      a: `${e.symbol} has returned ${e.totalRaw || 'N/A'} in total since it launched${e.inception && e.inception !== 'N/A' ? ' on ' + e.inception : ''}, which works out to roughly ${fmtPct(e.annual)} per year on average.` },
    { q: `Is the ${e.symbol} yield sustainable?`,
      a: verdictFor(e) + ' A distribution rate that runs persistently ahead of total return generally means capital is being returned rather than earned.' },
    { q: `How is the ${e.symbol} grade calculated?`,
      a: `Our ${g.letter} grade combines three things: annualized total return (50 points), cumulative total return since inception (25 points), and whether annualized return keeps pace with the distribution rate (25 points). ${e.symbol} scored ${e.score} out of 100. This is our opinion only, not investment advice.` }
  ];

  const faqSchema = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqs.map(f => ({
      '@type': 'Question', name: f.q,
      acceptedAnswer: { '@type': 'Answer', text: f.a }
    }))
  };

  const breadcrumbSchema = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: SITE + '/' },
      { '@type': 'ListItem', position: 2, name: 'ETFs', item: SITE + '/etf/' },
      { '@type': 'ListItem', position: 3, name: e.symbol, item: url }
    ]
  };

  const title = `${e.symbol} ETF Scorecard — Yield ${e.yieldRaw || 'N/A'}, Total Return ${e.totalRaw || 'N/A'} | ETF Total Returns`;
  const desc = `${e.symbol} (${e.name}) scorecard: ${e.yieldRaw || 'N/A'} yield, ${e.totalRaw || 'N/A'} total return since inception, ${fmtPct(e.annual)} annualized. Grade ${g.letter}. Free income calculator and head-to-head comparisons.`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${url}">
<meta property="og:type" content="website">
<meta property="og:url" content="${url}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:image" content="https://raw.githubusercontent.com/benjiesiegel1414/etftotalreturns/main/etf.png">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:site" content="@TopDividendETFs">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(desc)}">
<meta name="twitter:image" content="https://raw.githubusercontent.com/benjiesiegel1414/etftotalreturns/main/etf.png">
<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">
<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png">
<link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png">
<script async src="https://www.googletagmanager.com/gtag/js?id=G-VYCX30S0EC"></script>
<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','G-VYCX30S0EC');</script>
<script type="application/ld+json">${JSON.stringify(breadcrumbSchema)}</script>
<script type="application/ld+json">${JSON.stringify(faqSchema)}</script>
<style>${STYLES}</style>
</head>
<body>
${headerHtml()}
<main>
  <div class="container">
    <nav class="crumbs"><a href="/">Home</a> › <a href="/etf/">ETFs</a> › <span>${esc(e.symbol)}</span></nav>

    <section class="scorecard-hero">
      <div class="grade-orb tone-${g.tone}">
        <div class="letter">${g.letter}</div>
        <div class="out-of">${e.score} / 100</div>
      </div>
      <div>
        <h1 class="ticker-line">$${esc(e.symbol)}</h1>
        <p class="fund-name">${esc(e.name)}</p>
        <p class="verdict">${esc(verdictFor(e))}</p>
      </div>
    </section>

    <div class="metrics-grid">
      <div class="metric"><div class="lbl">Distribution Yield</div><div class="val pos">${esc(e.yieldRaw || 'N/A')}</div><div class="sub">annualized</div></div>
      <div class="metric"><div class="lbl">Total Return</div><div class="val ${e.totalNum >= 0 ? 'pos' : 'neg'}">${esc(e.totalRaw || 'N/A')}</div><div class="sub">since inception</div></div>
      <div class="metric"><div class="lbl">Annualized Return</div><div class="val ${e.annual >= 0 ? 'pos' : 'neg'}">${fmtPct(e.annual)}</div><div class="sub">average per year</div></div>
      <div class="metric"><div class="lbl">Inception</div><div class="val neutral" style="font-size:19px">${esc(e.inception || 'N/A')}</div><div class="sub">${isNaN(yrs) ? '—' : yrs.toFixed(1) + ' years live'}</div></div>
      <div class="metric"><div class="lbl">Scorecard Rank</div><div class="val gold">#${e.rank}</div><div class="sub">of ${all.length} funds</div></div>
    </div>

    ${proBarHtml()}

    <section class="section">
      <h2 class="sec-title">🎯 How ${esc(e.symbol)} Scored</h2>
      <p class="sec-sub">We grade on total return, not headline yield. A fund that pays 40% while losing 30% of its price is not doing its job.</p>
      <div class="panel">
        <div class="bar-row">
          <div class="bar-head"><span>Annualized return strength</span><span class="pts">${e.parts.ret} / 50</span></div>
          <div class="bar-track"><div class="bar-fill" style="width:${(e.parts.ret / 50 * 100).toFixed(0)}%"></div></div>
          <div class="bar-note">Average yearly total return of ${fmtPct(e.annual)} since inception.</div>
        </div>
        <div class="bar-row">
          <div class="bar-head"><span>Cumulative total return</span><span class="pts">${e.parts.tot} / 25</span></div>
          <div class="bar-track"><div class="bar-fill" style="width:${(e.parts.tot / 25 * 100).toFixed(0)}%"></div></div>
          <div class="bar-note">${esc(e.totalRaw || 'N/A')} in total return since the fund launched.</div>
        </div>
        <div class="bar-row">
          <div class="bar-head"><span>Yield backed by returns</span><span class="pts">${e.parts.sus} / 25</span></div>
          <div class="bar-track"><div class="bar-fill" style="width:${(e.parts.sus / 25 * 100).toFixed(0)}%"></div></div>
          <div class="bar-note">Compares the ${esc(e.yieldRaw || 'N/A')} distribution rate against ${fmtPct(e.annual)} annualized return. Higher is healthier.</div>
        </div>
      </div>
    </section>

    <section class="section">
      <h2 class="sec-title">🧮 ${esc(e.symbol)} Income &amp; Growth Calculator</h2>
      <p class="sec-sub">Enter what you'd invest. We'll show the income at the current distribution rate and project growth at the fund's historical annualized return.</p>
      <div class="panel">
        <div class="calc-grid">
          <div class="calc-field"><label>Amount invested ($)</label><input type="number" id="cAmt" value="10000" min="0" step="500"></div>
          <div class="calc-field"><label>Years held</label><input type="number" id="cYrs" value="10" min="1" max="50" step="1"></div>
          <div class="calc-field"><label>Reinvest dividends</label>
            <select id="cDrip"><option value="yes">Yes — DRIP on</option><option value="no">No — take the cash</option></select>
          </div>
        </div>
        <div class="calc-out">
          <div class="calc-cell"><div class="k">Annual income</div><div class="v" id="oAnnual">—</div></div>
          <div class="calc-cell"><div class="k">Monthly income</div><div class="v" id="oMonthly">—</div></div>
          <div class="calc-cell"><div class="k">Weekly income</div><div class="v" id="oWeekly">—</div></div>
          <div class="calc-cell"><div class="k">Projected value</div><div class="v" id="oFuture">—</div></div>
          <div class="calc-cell"><div class="k">Total gain</div><div class="v" id="oGain">—</div></div>
        </div>
        <p class="calc-disclaim">
          Projections use ${esc(e.symbol)}'s historical annualized total return of ${fmtPct(e.annual)} and its current ${esc(e.yieldRaw || 'N/A')} distribution rate, both held flat. Real returns will differ, distributions can be cut, and past performance does not predict future results. Taxes, fees, and return of capital are not modeled. For entertainment only — not financial advice.
        </p>
      </div>
    </section>

    ${vsSection}
    ${similarSection}
    ${topSection}

    <section class="section">
      <h2 class="sec-title">❓ ${esc(e.symbol)} FAQ</h2>
      <div class="panel">
        ${faqs.map(f => `<div class="faq-item"><div class="faq-q">${esc(f.q)}</div><div class="faq-a">${esc(f.a)}</div></div>`).join('\n')}
      </div>
    </section>

    ${proCardHtml()}

    <section class="section">
      <h2 class="sec-title">🔤 Every ETF We Track</h2>
      <p class="sec-sub">Jump straight to any fund's scorecard.</p>
      <div class="az-wrap">${azChips}</div>
    </section>

    ${networkHtml()}
  </div>
</main>
${footerHtml()}
<script>
(function(){
  var YIELD=${isNaN(e.yieldNum) ? 0 : e.yieldNum};
  var CAGR=${isNaN(e.annual) ? 0 : e.annual};
  var amt=document.getElementById('cAmt'),yrs=document.getElementById('cYrs'),drip=document.getElementById('cDrip');
  function money(n){
    if(!isFinite(n))return'—';
    return '$'+n.toLocaleString('en-US',{minimumFractionDigits:0,maximumFractionDigits:0});
  }
  function calc(){
    var a=parseFloat(amt.value)||0;
    var y=Math.max(1,Math.min(50,parseInt(yrs.value,10)||1));
    var income=a*(YIELD/100);
    document.getElementById('oAnnual').textContent=money(income);
    document.getElementById('oMonthly').textContent=money(income/12);
    document.getElementById('oWeekly').textContent=money(income/52);
    var future;
    if(drip.value==='yes'){
      future=a*Math.pow(1+CAGR/100,y);
    }else{
      var priceGrowth=(CAGR-YIELD)/100;
      future=a*Math.pow(1+priceGrowth,y)+(income*y);
    }
    document.getElementById('oFuture').textContent=money(future);
    document.getElementById('oGain').textContent=money(future-a);
  }
  [amt,yrs].forEach(function(el){el.addEventListener('input',calc);});
  drip.addEventListener('change',calc);
  calc();
})();
</script>
</body>
</html>`;
}

/* ───────────────────── directory index page ──────────────────── */

function buildIndexPage(all) {
  const url = `${SITE}/etf/`;
  const rows = all.map((x, i) => `<tr onclick="location.href='/etf/${slug(x.symbol)}.html'">
    <td class="c" style="color:var(--text-muted)">${i + 1}</td>
    <td><a href="/etf/${slug(x.symbol)}.html">${esc(x.symbol)}</a></td>
    <td class="peer-name">${esc(x.name)}</td>
    <td class="c">${esc(x.yieldRaw)}</td>
    <td class="c ${x.totalNum >= 0 ? 'pos' : 'neg'}">${esc(x.totalRaw)}</td>
    <td class="c ${x.annual >= 0 ? 'pos' : 'neg'}">${fmtPct(x.annual)}</td>
    <td class="c gold"><strong>${x.grade.letter}</strong></td></tr>`).join('\n');

  const title = 'All ETF Scorecards — Yield, Total Return & Grades | ETF Total Returns';
  const desc = `Free scorecards for ${all.length} dividend and income ETFs. Compare distribution yield against real total return, with an income calculator on every page.`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${url}">
<meta property="og:type" content="website">
<meta property="og:url" content="${url}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:image" content="https://raw.githubusercontent.com/benjiesiegel1414/etftotalreturns/main/etf.png">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png">
<script async src="https://www.googletagmanager.com/gtag/js?id=G-VYCX30S0EC"></script>
<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','G-VYCX30S0EC');</script>
<style>${STYLES}</style>
</head>
<body>
${headerHtml()}
<main>
  <div class="container">
    <nav class="crumbs"><a href="/">Home</a> › <span>ETFs</span></nav>
    <section class="section" style="margin-top:24px">
      <h1 class="ticker-line" style="font-size:clamp(30px,5vw,46px)">All ETF Scorecards</h1>
      <p class="sec-sub" style="margin-top:12px">Every fund we track, graded on total return rather than headline yield. Click any row for the full scorecard, income calculator, and head-to-head comparisons.</p>
      ${proBarHtml()}
      <div class="panel" style="padding:8px 20px">
        <table class="peer-table">
          <thead><tr><th class="c">#</th><th>Symbol</th><th>Name</th><th class="c">Yield</th><th class="c">Total Return</th><th class="c">Annualized</th><th class="c">Grade</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </section>
    ${networkHtml()}
  </div>
</main>
${footerHtml()}
</body>
</html>`;
}

/* ─────────────────────────── sitemap ─────────────────────────── */

function buildSitemap(all) {
  const today = new Date().toISOString().split('T')[0];
  const urls = [`${SITE}/etf/`].concat(all.map(x => `${SITE}/etf/${slug(x.symbol)}.html`));
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(u => `  <url><loc>${u}</loc><lastmod>${today}</lastmod><changefreq>daily</changefreq><priority>0.8</priority></url>`).join('\n')}
</urlset>`;
}

/* ──────────────────────────── main ───────────────────────────── */

async function main() {
  console.log('Fetching CSV…');
  const res = await fetch(CSV_URL + '&t=' + Date.now());
  if (!res.ok) throw new Error('CSV fetch failed: ' + res.status);
  const txt = await res.text();

  const lines = txt.split('\n');
  const etfs = [];
  const seen = new Set();

  for (let i = 1; i < lines.length; i++) {
    if (!lines[i] || !lines[i].trim()) continue;
    const p = parseCsvLine(lines[i]);
    if (p.length < 10 || !p[0]) continue;

    const symbol = p[0].toUpperCase();
    if (seen.has(symbol)) continue;
    seen.add(symbol);

    const yieldRaw = p[3] || 'N/A';
    const totalRaw = p[7] || 'N/A';
    const inception = p[9] || 'N/A';

    const yieldNum = num(yieldRaw);
    const totalNum = num(totalRaw);
    const annual = annualizedFrom(totalRaw, inception);

    const parts = {
      ret: scoreReturn(annual),
      tot: scoreTotal(totalNum),
      sus: scoreSustain(annual, yieldNum)
    };
    const score = parts.ret + parts.tot + parts.sus;

    etfs.push({
      symbol, name: p[1] || symbol,
      yieldRaw, totalRaw, inception,
      yieldNum, totalNum, annual,
      parts, score, grade: gradeFor(score)
    });
  }

  if (!etfs.length) throw new Error('No ETF rows parsed — check the CSV column layout.');

  // rank by score
  const ranked = etfs.slice().sort((a, b) => b.score - a.score);
  ranked.forEach((e, i) => { e.rank = i + 1; });

  const alpha = etfs.slice().sort((a, b) => a.symbol.localeCompare(b.symbol));

  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

  let written = 0;
  for (const e of alpha) {
    fs.writeFileSync(path.join(OUT_DIR, slug(e.symbol) + '.html'), buildEtfPage(e, alpha), 'utf8');
    written++;
  }

  fs.writeFileSync(path.join(OUT_DIR, 'index.html'), buildIndexPage(ranked), 'utf8');
  fs.writeFileSync(path.join(__dirname, 'sitemap-etf.xml'), buildSitemap(alpha), 'utf8');

  console.log(`Wrote ${written} scorecard pages to /etf/`);
  console.log('Wrote /etf/index.html and sitemap-etf.xml');
}

main().catch(err => { console.error(err); process.exit(1); });
