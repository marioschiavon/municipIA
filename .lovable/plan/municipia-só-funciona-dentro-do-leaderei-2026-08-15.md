# MunicipIA só funciona dentro do Leaderei

O MunicipIA passa a ser um aplicativo embutido: qualquer acesso direto pelo domínio próprio (ou por qualquer site que não seja o Leaderei) fica bloqueado com uma tela explicativa.

## Regras acordadas

- Bloqueio vale para tudo: catálogo, ficha do município, manual público, `/admin`, `/debug` e telas de depuração.
- Estar dentro do iframe não basta: se o handshake com o Leaderei não entregar a sessão (token), o app mostra aviso e não libera o conteúdo.
- Só o Leaderei é aceito como "pai": `app.leaderei.com.br`, `leaderei-app.lovable.app` e o preview do Leaderei no Lovable.

## Como fica na prática

1. O app abre e, em vez de renderizar a tela, mostra um estado de "Conectando ao Leaderei…".
2. Ele avisa o Leaderei que está pronto e espera a sessão (algumas tentativas, ~4 segundos no total).
3. Sessão recebida: o app libera normalmente todas as telas.
4. Sem sessão, ou aberto fora do iframe: tela de bloqueio com o texto "Este aplicativo só funciona dentro do Leaderei" e um botão "Abrir o Leaderei".
5. A tela de bloqueio é marcada como não indexável, para o domínio próprio não aparecer em buscas.

## Detalhes técnicos

- `src/lib/leaderei-bridge.ts` ganha um estado de handshake (`aguardando` / `conectado` / `bloqueado`) e um hook `useLeadereiGate()` que dispara o `initLeadereiBridge()` uma única vez e expõe esse estado. A verificação de "pai" continua restrita à lista `LEADEREI_ORIGINS`.
- `src/routes/__root.tsx` envolve o `<Outlet />` num componente `LeadereiGate`:
  - Durante SSR e antes da hidratação renderiza o estado neutro de carregamento (nada de conteúdo real).
  - `aguardando` → tela "Conectando…"; `conectado` → `<Outlet />`; `bloqueado` → tela de bloqueio.
  - `<Toaster />` continua montado nos três estados.
- Exceção mínima para não quebrar o build: rotas `api/*` não passam pelo gate (são server routes e já têm suas próprias verificações). O gate é de interface.
- `__root.tsx` recebe `robots: noindex, nofollow` no `head()`, já que o domínio próprio não deve ser indexado.
- `_authenticated/route.tsx` mantém o login do Supabase; o gate roda antes, então o admin também exige estar dentro do Leaderei.
- Manter `frame-ancestors` já liberado em `src/server.ts` e `vite.config.ts`; nada muda ali.
- Versão passa para Alpha v0.75 em `src/lib/version.ts`.

## Fora do escopo

- Nenhuma mudança na prospecção, exportação ou envio de leads.
- Sem bloqueio no backend por token de sessão (o ingest do Leaderei já valida o `x-municipia-token`).
