# Manual do usuário (público) e manual do admin (interno)

Dois manuais escritos em linguagem simples, sem jargão, explicando passo a passo o que acontece em cada tela. O manual do usuário fica acessível na página inicial; o manual do admin só existe dentro do painel administrativo.

## 1. Manual do usuário — página `/manual`

Link "Manual" no cabeçalho da página inicial (e no cabeçalho da ficha do município). Conteúdo com índice lateral e seções curtas:

- **O que é o MunicipIA** — para que serve o catálogo, o que é um "lead" de Secretaria de Educação.
- **A tela inicial explicada** — o que são os cartões de estatísticas no topo, o que é a tabela e cada coluna (Município, UF, População, Matrículas, Status, Score).
- **Como buscar** — digitar o nome do município na caixa de busca; filtrar por estado (UF), por faixa de score (alto/médio/baixo) e por status (validado / pendente / sem dados); ordenar por score, população, nome ou matrículas; navegar pelas páginas (50 por página).
- **Entendendo o Score e as faixas** — o que significa o número, e que ele soma porte, financeiro, completude de contato e recência.
- **Entendendo o Status** — Validado, Pendente, Sem dados: o que cada um quer dizer na prática.
- **Como prospectar em tempo real** — passo a passo com o que aparece na tela:
  1. Clique no botão de prospectar na linha do município.
  2. Abre uma janela com um círculo girando e frases do que está acontecendo ("Buscando site oficial…", "Procurando secretário(a)…").
  3. A busca pode levar até 2 minutos; é possível cancelar a qualquer momento.
  4. Ao terminar, a própria janela mostra secretário(a), e-mail, telefone e quantos contatos de equipe foram achados.
  5. Fechar a janela: a linha da tabela já aparece atualizada com novo status e score.
  - O que fazer quando não encontra nada, e por que isso acontece (site fora do ar, prefeitura sem página de contato).
- **A ficha do município** — como abrir, o que tem em cada cartão (Secretaria, Equipe, IBGE, INEP, FNDE) e o que é o botão "Verificar dados": ele primeiro olha o que já está salvo; se os dados estiverem completos e recentes, avisa que está atualizado; se faltar algo, roda a busca.
- **Como exportar leads** — abrir "Exportar", escolher quantidade, faixa de score, intervalo de score, tipo de contato (secretário, equipe ou ambos), baixar em CSV ou Excel, e o que cada coluna do arquivo significa (uma linha por contato).
- **Perguntas frequentes** — por que o dado às vezes está desatualizado, o que é a data "Atualizado em", por que o telefone vem sem DDD etc.

## 2. Manual do admin — página `/admin/manual`

Item "Manual" na navegação do painel admin, visível apenas para quem entra no painel (a área já bloqueia quem não é admin). Não aparece em nenhum lugar da área pública.

Seções, cada uma cobrindo todas as opções da tela:

- **Como entrar e quem tem acesso** — login, papel de admin, mensagem de acesso restrito, sair.
- **Dashboard** — o que cada número significa e como ler a cobertura do catálogo.
- **Municípios** — busca, filtros, abrir a ficha administrativa, editar campos manualmente, o que é salvo.
- **Prospecção em lotes** — a tela mais detalhada:
  - diferença entre Fase 1, Fase 2, Fase 3 e Lote completo (3 em 1);
  - como o sistema "continua de onde parou";
  - como escolher tamanho do lote e acompanhar o progresso;
  - a fila lateral de revisão: por que um município cai ali (resultado parcial, confiança baixa, informação antiga), como revisar, aprovar ou corrigir;
  - custo: cada execução consome créditos das buscas.
- **Importar** — planilhas do INEP e do FNDE/FUNDEB, formatos aceitos (CSV, .gz), o que é atualizado, como ler o log de importação e o que fazer quando faltam municípios.
- **Teste de queries** — para que serve, como criar variações de busca, o marcador `{ano}`, como ler as métricas de acerto e adotar a melhor query.
- **Pesos do score** — o que é cada peso (porte, financeiro, completude, recência), como alterar e recalcular, e o efeito nas faixas.
- **Boas práticas e solução de problemas** — o que fazer quando as buscas retornam vazias, quando há erro de cota, e como validar dados em massa.

## Detalhes técnicos

- Novas rotas: `src/routes/manual.tsx` (pública) e `src/routes/_authenticated/admin.manual.tsx` (dentro do layout admin, herda o bloqueio de papel).
- Conteúdo em componentes de apresentação reutilizáveis (`src/components/manual/…`): cabeçalho de seção, bloco de passos numerados, caixa de dica/aviso — sem lógica nova de negócio.
- Índice de navegação por âncoras dentro de cada página (rolagem interna), usando os tokens de cor existentes.
- Link "Manual" no cabeçalho de `src/routes/index.tsx` e item de navegação no `src/routes/_authenticated/admin.tsx`.
- `head()` próprio na rota pública com título e descrição específicos do manual.
- Bump para Alpha v0.68 em `src/lib/version.ts`.
