# Prospecção em lote: continuar de onde parou (Alpha v0.50)

## Problema

Hoje a lista de municípios elegíveis é montada por "quem ainda não tem o dado da fase", ordenada por nome (A→Z), e o lote sempre pega os primeiros N. Como quem não foi encontrado continua elegível, todo novo lote recomeça exatamente pelos mesmos municípios que já falharam — nunca avança para o resto da lista.

## Solução: cursor por tentativa (rodízio automático)

Registrar, no banco, a data/hora da última tentativa de cada município em cada fase. A fila passa a ordenar por "quem nunca foi tentado primeiro, depois quem foi tentado há mais tempo". Assim:

- Lote 1 (500) processa os 500 primeiros e marca a tentativa.
- Lote 2 começa no município 501, porque os 500 anteriores passam para o fim da fila.
- Quando todos os elegíveis já tiverem sido tentados uma vez, o ciclo reinicia sozinho pelo mais antigo — que é o comportamento desejado ("depois que ler todos, começa novamente").

O cancelamento no meio do lote não atrapalha: a marcação acontece município a município, ao terminar cada um.

## Alterações

### 1. Banco (migração)

Na tabela `municipios_educacao`, três colunas de tentativa:

- `tentativa_dominio_em` (timestamptz, nulo)
- `tentativa_secretario_em` (timestamptz, nulo)
- `tentativa_contato_em` (timestamptz, nulo)

Índices para ordenação rápida por fase.

### 2. Marcar tentativa a cada município

Em `src/lib/catalog-update.server.ts` (`persistProspectResult` / `persistFaseIsolada`), gravar a coluna de tentativa da fase com `now()` em **todo** resultado — encontrado, parcial ou não encontrado. Em `src/routes/api/prospect.ts`, marcar a tentativa também nos caminhos que hoje encerram antes de persistir (ex.: fase 2/3 sem domínio confirmado e erros de provedor), para que um município problemático não trave a fila em loop.

### 3. Ordenação e seleção do lote

Em `src/lib/admin.functions.ts`:

- `adminListMunicipioIds` passa a ordenar por `tentativa_<fase>_em` ascendente com nulos primeiro (desempate por nome) quando há fase selecionada.
- Aceitar `limit` no servidor para trazer só o tamanho do lote, em vez de carregar todos os elegíveis e cortar no cliente.
- Nova função `adminProspeccaoCiclo`: retorna quantos elegíveis nunca foram tentados, quantos já foram, e a data da tentativa mais antiga — para mostrar o progresso do ciclo.

### 4. Tela `/admin/prospeccao`

- Indicador do ciclo: "Ciclo atual: 1.240 de 3.900 já tentados nesta fase — próximo lote continua de onde parou".
- No card do lote, mostrar de onde o lote começou (primeiro município) e onde parou (último processado).
- Botão "Reiniciar ciclo" (limpa as marcas de tentativa da fase/UF filtrada) para quando o admin quiser forçar recomeço do zero, com confirmação.
- Opção "Repetir só os não encontrados": inverte o critério e prioriza quem já foi tentado e falhou, para uma varredura de repescagem consciente.

### 5. Versão

Bump para **Alpha v0.50** em `src/lib/version.ts`.

## Observações técnicas

- O cursor é por (município, fase), guardado no banco — funciona entre sessões, navegadores e após recarregar a página.
- Filtro de UF continua valendo: o rodízio acontece dentro do recorte filtrado.
- Nada muda no pipeline de busca em si (Apify/OpenAI/scraper); só a seleção e a ordem dos municípios do lote.
