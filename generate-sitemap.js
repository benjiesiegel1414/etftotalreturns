/**
 * generate-sitemap.js (ETFTotalReturns.com)
 *
 * Writes:
 *   sitemap-pages.xml  every indexable page in the site root, including /blog.html
 *                      and every blog post linked from it, with lastmod dates
 *   sitemap.xml        a sitemap index pointing at sitemap-pages.xml,
 *                      sitemap-etf.xml and sitemap-matchups.xml
 *
 * Blog posts are found automatically from the links on blog.html, so a new post
 * shows up in the sitemap as soon as it is added to the blog index. Any other
 * .html file in the root is included too, unless it is noindexed or redirects.
 *
 * lastmod comes from the file's last git commit (falls back to today).
 * Run: node generate-sitemap.js   (the sitemap workflow runs it on every push)
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const SITE = 'https://etftotalreturns.com';
const ROOT = __dirname;
const TODAY = new Date().toISOString().slice(0, 10);
const CHILD_SITEMAPS = ['sitemap-pages.xml', 'sitemap-etf.xml', 'sitemap-matchups.xml'];

function lastmod(file) {
  try {
    const d = execSync(`git log -1 --format=%cs -- "${file}"`, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
  } catch (e) { /* not a git checkout */ }
  return TODAY;
}

function indexable(file) {
  const html = fs.readFileSync(path.join(ROOT, file), 'utf8');
  if (/<meta[^>]+name=["']robots["'][^>]+noindex/i.test(html)) return false;
  if (/<meta[^>]+http-equiv=["']refresh["']/i.test(html)) return false;
  return true;
}

// The URL a page should be listed under: its canonical if it points at this site, else /file
function urlFor(file) {
  const html = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const m = html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i)
         || html.match(/<link[^>]+href=["']([^"']+)["'][^>]+rel=["']canonical["']/i);
  if (m && m[1].startsWith(SITE)) return m[1];
  return file === 'index.html' ? SITE + '/' : `${SITE}/${file}`;
}

// Local pages linked from the blog index
function blogPosts() {
  const p = path.join(ROOT, 'blog.html');
  if (!fs.existsSync(p)) return [];
  const html = fs.readFileSync(p, 'utf8');
  const out = new Set();
  for (const m of html.matchAll(/href=["']([^"'#?]+)["']/g)) {
    let h = m[1];
    if (/^https?:\/\//.test(h)) { if (!h.startsWith(SITE)) continue; h = h.slice(SITE.length); }
    h = h.replace(/^\//, '');
    if (!h) continue;
    if (!h.endsWith('.html')) h += '.html';
    if (fs.existsSync(path.join(ROOT, h))) out.add(h);
  }
  return [...out];
}

const rootPages = fs.readdirSync(ROOT).filter(f => f.endsWith('.html'));
const files = [...new Set([...rootPages, ...blogPosts()])].filter(indexable).sort((a, b) =>
  (a === 'index.html' ? -1 : b === 'index.html' ? 1 : a === 'blog.html' ? -1 : b === 'blog.html' ? 1 : a.localeCompare(b)));

const seen = new Set();
let newest = '0000-00-00';
const urls = [];
for (const f of files) {
  const loc = urlFor(f);
  if (seen.has(loc)) continue;
  seen.add(loc);
  const lm = lastmod(f);
  if (lm > newest) newest = lm;
  urls.push(`  <url>\n    <loc>${loc}</loc>\n    <lastmod>${lm}</lastmod>\n  </url>`);
}

fs.writeFileSync(path.join(ROOT, 'sitemap-pages.xml'),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`, 'utf8');

const children = CHILD_SITEMAPS.filter(f => fs.existsSync(path.join(ROOT, f)))
  .map(f => `  <sitemap>\n    <loc>${SITE}/${f}</loc>\n    <lastmod>${f === 'sitemap-pages.xml' ? newest : lastmod(f)}</lastmod>\n  </sitemap>`);
fs.writeFileSync(path.join(ROOT, 'sitemap.xml'),
  `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${children.join('\n')}\n</sitemapindex>\n`, 'utf8');

console.log(`sitemap-pages.xml: ${urls.length} urls (${blogPosts().length} linked from blog.html); sitemap.xml indexes ${children.length} sitemaps`);
