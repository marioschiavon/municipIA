# Fila de revisão em painel lateral (Alpha v0.51)

## Problema
Hoje os municípios marcados como "precisa revisão" aparecem misturados no log corrido da prospecção. Quando o lote avança (ou um novo lote começa), eles somem de vista sem terem sido tratados.

## O que muda

Layout em duas colunas na aba Prospecção em lotes:

```text
+---------------------------+-------------------------+
| Log do lote (esquerda)    | Precisa de revisão (N)  |
| - andamento + progresso   | - card editável         |
| - todos os municípios     | - card editável         |
| - itens em revisão ficam  | - ...                   |
|   apenas sinalizados      | (fixo, com scroll)      |
+---------------------------+-------------------------+
```

- **Coluna esquerda**: log como hoje, porém sem o formulário de revisão embutido. Itens que precisam de revisão ganham só um aviso âmbar com botão "Revisar" que rola/destaca o card na coluna direita.
- **Coluna direita (nova)**: lista dedicada de pendências, com o formulário de edição da fase (domínio / secretário+cargo / e-mails+telefones), botões "Salvar alterações", "Marcar como revisado" e "Detalhes".
- **Persistência da lista**: um município só sai da fila de revisão quando o admin agir nele (salvar ou marcar como revisado). Iniciar um novo lote limpa o log, mas **não** limpa as pendências ainda não tratadas — elas continuam acumuladas na lateral, com a fase de origem indicada em cada card.
- Contador no topo da coluna ("3 pendências") e estado vazio ("Nenhuma revisão pendente").
- Em telas estreitas as colunas empilham (revisão primeiro).

## Detalhes técnicos

- `src/routes/_authenticated/admin.prospeccao.tsx`:
  - novo estado `revisoes: QueueLogEntry[]` (com `fase` de origem), alimentado por um `useEffect` que observa `queue.log` e faz append de entradas com `result.revisar === true` ainda não presentes (dedupe por `ibge_id` + fase).
  - `marcarResolvido(ibgeId)` passa a remover o item de `revisoes` em vez de só marcar `resolvidos`.
  - `iniciarLote` deixa de zerar as pendências; grid `lg:grid-cols-[minmax(0,1fr)_380px]`.
- Extrair o formulário atual do `LogRow` para um novo componente `RevisaoCard` (mesmo arquivo), reaproveitando `adminResolveRevisao`. `LogRow` fica só com status/motivo/detalhes.
- Sem mudanças de banco de dados nem de server functions.
- `src/lib/version.ts`: bump para Alpha v0.51.
