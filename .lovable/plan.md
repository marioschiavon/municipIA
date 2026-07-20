
## Objetivo

Criar um POC isolado do Apify — sem tocar no pipeline de prospecção — para validar se o Apify consegue capturar dados de contato de páginas internas das prefeituras (não só a home). Comparar resultado x tempo x custo antes de decidir integrar.

## Por que não só a home

Você tem razão: raspar só a URL raiz falha porque cada prefeitura organiza contatos em rotas diferentes (`/secretarias/educacao`, `/contato`, `/fale-conosco`, `/sme`, etc). O actor precisa **crawlear seguindo links**, com filtro de URL e profundidade limitada, para achar a página certa sem custar 50 requests por município.

## Escolha do actor

**Website Content Crawler** (`apify/website-content-crawler`) via **run-sync-get-dataset-items**:
- Aceita `startUrls` + `maxCrawlDepth` + `includeUrlGlobs` — exatamente o que precisamos.
- Renderiza JS (alguns portais são SPA).
- Devolve markdown limpo pronto pra jogar no nosso `extractContactsRegex` + IA.
- Sync API espera até ~5min, mas configuramos `maxRequestsPerCrawl: 8` e `maxCrawlDepth: 2` pra fechar em <20s.

Cheerio sozinho ficaria mais rápido mas não pega SPAs — testamos o Content Crawler primeiro, que é o caso "difícil". Se ficar lento demais, trocamos.

## Configuração do run

```ts
{
  startUrls: [{ url: topResult.url }],           // URL vencedora da busca Google
  maxCrawlDepth: 2,
  maxRequestsPerCrawl: 8,
  includeUrlGlobs: [
    "**/educacao/**", "**/sme/**", "**/seduc/**",
    "**/secretaria*/**", "**/contato*", "**/fale-conosco*",
    "**/telefone*", "**/endereco*"
  ],
  crawlerType: "playwright:adaptive",  // usa cheerio quando possível, playwright quando precisa
  saveMarkdown: true,
  removeCookieWarnings: true,
}
```

## Escopo do POC (nada além disso)

1. **Secret** `APIFY_TOKEN` via `add_secret` (você cola no formulário seguro).
2. **`src/lib/apify.server.ts`** — helper `crawlSite(startUrl, opts)` que chama o run-sync do actor e devolve `{ pages: Array<{ url, markdown }>, elapsedMs, cost }`.
3. **Rota `/api/debug/apify`** (POST) — recebe `{ url }`, roda o crawl, aplica `extractContactsRegex` em cada página, devolve JSON com páginas visitadas, emails/telefones agregados, tempo total.
4. **Rota `/debug/apify`** (UI) — form simples: cola URL da prefeitura, botão "Testar Apify", mostra páginas visitadas + contatos extraídos + tempo. Link discreto pra ela a partir do `/debug` existente.
5. **Não mexer** em `prospect.server.ts`, `scraper.server.ts`, nem no fluxo de busca. Zero regressão possível.
6. **Bump** `src/lib/version.ts` → `Alpha v0.18`.

## Critérios de sucesso (para decidir integrar depois)

Rodar manualmente em 5 URLs (Maringá, Umuarama, Curitiba, São Paulo, uma cidade pequena) e comparar com o fetch nativo atual:
- Encontrou o `seduc@` / e-mail correto que o nativo perde? 
- Tempo total < 20s por município?
- Quantas requests o actor gastou? (custo Apify = ~$0.25/1000 requests do WCC)

Com esses números decidimos se vale plugar como fallback do `fetchHtml` no `Alpha v0.19`.

## Fora do escopo

- Integração no pipeline de prospecção.
- Substituição do Firecrawl no Google Search (Apify não é bom pra SERP).
- Cache de resultados do Apify (POC manual não precisa).
