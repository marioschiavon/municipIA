
# MunicipIA — Pivot para Catálogo Nacional com Score de Prospecção (Alpha v0.28)

Mudamos de "tudo em tempo real" para "catálogo persistente de todos os 5.570 municípios com score de prospecção calculado". O scraping existente vira o botão **Atualizar agora** de cada município.

## 1. Nova arquitetura

```text
Cloud (Supabase)
├── municipios              (5570 linhas, seed IBGE)
├── educacao_contatos       (secretário, cargo, emails, telefones, horário, equipe)
├── indicadores_ibge        (população, PIB per capita)
├── indicadores_inep        (matrículas: infantil/fundamental/médio, escolas)
├── indicadores_fnde        (repasses anuais R$, PNAE, PDDE)
├── municipio_scores        (score 0-100, faixa, breakdown JSON)
└── prospeccao_status       (status por município: pendente/scraped/validado/ignorado)
```

Todos os dados iniciais são **mocados de forma determinística** (seed baseada no ibgeId) para gerar números plausíveis por porte da cidade.

## 2. Score (fórmula da demo)

Score 0–100, pesos:
- **35%** Porte de mercado — log(população) normalizado + log(matrículas totais INEP).
- **30%** Volume financeiro — log(repasses FNDE anuais).
- **20%** Completude de contato — % de campos preenchidos (nome, cargo, email institucional, telefone, horário, equipe).
- **15%** Recência do dado — dias desde última validação (decai em 180d).

Faixas: **Alto ≥ 70**, **Médio 40–69**, **Baixo < 40**. Breakdown salvo em JSON para a UI mostrar de onde veio o número.

## 3. Novas telas

- **`/` — Catálogo** (substitui a busca atual): tabela paginada + virtual scroll com todos os 5.570 municípios. Colunas: Município · UF · População · Matrículas · Score (badge colorido) · Status · Ação. Filtros: UF, faixa de score, status, busca por nome. Ordenação por qualquer coluna.
- **`/municipio/$ibgeId`** — Ficha completa: header com score e breakdown, cards de Contato/IBGE/INEP/FNDE/Equipe, timeline de atualizações, botão **Atualizar agora** (dispara o pipeline atual em streaming).
- **`/debug`** — mantida.

Sidebar velha (histórico + explicações) sai; entra sidebar de filtros do catálogo.

## 4. Pipeline atual vira "Atualizar agora"

`prospectar()` continua igual, mas agora:
- É chamado **só via botão** na ficha do município.
- No fim, salva em `educacao_contatos` + recalcula `municipio_scores`.
- Timeline NDJSON aparece dentro de um Sheet lateral na ficha, não na home.

## 5. Seed de demo

Migration única que:
1. Insere os 5.570 municípios (fetch IBGE server-side na migration ou lista embarcada).
2. Gera mocks determinísticos por `ibgeId` para IBGE/INEP/FNDE/contatos (~60% dos municípios com contato "validado", 25% "pendente", 15% sem dados).
3. Calcula scores iniciais via trigger/função.

## 6. Versionamento

`src/lib/version.ts` → **Alpha v0.28**. (Sem chegar em v1.0 sem autorização — regra core.)

---

## Detalhes técnicos

- **Persistência**: Lovable Cloud. Tabelas `public.*` com GRANTs para `authenticated` + `anon` (catálogo é público leitura); writes via server fn com `requireSupabaseAuth` (ou service role em `.server.ts` para o pipeline).
- **RLS**: SELECT liberado a `anon` no catálogo; INSERT/UPDATE em `educacao_contatos` e `prospeccao_status` só via `supabaseAdmin` dentro do handler do server fn de atualização.
- **Server fns novos** (em `src/lib/catalogo.functions.ts`): `listMunicipios({ uf, faixa, status, q, page })`, `getMunicipio(ibgeId)`, `atualizarMunicipio(ibgeId)` (chama `prospectar` + persiste + recalcula score).
- **Score**: função SQL `public.calcular_score(ibgeId)` + trigger em updates de contatos/indicadores. Breakdown retornado como JSON.
- **Mock determinístico**: PRNG com seed = `ibgeId`. População real do IBGE quando possível; INEP/FNDE derivados proporcionalmente.
- **UI**: tabela com `@tanstack/react-table` + `@tanstack/react-virtual` (já compatível). shadcn `Badge` para faixas de score, `Sheet` para timeline de atualização.
- **Rotas**: `src/routes/index.tsx` reescrita (catálogo), nova `src/routes/municipio.$ibgeId.tsx`.
- **Cache local** (`result-cache.ts`): desativado — verdade agora é o banco.

## Fora do escopo (v0.29+)

- Autenticação de usuários (catálogo público por ora).
- Job em background para atualizar municípios em lote.
- Integração real com APIs INEP/FNDE (fica mock até cliente validar).
- Exportação da lista filtrada em CSV/XLSX (fácil de adicionar depois, aviso caso queira já nessa versão).
