## Causa do travamento

1. **Host errado**: usamos `https://queridodiario.ok.org.br/api/gazettes` (retorna **HTTP 403** em ~70ms). O domínio correto, conforme `https://api.queridodiario.ok.org.br/docs`, é `https://api.queridodiario.ok.org.br/gazettes` (sem o prefixo `/api`). Testado agora: HTTP 200 em ~320ms.
2. **Bloqueio do pipeline**: em `prospect.server.ts` fazemos `await diarioPromise` antes de montar o prompt. Mesmo com timeout de 10s + retry, em lotes grandes isso vira 10–25s por município preso esperando o diário.

## Mudanças

### `src/lib/querido-diario.server.ts`
- Trocar `BASE` para `https://api.queridodiario.ok.org.br/gazettes`.
- Reduzir `timeoutMs` padrão para **5000ms**.
- Tirar o retry automático em 403 (era sintoma do host errado; se o host certo der 403, é bloqueio real, não vale insistir).
- Atualizar User-Agent para `MunicipIA/0.8`.
- Atualizar comentário com o link correto da doc.

### `src/lib/prospect.server.ts`
- Substituir `await diarioPromise;` por um **race com timeout** (~6s): se o diário não responder até lá, seguimos sem ele e emitimos `warn` "Diário demorou demais — seguindo sem ele". O `diarioPromise` continua rodando em background, mas não pode atrasar a etapa A3.
- Manter snippet + atalho feliz funcionando exatamente como hoje.

### `src/lib/version.ts`
- Bump **Alpha v0.8 → Alpha v0.9**.

## Verificação
- `bunx tsgo --noEmit` limpo.
- Rodar uma busca em Maringá-PR: logs devem mostrar `Querido Diário 200` em ~300ms (não mais "HTTP 403") e o pipeline não fica preso quando a API estiver lenta.

## Não muda
- UI, schema da IA, cache, scraper nativo, regras de fallback.
