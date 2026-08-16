# Corrigir "recusou a conexão" do MunicipIA dentro do Leaderei

## O que eu verifiquei agora

- O Leaderei realmente embute `https://municipia.lovable.app/` (confirmado no código publicado do Leaderei).
- O MunicipIA publicado já responde com a permissão de exibição em iframe para `app.leaderei.com.br` e `*.lovable.app`.
- Simulei o Leaderei carregando o MunicipIA em iframe: o app **carrega normalmente** e mostra a tela "Este aplicativo só funciona dentro do Leaderei" (esperado, porque o pai simulado não envia a sessão).

Conclusão: em navegação normal (app.leaderei.com.br) a exibição funciona. O "recusou a conexão" acontece quando o Leaderei é aberto **dentro do editor/preview do Lovable**: aí o MunicipIA vira um iframe dentro de outro iframe, e a lista de permissões precisa incluir também o domínio do editor (`lovable.dev`). Como hoje ele não está liberado, o navegador recusa a conexão.

## O que será feito

1. Liberar a exibição em iframe também para os domínios do editor/preview do Lovable (`lovable.dev` e subdomínios), mantendo os domínios do Leaderei já liberados.
2. Aceitar o cenário de iframe aninhado no handshake: o MunicipIA passa a avisar "estou pronto" para a janela pai e para a janela do topo, e continua aceitando a sessão apenas quando ela vem de uma origem do Leaderei.
3. Manter o bloqueio: sem sessão do Leaderei, a tela de bloqueio continua aparecendo.
4. Subir a versão para Alpha v0.76.
5. Depois de aplicar, é preciso **publicar** o MunicipIA — o domínio publicado só muda quando republicado.

## Detalhes técnicos

- `src/server.ts` e `vite.config.ts`: acrescentar `https://lovable.dev https://*.lovable.dev` ao `frame-ancestors` (mantendo `app.leaderei.com.br`, `leaderei-app.lovable.app`, `*.lovable.app`, `*.lovableproject.com`).
- `src/lib/leaderei-bridge.ts`: no ping de `municipia:ready`, enviar também para `window.top` quando diferente do pai; validação de `event.origin` contra `LEADEREI_ORIGINS` permanece igual.
- `src/lib/version.ts`: Alpha v0.76.

## Fora do escopo

- Nenhuma mudança na prospecção, exportação ou no ingest do Leaderei.
