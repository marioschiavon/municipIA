// Descoberta de páginas da Secretaria de Educação dentro de um domínio JÁ
// CONFIRMADO como oficial do município — sem depender de busca no Google/Apify.
// Server-only. Sem dependências novas (regex, reaproveita fetchHtml).

import { fetchHtml } from "./scraper.server";

export type SitemapDiscoveryResult = {
  candidates: string[];
  via: "sitemap" | "sitemap-index" | "homepage-links" | "none";
};

const EDU_KEYWORDS_RE = /(secretaria[-_\s]?(?:municipal[-_\s]?de[-_\s]?)?educa[cç][aã]o|estrutura[-_]organizacional|organograma|quem[-_]e[-_]quem|estrutura[-_]administrativa)/i;
const CONTACT_KEYWORDS_RE = /(contato|fale[-_]conosco|ouvidoria)/i;
const MAX_SUBSITEMAPS = 5;
const MAX_CANDIDATES = 8;

function extractLocs(xml: string): string[] {
  const out: string[] = [];
  const re = /<loc>\s*([^<\s]+)\s*<\/loc>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) out.push(m[1].trim());
  return out;
}

function scoreUrl(url: string): number {
  if (EDU_KEYWORDS_RE.test(url)) return 2;
  if (CONTACT_KEYWORDS_RE.test(url)) return 1;
  return 0;
}

function rankAndCap(urls: string[]): string[] {
  const seen = new Set<string>();
  const scored: Array<{ url: string; score: number }> = [];
  for (const u of urls) {
    if (seen.has(u)) continue;
    seen.add(u);
    const s = scoreUrl(u);
    if (s > 0) scored.push({ url: u, score: s });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, MAX_CANDIDATES).map((s) => s.url);
}

async function tryFetchXml(url: string): Promise<string | null> {
  const r = await fetchHtml(url, { timeoutMs: 6000 });
  return r.ok ? r.html : null;
}

async function findSitemapUrls(base: string): Promise<{ locs: string[]; via: "sitemap" | "sitemap-index" | "none" }> {
  for (const path of ["/sitemap.xml", "/sitemap_index.xml"]) {
    const xml = await tryFetchXml(`${base}${path}`);
    if (!xml) continue;
    const locs = extractLocs(xml);
    if (locs.length === 0) continue;
    if (/<sitemapindex/i.test(xml)) {
      const subLocs: string[] = [];
      for (const subUrl of locs.slice(0, MAX_SUBSITEMAPS)) {
        const subXml = await tryFetchXml(subUrl);
        if (subXml) subLocs.push(...extractLocs(subXml));
      }
      return { locs: subLocs, via: "sitemap-index" };
    }
    return { locs, via: "sitemap" };
  }
  // robots.txt — procura uma linha "Sitemap: <url>"
  const robots = await tryFetchXml(`${base}/robots.txt`);
  if (robots) {
    const m = /^sitemap:\s*(\S+)/im.exec(robots);
    if (m) {
      const xml = await tryFetchXml(m[1].trim());
      if (xml) {
        const locs = extractLocs(xml);
        if (locs.length > 0) {
          if (/<sitemapindex/i.test(xml)) {
            const subLocs: string[] = [];
            for (const subUrl of locs.slice(0, MAX_SUBSITEMAPS)) {
              const subXml = await tryFetchXml(subUrl);
              if (subXml) subLocs.push(...extractLocs(subXml));
            }
            return { locs: subLocs, via: "sitemap-index" };
          }
          return { locs, via: "sitemap" };
        }
      }
    }
  }
  return { locs: [], via: "none" };
}

async function findHomepageLinks(base: string): Promise<string[]> {
  const r = await fetchHtml(`${base}/`, { timeoutMs: 8000 });
  if (!r.ok) return [];
  const out: string[] = [];
  const re = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  const baseHost = new URL(base).host.toLowerCase();
  while ((m = re.exec(r.html)) !== null) {
    const href = m[1].trim();
    const text = m[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    if (!href || href.startsWith("mailto:") || href.startsWith("tel:") || href.startsWith("#")) continue;
    if (!EDU_KEYWORDS_RE.test(href) && !EDU_KEYWORDS_RE.test(text)) continue;
    let resolved: URL;
    try {
      resolved = new URL(href, r.finalUrl);
    } catch {
      continue;
    }
    if (resolved.host.toLowerCase() !== baseHost) continue; // anti-contaminação: só links do mesmo host
    out.push(resolved.toString());
  }
  return out;
}

export async function discoverEducationPages(domain: string): Promise<SitemapDiscoveryResult> {
  const base = `https://${domain}`;
  const { locs, via } = await findSitemapUrls(base);
  if (locs.length > 0) {
    const candidates = rankAndCap(locs);
    if (candidates.length > 0) return { candidates, via };
  }
  const homeLinks = await findHomepageLinks(base);
  const candidates = rankAndCap(homeLinks);
  return { candidates, via: candidates.length > 0 ? "homepage-links" : "none" };
}
