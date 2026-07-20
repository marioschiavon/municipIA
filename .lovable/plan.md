
## Diagnóstico do caso SJP

- `www.sjp.pr.gov.br/secretarias/secretaria-educacao/` **tem tudo** (nome, cargo, e-mails, telefones, horário), mas o servidor é lento — meu próprio fetch externo estourou timeout, e o `gScrape` do pipeline tem `hardTimeoutMs` de 4–8s.
- O RAG Web Browser (Playwright, v0.19/v0.20) renderiza esse tipo de página **mas** hoje ele:
  - roda com timeout de **60s** só,
  - é aguardado por apenas **6s no Estágio 3** e **30s no Estágio 3.4**,
  - só entra depois que Firecrawl scrape falhou — e o Firecrawl **volta com markdown pobre da home** em vez de falhar, cortando o caminho do RAG,
  - recebe uma query genérica única ("prefeitura … educação … contato"), sem apontar para a subpágina real.

Resultado: o RAG raramente é consumido, e quando é, chega tarde e com material genérico.

## Objetivo

Aceitar que o município pode levar **60–120s** quando o site é lento, desde que no fim venha o **nome + cargo + e-mail seduc + telefones + horário** estruturados e verídicos. Trocar Firecrawl-first por **RAG-first** no estágio institucional (Estágio 3), com o Firecrawl scrape só como plano B.

## Mudanças (Alpha v0.22)

### 1. Duas queries de RAG em paralelo, mais tempo

Em `prospectar`, disparar **duas** chamadas `ragBrowse` em background logo no início:

- **RAG-nome**: `"prefeitura {municipio} {uf} secretaria de educação secretário atual"` — igual a hoje, `maxResults: 4`.
- **RAG-página** (nova): `"site:{slug}.{uf}.gov.br secretaria educação"` (fallback `"{municipio} {uf} secretaria municipal de educação contato"`) — foca em achar a subpágina real com markdown renderizado.

Ambas com `timeoutMs: 120_000`. Consolidar `ragPages` (Set por URL). Log com `elapsedMs` de cada uma.

### 2. Estágio 3 vira RAG-first

Ordem nova no Estágio 3 (contato institucional):

1. **3.0 (novo)** — `awaitRagBlock(90_000)`. Se retornar pelo menos 1 página com markdown > 800 chars e o host bate com `topHost` ou é `{slug}.{uf}.gov.br`, chama `extractWithAI` **direto** com o markdown do RAG. Se resultar em contato bom (e-mail não genérico ou telefone), retorna.
2. **3.1** — snippet institucional (atual 3a).
3. **3.2** — site:gov.br (atual 3b).
4. **3.3** — busca `/contato` (atual 3.2).
5. **3.4** — scrape Firecrawl do top gov (atual 3.3), **agora com fallback pro RAG dentro dele**: se `gScrape` devolver markdown < 500 chars OU sem qualquer e-mail plausível, e o RAG já tem página do mesmo host, usa a página do RAG em vez do Firecrawl.
6. **3.5** — extração exclusiva do bloco RAG completo (o atual 3.4, mantido como último RAG-fallback).

### 3. Estágio 1.5 aceita conteúdo do RAG

Hoje o Estágio 1.5 chama `gScrape(topNome.url)` com `hardTimeoutMs: 4000`. Vai ficar: tenta `gScrape` com **6s**; se falhar ou vier curto, checa `ragPages` por uma URL que **case com `topNome.url` ou compartilhe o host** — se achar, extrai com o markdown do RAG. Isso pega o caso SJP quando o RAG já retornou antes do Firecrawl travar.

### 4. `hasUsefulContact` mais rigoroso pra RAG-first

Adicionar helper `isRagResultTrustworthy(ext, source)` que exige:
- `secretario` não-nulo, **OU** ao menos 1 e-mail que passe `filterEmailsForFinal` sem cair para o "último recurso",
- e todos os campos ainda validados por `filterPresent`.

Só assim o Estágio 3.0 (RAG puro) fecha o pipeline; senão continua nas etapas seguintes.

### 5. Ajustes de config

- `ragBrowse`: aceitar `startUrls?: string[]` opcional (já suportado pelo actor via `input.startUrls`). Se a query começar com `site:{host}`, também passa `startUrls: [\`https://{host}/\`]` como dica.
- `src/lib/version.ts` → `Alpha v0.22`.

### 6. Painel / UX

- `ResultCard`: sem mudança visual; a timeline já mostra "RAG trouxe N página(s) em Xs" e "✨ Contato via RAG Web Browser". Só garantir que quando o RAG for a fonte final, o badge de origem exiba **"via RAG Web Browser"** (já existe).
- `/debug`: nenhum mexido — logs de `awaitRagBlock` e `elapsedMs` já vão pra lá via `emit`.

## Arquivos afetados

- `src/lib/prospect.server.ts` — segunda query RAG em paralelo, novo Estágio 3.0, Estágio 1.5 com fallback RAG, helper `isRagResultTrustworthy`.
- `src/lib/apify.server.ts` — `ragBrowse` aceita `startUrls?: string[]` opcional.
- `src/lib/version.ts` — bump para `Alpha v0.22`.

## Fora do escopo

- Cache do RAG por município (fica pra depois se o custo Apify pesar).
- Substituir Firecrawl SERP pelo Google SERP Scraper do Apify (é outra decisão, v0.23+).
- Segunda passagem de RAG após Estágio 4 (fallback gabinete) — não vale o custo.

## Critério de aceitação

Rodar `SJP`, `Maringá`, `Umuarama` e `Curitiba` no `/`. Cada um deve terminar em ≤ 120s com:
- nome do(a) secretário(a) preenchido,
- pelo menos 1 e-mail `seduc@` ou `educacao@` do domínio do município,
- pelo menos 1 telefone com DDD válido,
- e (quando existir na página) `horarioAtendimento`.
