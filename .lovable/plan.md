## O que verifiquei agora

- O Apify está funcionando: consulta SERP de teste (`site:maringa.pr.gov.br prefeitura`) voltou 10 resultados em 8s.
- O banco mostra 5.571 municípios, 274 com domínio e 267 registros atualizados nas últimas 24h — ou seja, a Fase 1 grava sim em parte dos casos; não é uma pane global.
- Por isso **não dá para afirmar uma causa única** para os `not_found` atuais: cada município pode falhar por um motivo diferente (SERP sem resultado, host não confirmável pelo padrão `slug.uf.gov.br`, resultados descartados por UF/município estranho, timeout).
- O problema real hoje é de visibilidade: cada fase já produz um motivo (`empty("Nenhum domínio oficial confirmável encontrado nesta fase.")`, avisos `warn` como "Removi N resultados .gov.br de outra UF", "Sem candidatos por sitemap/home") mas **nada disso chega na linha do painel** — a fila só mostra `not_found` e "0 contato(s)".

## O que fazer

1. **Propagar o motivo até a tela**
   - Na fila (`use-prospect-queue.ts`), além de capturar erros, guardar também o último evento `warn` e o campo `contexto` do resultado final.
   - Montar um `detalhe` legível: motivo do resultado (`contexto`) e, se houver, o último aviso relevante.

2. **Rótulos em português no log e na tabela**
   - `found` → **OK**
   - `partial` → **Parcial**
   - `not_found` → **Não encontrado**
   - `error` → **Erro**
   - Somente rótulo de exibição; os valores internos e no banco continuam iguais para não quebrar filtros e gravação.

3. **Mostrar o motivo na linha**
   - Em `Não encontrado` e `Erro`, exibir o motivo abaixo do nome do município (texto pequeno, cor de alerta), com o motivo completo em `title` para copiar/relatar.
   - Em `OK`, manter o resumo curto (domínio confirmado / nome encontrado / nº de contatos).

4. **Motivos mais específicos nas fases** (mensagens em `prospect.server.ts`)
   - Fase 1: distinguir "a busca não retornou nenhum resultado" de "vieram N resultados, mas nenhum host confirmável (ex.: só facebook/portal estadual)" e de "timeout na busca".
   - Fase 2: distinguir "sem candidatos de página de educação no domínio" de "páginas lidas, mas IA não achou nome".
   - Fase 3: distinguir "nenhuma página legível (scrape bloqueado)" de "página lida sem contato".

5. Bump de versão em `src/lib/version.ts` (Alpha v0.47).

## Detalhes técnicos

- Arquivos: `src/lib/use-prospect-queue.ts` (captura de motivo), `src/routes/_authenticated/admin.prospeccao.tsx` (rótulos + linha de motivo), `src/routes/_authenticated/admin.municipios.index.tsx` (mesmos rótulos), `src/lib/prospect.server.ts` (mensagens de motivo mais específicas), `src/lib/version.ts`.
- Sem mudança de schema no banco.

## Validação

Rodar um lote pequeno da Fase 1 (5 municípios) e confirmar que cada linha "Não encontrado" traz um motivo textual utilizável — com esses motivos em mãos, dá para diagnosticar com precisão a causa real dos `not_found` em massa no próximo passo.
