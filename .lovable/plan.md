# Usar a "Visão geral por IA" do Google na prospecção (Alpha v0.60)

## O que está acontecendo hoje

A busca no Apify (`apify/google-search-scraper`, em `src/lib/apify.server.ts`) traz a página inteira de resultados do Google, mas o código aproveita **somente a lista de links orgânicos** (título + descrição). Tudo o que aparece no topo da página — a caixa "Visão geral criada por IA", o painel lateral da prefeitura, as perguntas relacionadas — é descartado antes de chegar na extração.

É exatamente onde está a resposta pronta no seu exemplo de Dirceu Arcoverde: nome do secretário, telefone, e-mail, endereço, horário e site oficial estão no bloco de IA, e nenhum deles chega ao pipeline.

## O que muda

1. **Capturar o topo da SERP**: passar a ler também `aiOverview`, o painel de conhecimento e as "perguntas relacionadas" retornados pelo mesmo ator do Apify, sem custo extra de requisição.
2. **Tratar o bloco de IA como fonte de altíssima prioridade**: ele entra na extração antes de qualquer página raspada. Se ele já traz nome + telefone + e-mail, a run termina ali, sem precisar abrir o site da prefeitura (mais rápido e mais barato).
3. **Validação anti-alucinação**: os dados vindos do bloco de IA só são aceitos como confiança alta quando as fontes citadas nele forem do próprio município (domínio `.gov.br` do município ou domínio já confirmado). Caso contrário entram como confiança média e vão para a fila de revisão, com a origem marcada como "visão geral do Google".
4. **Rastreabilidade**: a origem passa a distinguir `ai-overview` de `snippet`/`site`, e o log em tempo real mostra "Resposta encontrada na visão geral do Google" quando for o caso.
5. **Endereço e horário**: o bloco costuma trazer endereço e horário de atendimento; o horário já é gravado hoje, e o endereço passa a ser guardado junto do contexto da fonte.

## Se o Apify não devolver o bloco de IA

O bloco de IA nem sempre aparece (depende da consulta e do país). Nesses casos o fluxo atual segue igual: orgânicos → leitura de página → OpenAI → Gemini. Nenhuma etapa existente é removida.

## Detalhes técnicos

- `src/lib/apify.server.ts`: `googleSerp()` passa a devolver, além de `pages`, um objeto `serpExtras` com `aiOverview` (texto + fontes citadas), `knowledgePanel` e `peopleAlsoAsk`; incluir `includeUnfilteredResults`/campos do topo no input do ator e ler `it.aiOverview`, `it.peopleAlsoAsk`, `it.knowledgeGraph` do item retornado.
- `src/lib/prospect.server.ts`: no dispatcher de busca, injetar o texto da visão geral como primeiro documento do contexto de extração (marcado `[VISÃO GERAL GOOGLE]`), com regra no prompt de que ele só vale se corroborado pelas fontes citadas; nova origem `"ai-overview"` em `nomeFonte`.
- `src/lib/prospect.types.ts`: adicionar `"ai-overview"` ao union de `nomeFonte`.
- Validação de município reaproveita as checagens já existentes (nome da cidade no domínio, DDD do telefone).
- Bump em `src/lib/version.ts` para `Alpha v0.60`.
