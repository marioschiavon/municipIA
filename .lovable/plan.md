## Alpha v0.31 — Ingestão de dados reais (IBGE API + upload INEP/FNDE)

Meta: sair de dados zerados para catálogo com população (IBGE), matrículas/escolas (INEP) e repasses (FNDE) reais. Sem versionamento por ano — cada import sobrescreve o valor mais recente.

---

### 1. IBGE — População via API (automático)

Novo server fn `adminSyncPopulacao` em `src/lib/admin.functions.ts`:
- Chama `https://servicodados.ibge.gov.br/api/v3/agregados/6579/periodos/-1/variaveis/9324?localidades=N6[all]` (última estimativa disponível, todos os 5.570 municípios em uma única resposta).
- Faz parse de `resultados[0].series[].localidade.id` + `serie[<ano>]` → `{ ibge_id, populacao }`.
- Faz **UPDATE** em lote (chunks de 500) na tabela `municipios` — nunca apaga os municípios.
- Retorna `{ total, ano }` para exibir no admin.

UI: botão "Sincronizar população (IBGE)" no `admin.index.tsx`, ao lado do "Sincronizar municípios IBGE", com toast do ano de referência.

---

### 2. INEP — Upload CSV (dois formatos)

Nova rota `src/routes/_authenticated/admin.import.tsx` com upload de arquivo + seletor de tipo (INEP matrículas | INEP escolas | FNDE repasses).

**Server fn** `adminImportInep` (aceita `FormData`):
- Parser detecta formato automaticamente pelas colunas do header:
  - **Bruto (microdados)**: colunas `CO_MUNICIPIO`, `TP_ETAPA_ENSINO` (e `NU_MATRICULAS`/`CO_PESSOA_FISICA`) → agrega `count()`/`sum()` por município e mapeia código IBGE + etapa (enum `etapa_ensino`).
  - **Resumido**: colunas `ibge_id, etapa, matriculas` (opcional `escolas`) → mapeamento direto.
- Mapeamento de etapas INEP → enum:
  - Creche (1,2) → `creche`
  - Pré-escola (3,4) → `pre_escola`
  - Fund. AI (5–8, 14, 15) → `fundamental_ai`
  - Fund. AF (9–14, 41) → `fundamental_af`
  - Médio (25–38) → `medio`
  - EJA (65–74) → `eja`
  - Especial (varia) → `especial`
  - Prof. (30, 39, 40) → `profissionalizante`
- Para `municipios_matriculas_etapa`: **limpa as linhas daquele município** e reinsere as etapas do arquivo. Isso garante que etapas removidas/zeradas no novo arquivo desapareçam do banco.
- Atualiza `municipios.matriculas_total` = soma agregada e `municipios.escolas` (se arquivo de escolas) via **UPDATE**.

**Parser**: usar `papaparse` (streaming, aguenta arquivo grande) — adicionar dependência.

**Limite prático**: arquivos > 50 MB devem ser pré-processados. Aviso na UI. Processamento em chunks de 5k linhas com barra de progresso via NDJSON stream (server route `/api/admin/import` com auth via bearer no header).

---

### 3. FNDE — Upload CSV/XLSX

Server fn `adminImportFnde` (mesma rota de upload):
- Aceita CSV ou XLSX (usar `xlsx` — já usado no export).
- Formato esperado: `codigo_ibge` (ou `municipio`+`uf`), `valor_total` (ou colunas de parcelas mensais).
- Auto-detect: se houver `janeiro..dezembro`, soma; senão usa `valor_total`.
- Faz **UPDATE** de `municipios.fnde_anual` por `ibge_id`.
- Relatório: `{ atualizados, nao_encontrados: [] }`.

---

### 4. UI Admin — nova aba "Importar dados"

`src/routes/_authenticated/admin.import.tsx`:
- Cards por fonte (IBGE / INEP Matrículas / INEP Escolas / FNDE).
- IBGE: botão de sync direto.
- INEP/FNDE: dropzone + preview das primeiras 5 linhas + botão "Processar".
- Log em tempo real (usa `debug-log.ts` já existente) com progresso.
- Após import, botão "Recalcular scores" que dispara `adminRecalcularScores` (novo server fn que roda `calcularScore` em todos os `municipios_educacao`).

Menu lateral do admin (em `admin.tsx`) ganha item "Importar dados" → `/admin/import`.

---

### 5. Recálculo em massa

Novo `adminRecalcularScores` (server fn):
- Lê todos `municipios` + `municipios_educacao` em batches de 500.
- Recalcula `score`, `faixa`, `breakdown` via `calcularScore`.
- Faz **UPDATE** em batch.
- Retorna `{ total, faixas: { alto, medio, baixo } }`.

Chamado automaticamente ao fim de cada import (IBGE, INEP, FNDE) e disponível como botão manual.

---

### Detalhes técnicos

- **Dependências novas**: `papaparse` (+ `@types/papaparse`). `xlsx` já existe.
- **Upload**: `<input type="file">` + `FormData` para `/api/admin/import` (server route com `requireSupabaseAuth` inline + check de admin). Server fn não é ideal para arquivos > alguns MB.
- **Segurança**: rota `/api/admin/import` valida bearer via `requireSupabaseAuth` e chama `has_role(userId, 'admin')` antes de processar.
- **Bump**: `Alpha v0.30 → v0.31` em `src/lib/version.ts`.
- **Sem migração SQL**: schema atual (`municipios`, `municipios_matriculas_etapa`) já cobre todos os campos.
- **Fora de escopo**: histórico por ano, scraping automatizado FNDE, dashboard comparativo.

---

### Onde baixar (instruções na UI, ao lado de cada card)

- INEP Matrículas/Escolas: portal INEP → Censo Escolar → Microdados (ZIP anual, ~500 MB descompactado — o usuário deve extrair apenas `MATRICULAS_*.CSV` e `ESCOLAS.CSV`).
- FNDE: portal FNDE → Consultas → Liberações → filtrar por ano → exportar CSV/XLSX.
