## Diagnóstico (verificado)

- Chamada direta à API de busca do Firecrawl retorna: `Insufficient credits to perform this request`.
- Em `src/lib/prospect.server.ts`, `googleSearch()` captura a exceção e retorna lista vazia; `prospectarDominio()` então não acha candidato e devolve `not_found`. O mesmo vale para as outras fases, que dependem do domínio confirmado.
- A mesma consulta pelo Apify (`apify~google-search-scraper`) respondeu HTTP 200 com resultados orgânicos normais.
- O *scraping* de páginas não é afetado: `scrapeMarkdown()` já usa fetch nativo primeiro e só cai no Firecrawl como último recurso.
- Estado atual do banco: 5.571 municípios, 151 com domínio, 22 com secretário, 18 com e-mail.

## O que mudar

1. **Apify como provedor de busca padrão**
   - `useProspectQueue` / `admin.prospeccao.tsx` / lista de municípios passam `"apify"` em vez de `"firecrawl"`.
   - `/api/prospect` mantém o parâmetro `provider`, apenas troca o default.

2. **Fallback automático de busca**
   - Em `makeSearchDispatcher`: se o Firecrawl retornar 0 resultados por erro de crédito/quota/401/402, refaz a mesma query pelo Apify automaticamente e emite aviso no log.

3. **Erro deixar de ser silencioso**
   - `googleSearch()` passa a distinguir "sem resultados" de "provedor falhou", propagando o motivo.
   - `prospectarDominio()` (e as demais fases) retornam `status: "error"` com a mensagem real do provedor em vez de `not_found`, para que a linha no painel mostre o motivo verdadeiro.

4. **Ritmo do lote**
   - O Apify SERP leva ~10–40 s por consulta (vs. ~2 s do Firecrawl). Ajustar o intervalo da Fase 1 de 5 s para ~2 s, já que a própria chamada é lenta, e elevar o timeout de busca da fase de domínio de 8 s para 45 s — caso contrário o timeout duro corta a resposta do Apify e o resultado volta vazio de novo.

5. **Seletor de provedor na aba de prospecção**
   - Um pequeno seletor "Provedor de busca: Apify / Firecrawl" no cabeçalho da tela, para voltar ao Firecrawl sem alterar código quando os créditos forem renovados.

6. Bump de versão em `src/lib/version.ts` (Alpha v0.x+1).

## Validação

Rodar um lote pequeno (ex.: 5 municípios de PR/SP) na Fase 1 e confirmar no log domínios confirmados e `dominio_oficial` gravado, depois rodar a Fase 2 sobre esses mesmos municípios.

## Observação

Se preferir manter o Firecrawl como principal, a alternativa é recarregar créditos na conta Firecrawl — nesse caso só implemento os itens 3 e 5 (log honesto e seletor).
