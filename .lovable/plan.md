# Destravar o "sem fallback ao Google" quando o domínio já está confirmado

## O que está acontecendo hoje

Quando o município já tem um domínio oficial confirmado (ex.: `guajaramirim.ro.gov.br`), a prospecção entra no **Estágio 0** e usa esse domínio como fonte **exclusiva**: tenta a página conhecida da Secretaria e, se não houver, descobre candidatos por sitemap/robots/links da home. Se nada útil aparecer, a run encerra imediatamente como `not_found` — sem tentar Google/Apify.

Isso foi uma escolha deliberada de custo feita quando o Estágio 0 foi criado (menos chamadas pagas e zero risco de contaminação com dados de outro município). O texto "por decisão de produto" é literalmente essa regra, escrita no log. Não é erro nem falha do Apify.

O efeito colateral é o caso de Guajará-Mirim: prefeituras cujo site não expõe sitemap nem links de educação na home viram `not_found`, mesmo com o domínio certo em mãos e mesmo com a nova Visão Geral por IA disponível.

## Proposta

Trocar "fonte exclusiva" por "fonte prioritária com fallback":

1. Estágio 0 continua igual e continua sendo a primeira tentativa (barato, sem custo de SERP).
2. Se o Estágio 0 não achar contato útil, em vez de encerrar, a run **continua** para o pipeline normal — começando pela Visão Geral por IA (`apify/google-ai-overviews-scraper`) e depois snippets orgânicos.
3. Nessa continuação, o domínio confirmado vira um **filtro de segurança**, não um bloqueio: resultados de hosts oficiais do município (o domínio confirmado, `*.slug.uf.gov.br`) são aceitos; hosts de outros municípios continuam rejeitados como hoje. Isso preserva o motivo original da regra (anticontaminação) e devolve só o alcance perdido.
4. O log passa a dizer "Estágio 0 sem página localizável — seguindo para Visão Geral por IA + busca", e o `not_found` só é emitido no fim do pipeline completo, com o motivo real.

Custo: só municípios em que o Estágio 0 falha passam a gastar SERP — hoje esses são exatamente os que voltam vazios.

## Detalhes técnicos

- `src/lib/prospect.server.ts`, bloco `if (dominioConfirmado) { ... }` (~linhas 1772–1841): remover o `return sendFinal({ status: "not_found", ... })` do caminho de falha; manter o `return sendFinal(stage0)` no caminho de sucesso e apenas emitir um `warn` antes de cair no restante da função.
- Guardar `dominioConfirmado` numa variável já disponível ao restante do pipeline para reforçar o gate de host (as helpers `isConfirmableOfficialHost` / `shortHost` já recebem `dominioOficial`; passar o confirmado no mesmo lugar).
- Nenhuma mudança de schema, de fases do lote ou de UI.
- Bump de versão em `src/lib/version.ts` (Alpha v0.63).

## Alternativa, se você preferir controle manual

Manter o comportamento atual como padrão e expor um toggle "permitir fallback ao Google quando o domínio confirmado falhar" na tela de Prospecção, aplicado à run/lote. Mais controle, mais um botão para lembrar de ligar.
