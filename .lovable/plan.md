
# Alpha v0.29 — Painel Admin + Dados Reais

## Escopo

1. **Auth** email/senha com role `admin`. Primeiro admin definido por email na migration (pergunto qual usar antes de rodar).
2. **Painel `/admin`** protegido, com abas: Municípios, Contatos, Indicadores, Import, Pesos.
3. **Zerar mocks**: limpa `municipios_educacao` (contatos+score) e zera colunas de indicadores em `municipios` (`matriculas_total`, `escolas`, `fnde_anual`, `pib_percapita`). Mantém os 5.570 municípios.
4. **Ingestão real** por três vias:
   - **IBGE** (server fn): atualiza lista de municípios e população via API pública `servicodados.ibge.gov.br`. Roda sob demanda pelo botão "Sincronizar IBGE".
   - **Import CSV/XLSX** no painel: upload → preview → confirmar. Templates para INEP (matrículas por etapa), FNDE (repasses anuais) e Contatos.
   - **Scraping**: botão "Atualizar agora" da ficha continua igual, mas agora só grava contatos (não mais mock).
5. **Matrículas por etapa** em nova tabela `municipios_matriculas` (creche, pré, fund_anos_iniciais, fund_anos_finais, médio, eja, especial). Total continua em `municipios.matriculas_total` como soma.
6. **Configuração de pesos** em nova tabela `score_config` (singleton, editável só por admin) com:
   - Pesos macro: porte, financeiro, completude, recência (soma = 100).
   - Pesos por etapa (peso relativo de cada etapa dentro do bloco "Porte/Matrículas").
   - Faixas: limites alto/médio.
7. **Score recalculado** usando os pesos do banco (não mais constantes no código). Botão "Recalcular tudo" no painel.

## UI

- `/admin` — dashboard com contagens (municípios, com contato, com indicadores reais, mocados/vazios) e atalhos.
- `/admin/municipios` — tabela editável (busca, filtro por UF/status).
- `/admin/municipios/$ibgeId` — edição manual completa (contatos, indicadores, matrículas por etapa).
- `/admin/import` — wizard de upload (escolhe tipo, mapeia colunas, preview, confirma).
- `/admin/pesos` — form dos pesos + preview do impacto em 5 municípios de amostra.
- Header ganha link "Admin" quando logado como admin.

## Banco (migração única)

- `user_roles` (padrão user-roles do guia) + enum `app_role`.
- `municipios_matriculas` (ibge_id PK, colunas por etapa, ano_ref).
- `score_config` (singleton, JSON de pesos + faixas).
- `import_jobs` (auditoria de imports: tipo, linhas, quem, quando).
- Função `calcular_score(ibge_id)` reescrita para ler `score_config`.
- Trigger para primeiro admin: quando `auth.users` for criado com o email autorizado + email confirmado, insere `user_roles(admin)`.
- Grants + RLS: leitura pública mantida; escrita só via `has_role(auth.uid(),'admin')`.

## Server fns novos (`src/lib/admin.functions.ts`, protegidas por `requireSupabaseAuth` + check de admin)

- `resetMockData()` — zera contatos e indicadores mocados.
- `syncIbge()` — puxa lista IBGE e faz upsert.
- `importCsv({ tipo, rows })` — INEP / FNDE / Contatos.
- `upsertMunicipioEdit({ ibgeId, ...campos })`.
- `getScoreConfig()` / `updateScoreConfig(cfg)`.
- `recalcularTodosScores()`.

## Detalhes técnicos

- Rota gate `src/routes/_authenticated/route.tsx` (managed integration) + subgate `_admin` que checa `has_role`.
- Página `/auth` (email/senha, sem signup público — admin cria usuários via painel usando `supabaseAdmin.auth.admin.createUser` dentro de server fn).
- Import CSV: parse com `papaparse`, XLSX com `xlsx` (SheetJS já instalado). Preview mostra primeiras 20 linhas + erros de validação Zod por linha.
- Pesos: JSON validado por Zod. Fórmula atual em `catalog-score.ts` migra para usar config; assinatura vira `calcularScore(inputs, config)`.
- Versão sobe para **Alpha v0.29**.

## Fora do escopo (v0.30+)

- Convite público / auto-cadastro de usuários.
- Import em background com fila (por ora síncrono, com progresso via NDJSON).
- Histórico de versões dos pesos.
- Integração real com API INEP/FNDE (usam import CSV; APIs oficiais são limitadas).

## Pergunta antes de rodar

Qual email vai virar o primeiro admin? (uso na migration para promover automaticamente após confirmação de email).
