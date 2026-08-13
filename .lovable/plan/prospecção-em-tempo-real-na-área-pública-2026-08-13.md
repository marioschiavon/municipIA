# Prospecção em tempo real na área pública

Trazer de volta o botão de prospectar em tempo real para quem acessa o catálogo, e transformar o "Verificar dados" da ficha do município num fluxo inteligente: lê o banco, e só gasta busca quando falta algo.

## O que muda

### 1. Catálogo público (`/`)
- Nova coluna/ação "Prospectar" em cada linha da tabela, aberta a qualquer visitante (sem login).
- Ao clicar, abre um painel leve e visual mostrando o progresso — sem termos técnicos. Apenas frases simples do tipo "Buscando site oficial…", "Procurando secretário…", "Achando contato…", com um indicador animado, para quem está prospectando saber que algo está acontecendo. Ao final, exibe o resultado com secretário, e-mail, telefone e equipe.
- O resultado é gravado no catálogo (mesma persistência do lote), então a linha atualiza status e score depois da execução.

### 2. Ficha do município (`/municipio/:ibgeId`)
O botão "Verificar dados" passa a decidir sozinho:

```text
1. Relê o banco
2. Dados completos e recentes (secretário + e-mail + telefone,
   atualizado nos últimos 180 dias)?
   -> mostra "Dados atualizados" e para (sem custo)
3. Senão -> roda o fluxo 3-em-1 (mesmo do "Lote completo"),
   buscando só o que falta, com progresso em tempo real
4. Salva no catálogo e mostra o resultado atualizado
```

- Enquanto roda, o botão vira "Prospectando…" com a etapa atual e opção de cancelar.
- Se a busca não encontrar nada novo, informa o que continuou faltando (ex.: "Faltou: telefone").

### 3. Regra de "dados completos"
Trio completo (nome do secretário + ao menos um e-mail + ao menos um telefone) e `atualizado_em` dentro de 180 dias. Faltando qualquer peça, roda o fluxo — e o pipeline foca no que está faltando, preservando o que já existe no banco.

## Detalhes técnicos

- `src/routes/api/prospect.ts`: hoje exige bearer de admin (`requireAdminBearer`). Criar um caminho público em `src/routes/api/public/prospect.ts` que reaproveita o mesmo pipeline (`prospectar` / fase `completo`) e a mesma persistência (`persistProspectResult` + `marcarTentativaProspeccao`), sem exigir sessão. A rota admin continua como está.
- Extrair da fila atual (`src/lib/use-prospect-queue.ts`) um hook leve `useProspectStream` para consumir o NDJSON de um único município, com `AbortController` para cancelar; o endpoint usado passa a ser parametrizável (público vs. admin).
- `src/routes/municipio.$ibgeId.tsx`: `verificarDados()` deixa de ser só `refetch` — passa a avaliar completude/recência sobre `q.data.educacao` e, quando necessário, dispara o stream público; ao final, `refetch` para exibir os dados persistidos.
- `src/routes/index.tsx`: botão por linha abrindo um `Dialog` com o progresso e o resultado; ao concluir, invalida as queries `municipios`/`stats`.
- Reaproveitar a lógica de completude usada no lote (`src/lib/prospeccao-lote-context.tsx`) extraindo-a para um helper compartilhado, para admin e público julgarem "completo" da mesma forma.
- Bump de versão para Alpha v0.66 em `src/lib/version.ts`.

## Observação sobre custo

Com o botão aberto a todos, cada clique de um visitante consome crédito de Apify/OpenAI. O plano não inclui limite de uso, conforme decidido. Se depois quiser conter abuso, o ponto natural é a rota pública (limite por IP/sessão) — dá para adicionar sem refazer nada do resto.
