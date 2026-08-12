# Lote completo (3 fases juntas) na tela de Prospecção

Hoje `/admin/prospeccao` só roda fases isoladas (Fase 1 domínio, Fase 2 secretário, Fase 3 contato). A busca "completa" (domínio + secretário + contato numa passada só) já existe no backend (`prospectar`, com persistência e marcação de tentativa como "completo"), mas não está exposta como modo de lote. O plano é adicionar esse quarto modo mantendo as mesmas regras de rodízio (continuar de onde parou / repescagem), fila lateral de revisão e cancelamento.

## O que muda para o usuário

- Nova opção **"Lote completo"** ao lado de Fase 1/2/3, selecionável do mesmo jeito.
- Ao escolher, o contador de elegíveis, o progresso do ciclo ("X de Y já tentados") e o botão "Reiniciar ciclo" passam a refletir esse modo.
- Elegíveis do lote completo: municípios que ainda não têm secretário **ou** não têm nenhum e-mail/telefone (não exige domínio confirmado, porque a busca completa descobre o domínio sozinha).
- Cada município roda a pipeline inteira e grava o resultado consolidado; itens duvidosos continuam caindo na fila lateral de revisão, marcados como "Completo".
- A run começa sempre pela **Visão Geral por IA do Google** (ator `apify/google-ai-overviews-scraper`, navegador real na SERP), com as fontes citadas; só depois entram os snippets orgânicos e o scrape do site oficial. O log em tempo real mostra quando o bloco de IA foi acionado.
- Intervalo entre municípios maior (a run é mais cara): ~40s, ajustável.

## Detalhes técnicos

1. `src/lib/catalog-update.server.ts`: adicionar `completo: "tentativa_completo_em"` ao mapa de colunas e passar a gravar também essa coluna em `marcarTentativaProspeccao` quando a fase é `completo` (mantendo a gravação das três colunas atuais).
2. Migração: `ALTER TABLE public.municipios_educacao ADD COLUMN IF NOT EXISTS tentativa_completo_em timestamptz;` (cursor próprio do rodízio completo, para não embaralhar o cursor das fases isoladas). Regenerar os tipos.
3. `src/lib/admin.functions.ts`: incluir `"completo"` nos enums de `adminListMunicipioIds`, `adminProspeccaoCiclo`, `adminResetCicloProspeccao` e do count de elegíveis; adicionar o filtro de elegibilidade (`secretario is null OR emails = '{}' OR telefones = '{}'` via `.or(...)`) em `applyFaseFilterEdu`/`applyFaseFilter`, e mapear a coluna de tentativa nova.
4. `src/routes/api/prospect.ts`: nenhuma mudança de pipeline — `fase: "completo"` já chama `prospectar`, que hoje já inicia por `buscarAiOverviewRenderizado` (ator `apify/google-ai-overviews-scraper`) antes dos snippets; apenas confirmar que a checagem de "domínio obrigatório" continua restrita a secretário/contato e que o timeout de 120s do ator cabe no intervalo do lote.
5. `src/lib/use-prospect-queue.ts` e `src/lib/prospeccao-lote-context.tsx`: ampliar `FaseIsolada` para incluir `completo`, com intervalo próprio (40s) e rótulo curto "Completo"; a fila de revisão passa a aceitar itens dessa origem.
6. `src/routes/_authenticated/admin.prospeccao.tsx`: botão do novo modo, rótulos (`FASE_LABEL`/`FASE_CURTA`), e no card de auditoria inline exibir os três campos (domínio, secretário, contatos) quando o item vier do lote completo.
7. `adminResolverRevisao` / `limparRevisaoFases`: aceitar `completo` no enum e tratar como "limpa domínio + secretário + contato".
8. Bump de versão em `src/lib/version.ts` (Alpha v0.62).
