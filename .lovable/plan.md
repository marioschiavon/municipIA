
## Problema

O fluxo atual exige dois uploads (Escolas → Matrículas) e faz o join via `CO_ENTIDADE` na tabela `inep_escolas`. Resultado prático:

- Se o admin sobe só o `Tabela_Matricula`, o passo de agregação depende do mapa `inep_escolas` estar populado — se não estiver, tudo é ignorado silenciosamente e "não aparece nada".
- Mesmo quando os dois uploads rodam, qualquer diferença no `CO_ENTIDADE` (ou filtro `dep=3/sit=1` estrito) zera o batch.
- O `Tabela_Matricula` do Censo Escolar **já traz `CO_MUNICIPIO`, `TP_DEPENDENCIA` e `TP_SITUACAO_FUNCIONAMENTO` em cada linha** (uma linha por escola). Então o join escola↔município é redundante.

## Solução — importação única de matrículas

Um único upload (`Tabela_Matricula_YYYY.csv`) resolve tudo:

1. Ler o CSV com autodetecção de delimitador/encoding (já existe).
2. Para cada linha, filtrar `TP_DEPENDENCIA=3` (municipal) e `TP_SITUACAO_FUNCIONAMENTO=1` (ativa).
3. Agregar por `CO_MUNICIPIO`:
   - Soma das colunas `QT_MAT_*` → matrículas por etapa (creche, pré, fund_ai, fund_af, médio, EJA, especial, profissionalizante).
   - Contagem de linhas → número de escolas municipais ativas.
4. Persistir:
   - `municipios.matriculas_total` e `municipios.escolas` via `UPDATE` por `ibge_id`.
   - `municipios_matriculas_etapa` (apaga ano corrente e reinsere).
5. Recalcular scores em massa.

## Mudanças

**1. `src/routes/api/admin/import.ts`**
- Reescrever `processInepMatriculas` para não depender de `inep_escolas`: ler `CO_MUNICIPIO`, `TP_DEPENDENCIA`, `TP_SITUACAO_FUNCIONAMENTO`, `CO_ENTIDADE` + `QT_MAT_*` direto do CSV de matrículas.
- Telemetria clara: total de linhas, quantas passaram o filtro dep=3/sit=1, quantos municípios agregados, soma total de matrículas, amostra dos 3 primeiros IBGEs com totais.
- Manter `processInepEscolas` como opcional (só atualiza contagem de escolas se o admin quiser importar antes), mas deixar de ser pré-requisito.

**2. `src/routes/_authenticated/admin.import.tsx`**
- Reordenar/renomear cartões:
  - **1. INEP — Matrículas** (principal, único obrigatório): agora também popula contagem de escolas.
  - **2. INEP — Escolas** (opcional): rotulado como "opcional / dados detalhados por escola".
  - **3. FNDE — FUNDEB**: inalterado.
- Ajustar textos explicativos: "só o arquivo de Matrículas já é suficiente para popular matrículas por etapa e contagem de escolas municipais ativas".

**3. `src/lib/version.ts`** → `Alpha v0.36`.

## Fora de escopo
- Nenhuma alteração de schema (a tabela `inep_escolas` continua existindo, apenas deixa de ser pré-requisito).
- Nenhuma alteração no FNDE ou no cálculo do score.
