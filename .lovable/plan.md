# Visão Geral por IA primeiro, Estágio 0 como segunda tentativa

## Por que o "sem fallback ao Google" aparecia

Quando o município já tinha domínio confirmado (ex.: `guajaramirim.ro.gov.br`), a prospecção entrava no **Estágio 0** e usava esse domínio como fonte **exclusiva**: página conhecida da Secretaria, senão candidatos por sitemap/robots/links da home. Se nada útil aparecesse, a run encerrava como `not_found` sem tentar Google/Apify. Isso foi uma escolha de custo feita antes da Visão Geral por IA existir — daí o texto "por decisão de produto" no log. Não é bug nem falha do Apify.

## Nova ordem

1. **Visão Geral por IA do Google** (`apify/google-ai-overviews-scraper`, navegador real) passa a ser sempre o primeiro passo, inclusive para municípios com domínio confirmado. É rápido e costuma trazer nome + contatos já com fontes citadas.
2. Se a IA devolver resultado forte (nome do secretário e/ou contato com fonte oficial do município), a run encerra ali — mais rápido e mais barato que rastrear o site.
3. Se não vier nada aproveitável, cai no **Estágio 0** de hoje: página conhecida da Secretaria e descoberta por sitemap/links dentro do domínio confirmado.
4. Se o Estágio 0 também falhar, a run **continua** para o pipeline normal (snippets orgânicos, scrape do site, buscas escalonadas) em vez de encerrar como `not_found`. O `not_found` só é emitido no fim, com o motivo real.
5. Em todas as etapas o domínio confirmado continua atuando como **filtro anticontaminação**: hosts do próprio município são aceitos, hosts de outros municípios seguem rejeitados como hoje.

O log passa a mostrar claramente a sequência: "Visão Geral por IA → Estágio 0 (domínio confirmado) → busca ampla".

## Detalhes técnicos

- `src/lib/prospect.server.ts`: mover a chamada de `buscarAiOverviewRenderizado` para antes do bloco `if (dominioConfirmado)` (hoje o bloco do Estágio 0 roda por volta das linhas 1772–1841 e faz `return` antes de qualquer SERP).
- Critério de encerramento antecipado pela IA: reaproveitar o que já existe hoje no pipeline completo (nome + contato com fonte de host oficial ⇒ `found`; só nome ⇒ guarda como fallback e segue).
- Remover o `return sendFinal({ status: "not_found", ... })` do caminho de falha do Estágio 0; trocar por um `warn` e deixar o fluxo seguir para o restante da função.
- Passar `dominioConfirmado` adiante para o gate de host já usado por `isConfirmableOfficialHost` / `shortHost`, para manter o bloqueio anticontaminação nas etapas seguintes.
- O nome do secretário obtido pela IA continua preservado como fallback caso as etapas seguintes não achem nada melhor.
- Sem mudança de schema, de fases do lote ou de UI. Bump em `src/lib/version.ts` (Alpha v0.63).

## Impacto de custo

Todo município passa a gastar uma chamada do ator de Visão Geral por IA logo de cara — inclusive os que hoje resolviam de graça no Estágio 0. Em troca, os que hoje voltam `not_found` passam a ter chance real de resultado e a run média tende a ficar mais curta. Se preferir economizar, dá para manter o Estágio 0 na frente só quando existe `paginaEducacaoUrl` conhecida (caminho barato e quase sempre certeiro) e usar a IA primeiro em todo o resto — diga se quer essa variação.
