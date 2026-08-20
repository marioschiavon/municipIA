# Patch logs para clientes

Criar uma pasta de notas de atualização em markdown, com um arquivo por dia, para os clientes consultarem o que mudou.

## O que será criado

- Pasta `patch-logs/` na raiz do projeto.
- `patch-logs/README.md` — explica o formato (um arquivo por dia, nome `AAAA-MM-DD.md`, mais recente primeiro) e serve de índice.
- `patch-logs/2026-08-19.md` — o registro de hoje (data local Brasil), em português, com linguagem para cliente final (sem jargão técnico).

## Conteúdo do arquivo de hoje

Título com a data e as versões cobertas (Alpha v0.79 e v0.80), organizado em seções curtas:

- **Novidades**
  - Envio em massa para o Leaderei: seleção rápida de municípios (página atual, 10/25/50, 50 não enviados, até 200) e envio de todos os selecionados de uma vez.
  - Marcação "Enviado" nas linhas já exportadas, para não repetir leads.
- **Correções**
  - Acesso via Leaderei: o aviso "acesse pelo Leaderei" não aparece mais indevidamente — a conexão é reestabelecida automaticamente e o domínio de produção do Leaderei passou a ser reconhecido.
  - Diálogo "Exportar leads": layout corrigido em telas menores, com rolagem interna e botões organizados.

Cada item em uma linha, com o impacto prático para o usuário.

## Observações

- Apenas arquivos markdown; nenhuma tela nova no app e nenhuma alteração no código existente.
- Nos próximos dias com mudanças funcionais, um novo arquivo `AAAA-MM-DD.md` será adicionado na mesma pasta.
