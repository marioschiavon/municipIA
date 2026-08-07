# Remover Firecrawl da cadeia — Apify primeiro, OpenAI e Gemini como fallback (Alpha v0.53)

## Situação atual (verificada no código)

Em `src/lib/prospect.server.ts` o Firecrawl ainda é o **padrão** em vários pontos:

- `prospectar()` e `prospectarDominio()` têm `provider: "firecrawl" | "apify" = "firecrawl"` — quando a chamada não passa provedor explícito, começa pelo Firecrawl e só cai no Apify se der erro de cota.
- `makeSearchDispatcher()` só usa Apify quando `provider === "apify"`.
- `gScrape()` (leitura de páginas) segue a ordem: fetch nativo → Firecrawl → Apify.
- `prospectarSecretario()` e `prospectarContato()` instanciam Firecrawl (`getFirecrawl()`) só para poder chamar `gScrape`.
- A tela de detalhe do município (`admin.municipios.$ibgeId.tsx`) envia `provider: "firecrawl"` no botão "Atualizar".
- A prospecção em lote já usa Apify por padrão, mas o seletor ainda oferece Firecrawl.

## O que muda

Nova ordem, igual em todos os fluxos (lote, fase isolada e prospecção ao vivo):

```text
BUSCA (SERP)      Apify  →  OpenAI (web_search)  →  Gemini (Lovable AI)
LEITURA DE PÁGINA fetch nativo  →  Apify (navegador real)
EXTRAÇÃO (IA)     OpenAI  →  Gemini (Lovable AI)   [já é assim hoje]
```

- Firecrawl deixa de ser chamado em qualquer etapa; o pacote e a chave ficam no projeto, mas sem uso.
- O seletor "Provedor de busca" da tela de lote e o botão "Atualizar (Firecrawl)" no detalhe do município passam a refletir só a cadeia nova (Apify como motor, fallbacks automáticos).
- Cada troca de motor continua aparecendo no log em tempo real ("Apify sem cota — refazendo pela OpenAI", etc.).

## Sobre o Gemini na busca

O Gemini do Lovable AI **não tem ferramenta de busca na web** como a OpenAI. Então ele entra como terceiro nível assim: quando Apify e OpenAI falharem, o Gemini é usado para responder com o site oficial/candidatos prováveis do município a partir do conhecimento dele, sempre marcado como resultado de baixa confiança e enviado para a fila de revisão. Na extração de nomes/contatos ele continua sendo o fallback pleno que já é hoje.

## Detalhes técnicos

- `prospect.server.ts`: remover `import Firecrawl`, `getFirecrawl()`, `googleSearch()`, `gSearch()` e `scrapeMarkdown()` via Firecrawl; `gScrape(url, ...)` perde o parâmetro `fc` e vira fetch nativo → `ragBrowse` (Apify).
- `makeSearchDispatcher(emit)` sem parâmetro `provider`: sempre `apifySearch`, que já cai em `openaiSearch`; acrescentar `geminiSearch()` (via `createLovableAiGatewayProvider`, `generateObject` com lista de URLs candidatas) como último elo.
- Assinaturas públicas: `prospectar()` e `prospectarDominio()` deixam de receber `provider`; ajustar `src/routes/api/prospect.ts` (schema zod), `src/lib/use-prospect-queue.ts`, `admin.prospeccao.tsx` e `admin.municipios.$ibgeId.tsx`.
- Bump de versão em `src/lib/version.ts` para `Alpha v0.53`.
