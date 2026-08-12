# Teste de queries do AI Overview + exportação por contato

## 1. Painel de teste de variações da query (admin)

Nova tela `/admin/queries` (link no menu do admin) para descobrir qual formulação da busca no ator de Visão Geral por IA acerta mais contatos.

Como funciona:
- Você cadastra/edita uma lista de variações de query (com placeholders `{municipio}` e `{uf}`). A atual — "nome e contato do secretário(a) de educação de {municipio} {UF}" — já vem como variação padrão.
- Você escolhe o tamanho da amostra (ex.: 5, 10 ou 20 municípios) e a origem da amostra (aleatória entre municípios sem dados, ou uma UF específica).
- Ao rodar, cada variação é executada contra os mesmos municípios da amostra e o painel mostra, por variação: % com nome do secretário, % com e-mail, % com telefone, % com "acerto completo" (nome + pelo menos um contato), tempo médio e falhas.
- A melhor variação fica destacada e você aprova com um botão "Usar como padrão". A partir daí o pipeline de prospecção passa a usar essa query.
- Os resultados da amostra são só para teste: nada é gravado no catálogo dos municípios.

Progresso em tempo real por município/variação, no mesmo estilo do lote de prospecção, com botão de cancelar.

## 2. Exportação: uma linha por contato

O formato antigo (uma linha por município) é substituído. Regras acordadas:

- Cada pessoa vira uma linha: secretário(a) primeiro, depois cada membro da equipe.
- Cada linha leva **um** e-mail e **um** telefone.
- Se uma pessoa tiver mais e-mails/telefones do que linhas, geram-se linhas extras repetindo o nome/cargo dessa pessoa.
- Se sobrarem contatos do município sem pessoa associada (e-mails/telefones genéricos), eles viram linhas repetindo o nome do secretário(a) de educação; se não houver secretário, ficam com nome vazio e cargo "Contato geral".
- Município sem nenhum contato ainda gera uma linha (município, UF, score, sem contato), para não sumir da lista.

Colunas: Município, UF, Nome do contato, Cargo, E-mail, Telefone, Tipo (secretário / equipe / geral), Score, Faixa, Status, Horário, População, Matrículas, FNDE anual, Atualizado em.

Vale igual para CSV e Excel.

Observação: como avisado, isso multiplica as linhas e pode inflar a lista de leads; a coluna "Tipo" permite ao cliente filtrar contatos genéricos no CRM dele.

## Detalhes técnicos

- `src/lib/export.ts`: substituir `municipioRowFor` por um `expandContatos(row): ContatoLinha[]` e reusar em `exportMunicipiosCSV` / `exportMunicipiosXLSX`; novo cabeçalho.
- Query padrão passa a vir de config em vez de string fixa: nova tabela `public.prospect_query_config` (id fixo 1, `query_ai_overview text`, `variantes jsonb`, `updated_at`) com leitura pública e escrita só para admin, mais GRANTs. `src/lib/prospect.server.ts` (Estágio IA, ~linha 1771, e busca rápida, ~1521) lê a query dessa config com fallback para a string atual.
- Novo endpoint `src/routes/api/admin/query-test.ts` (streaming NDJSON, protegido por `requireAdminBearer`) que executa `googleAiOverview` por variação × município e devolve as métricas, sem chamar `persistProspectResult`.
- Nova rota `src/routes/_authenticated/admin.queries.tsx` com a UI do painel; server fns de leitura/gravação da config em `src/lib/admin.functions.ts`.
- Bump de versão em `src/lib/version.ts` para Alpha v0.64.
