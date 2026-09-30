# Corrigir ordenação da lista de municípios

## Problema
Só "Score" ordena certo. População, matrículas e nome aparecem fora de ordem.

## Causa (confirmada no código)
A lista é lida a partir da tabela de dados de educação, com os dados do município "anexados". Para população, matrículas e nome, o pedido de ordenação é aplicado apenas **dentro** do dado anexado (que tem só 1 item por linha), então a lista principal não é reordenada — sai na ordem de `ibge_id`, parecendo aleatória. Score funciona porque está na tabela principal.

## Correção
Nas duas consultas afetadas em `src/lib/catalog.functions.ts` (listagem paginada e a busca usada na exportação/seleção), trocar a ordenação para ordenar as linhas principais pelo campo do município anexado, usando a sintaxe de ordenação por relação um-para-um: `.order("municipios(nome)")`, `.order("municipios(populacao)")`, `.order("municipios(matriculas_total)")`, mantendo o desempate por `ibge_id`.

## Verificação
Abrir a página inicial e alternar entre População, Matrículas e Nome (crescente/decrescente), conferindo a ordem na primeira e segunda página.

Versão: Alpha v0.82.
