# Corrigir escolas e matrículas truncadas na importação

## O que está acontecendo hoje (verificado no banco)

- `inep_escolas`: **214.192 escolas gravadas** (ano 2025) — o arquivo do Censo subiu inteiro, sem problema.
- Mas no catálogo só **63 municípios** têm contagem de escolas preenchida.
- Matrículas: só **994 municípios** com total preenchido (e ~997 por etapa), de 5.571.
- FUNDEB (valores em R$): **1.663 municípios** com valor — esse fluxo está funcionando corretamente; o número reflete o que veio na planilha enviada, não uma falha do importador.

## Causa raiz (confirmada)

A camada de dados devolve **no máximo 1.000 linhas por consulta**, mesmo pedindo mais. Confirmei isso na prática: um pedido de 10.000 municípios retorna exatamente 1.000.

O importador pagina em páginas de 10.000 (escolas) e 2.000 (municípios) e usa a regra "se veio menos que o tamanho da página, acabou". Como sempre vêm 1.000, ele para na primeira página:

- Recontagem de escolas por município lê só 1.000 das 214.192 escolas → aplica contagem em 63 municípios.
- O cruzamento de matrículas por UF+nome carrega só 1.000 dos 5.571 municípios → só ~994 conseguem casar; o resto conta como "não encontrado".

Ou seja: os dados **estão** no banco, o que falha é a etapa de consolidação por município.

## Plano de correção

1. **Paginação correta em todas as leituras em massa** (`src/routes/api/admin/import.ts`): usar página de 1.000 e avançar enquanto a página vier cheia, em vez de assumir páginas de 10.000/2.000. Vale para o mapa escola→município, a recontagem de escolas e o catálogo de municípios por nome.
2. **Recontagem de escolas sem varrer linha a linha**: contar as escolas municipais ativas por município direto no banco (contagem agregada por município), evitando trazer 214 mil linhas pela API a cada importação — mais rápido e imune a limite de linhas.
3. **Guarda de sanidade**: se o mapa de municípios carregar menos de 5.000 registros, abortar com mensagem clara em vez de seguir e gravar dados parciais.
4. **Botão "Reconsolidar escolas e matrículas"** na tela de importação: reaplica a contagem de escolas por município a partir do que já está no banco, sem precisar reenviar o arquivo do Censo (214 mil linhas já estão lá).
5. Depois da correção, rodar a reconsolidação e o **recálculo de scores**; reenviar apenas o arquivo de matrículas (FUNDEB_Matriculas) para completar os 5.5xx municípios.
6. Bump de versão para **Alpha v0.54**.

## Detalhes técnicos

- Limite efetivo do PostgREST: `max-rows = 1000`; `.range(from, from+9999)` retorna 1.000 e o `if (rows.length < pageSize) break` encerra o laço prematuramente.
- Recontagem passa a usar contagem agregada por `ibge_id` (RPC/`select` com `count` por grupo ou paginação de 1.000 com laço correto), filtrando `ano`, `tp_dependencia = 3`, `tp_situacao = 1`.
- `loadMunicipioNameMap` e `loadInepEscolaMap` recebem `PAGE = 1000` e condição de parada baseada em página cheia.
- Nenhuma mudança de schema é necessária.
