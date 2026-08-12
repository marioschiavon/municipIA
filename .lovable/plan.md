# Lote completo: parciais na revisão + checagem de atualidade do ator

## 1. Resultados parciais entram na fila de revisão

Hoje só entra na fila lateral o que o backend marcou com `revisar` (`src/lib/prospeccao-lote-context.tsx`, efeito que filtra `queue.log` por `e.result?.revisar`). Um município que voltou com secretário mas sem e-mail/telefone (status "Parcial") fica só no log e passa batido.

Mudança: no modo **Lote completo**, toda entrada cujo resultado não esteja completo vai para a fila de revisão, com o motivo do que faltou:

- status `partial` ou `not_found`;
- ou faltando qualquer um dos três: domínio confirmado, secretário, ao menos um contato (e-mail ou telefone).

O card de revisão já mostra os três campos editáveis quando a fase é `completo`, então nada muda no formulário — só passa a listar mais itens, com um rótulo do que está faltando ("sem contato", "sem secretário", "sem domínio").

Nas fases isoladas 1/2/3 o comportamento continua igual (só entra o que o backend marcou como duvidoso), para não inflar a fila.

## 2. Verificar se o ator está trazendo resultado atual

Estado atual verificado: a chamada em `src/lib/apify.server.ts` (`googleAiOverview`) envia ao ator `apify~google-ai-overviews-scraper` apenas `{ queries: query }` — sem país, idioma nem qualquer parâmetro de recência. Isso significa que a SERP pode ser resolvida em outra região/idioma e a Visão Geral por IA pode se basear em páginas antigas. Ainda não está confirmado que o resultado seja de fato desatualizado; o plano inclui um teste antes de mudar a lógica.

Passos:

1. **Diagnóstico**: rodar o ator para 2–3 municípios cujos dados atuais são conhecidos, com e sem parâmetros de região, e inspecionar o texto bruto + as fontes citadas (URLs e datas). Isso mostra se o problema é região/idioma, cache do ator, ou a própria Visão Geral citando páginas velhas.
2. **Ajustes na chamada** conforme o diagnóstico: enviar país/idioma Brasil-português ao ator e, se o ator suportar, desabilitar reaproveitamento de execução em cache; incluir o ano corrente na query (via template já configurável em `/admin/queries`) para empurrar a SERP para o mandato atual.
3. **Sinal de atualidade no resultado**: guardar e exibir as fontes citadas pela Visão Geral (URL + data quando disponível) no log da run e no card de revisão, para o admin julgar se o nome é do mandato atual.
4. **Regra de desconfiança**: quando o texto da Visão Geral citar um período/mandato anterior (ex.: menção a anos anteriores ao atual) ou não houver fonte oficial (`*.gov.br` do município), o resultado entra na fila de revisão em vez de ser gravado como confiável.

## Detalhes técnicos

- `src/lib/prospeccao-lote-context.tsx`: no efeito que alimenta `revisoes`, adicionar predicado `precisaRevisao(entry, fase)` — em `completo`, inclui parciais/incompletos e monta o motivo faltante.
- `src/routes/_authenticated/admin.prospeccao.tsx`: badge de motivo no `RevisaoCard` quando o item veio por incompletude (texto curto, sem mudar o formulário).
- `src/lib/apify.server.ts`: `googleAiOverview` passa a aceitar opções de região/idioma e repassar ao input do ator; expor o texto bruto e as fontes no retorno (já existe `sources`).
- `src/lib/prospect.server.ts`: propagar fontes da Visão Geral para o `ProspectResult` (campo já usado no `ResultCard`) e aplicar a regra de desconfiança do item 4.
- `src/lib/version.ts`: bump para Alpha v0.65.
