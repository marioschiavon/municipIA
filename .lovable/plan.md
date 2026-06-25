## Objetivo
Garantir que, quando a página oficial não carregar (ou vier vazia), o sistema ainda extraia **nome, cargo, e-mail e telefone** diretamente dos snippets do Google (título + descrição dos resultados de busca), em vez de cair direto para o fallback institucional.

## Diagnóstico
Hoje os snippets já são concatenados ao prompt (`snippetsBlock` + `combinedA`), mas:
- `extractContactsRegex` roda só sobre o `markdown` passado — quando só há snippets, as pistas regex ainda funcionam (snippets viram parte do "markdown" combinado), porém o `nomeFonte` é marcado como `"site"` mesmo sem markdown real.
- O atalho feliz (estágio A3) atribui `nomeFonte = "site"` em todos os casos, mascarando que veio do snippet.
- Quando `topA` não existe ou nenhum candidato retorna markdown, o sistema não tenta uma extração "somente snippet" em URL alguma — pula direto para o estágio B/fallback.
- O estágio B (busca pelo nome) também já recebe snippets, mas a marcação `nomeFonte` ali não é atualizada quando o snippet foi decisivo.

## Mudanças em `src/lib/prospect.server.ts`

1. **Helper `hasMarkdown(cands)`** — pequeno utilitário para saber se algum candidato trouxe markdown real.

2. **Atalho feliz (Estágio A3)** — quando há snippets mas nenhum `inlineMd`/`mdSiteEducacao`, marcar `nomeFonte = "snippet"` e `fonte = "Snippet do Google"`. Permitir que o atalho dispare mesmo sem `urlSiteEducacao` claro: usar `topA?.url ?? rankedA[0]?.url ?? null` e, se ainda assim não houver URL, registrar `fonteUrl = null` com `contexto` explicando que veio do resumo do Google.

3. **Extração focada em nome (fallback A4)** — se a IA não achou nome no atalho e há apenas snippets, manter chamada `extractNomeWithAI` (já funciona) e marcar `nomeFonte = "snippet"` quando não houve markdown.

4. **Regex sobre snippets** — em `extractWithAI`, quando `extraMarkdown` (snippets) existir, rodar `extractContactsRegex` também sobre `extraMarkdown` e mesclar (dedup) com as pistas do markdown. Isso garante que e-mails/telefones visíveis no snippet entrem na lista mesmo se a IA falhar.

5. **Estágio B (contatos do nome)** — quando o contato vier exclusivamente dos snippets (sem `inlineMd`), incluir no `contexto` "extraído de snippets do Google" e marcar `nomeFonte = "snippet"` se ainda era `null`.

6. **Mensagens de progresso** — novos eventos na timeline:
   - "Sem markdown — extraindo nome/contatos direto dos snippets do Google"
   - "Snippet trouxe N e-mail(s) / M telefone(s) por regex"
   - Badge "via snippet do Google" já existe no `ResultCard` (`nomeFonte === "snippet"`), nada a mudar no UI.

7. **Versão** — bump em `src/lib/version.ts`: **Alpha v0.7 → Alpha v0.8**.

## Arquivos tocados
- `src/lib/prospect.server.ts` (lógica de extração e marcação de fonte)
- `src/lib/version.ts` (bump de versão)

## Não muda
- UI / componentes / cache / Querido Diário / scraper nativo permanecem iguais.
- Schema da IA permanece o mesmo (`ExtractSchema` / `NomeSchema`).
- Tipos em `prospect.types.ts` já contemplam `nomeFonte: "snippet"`.

## Verificação
- `bunx tsgo --noEmit` limpo.
- Teste manual com município cujo site costuma falhar (ex.: Maringá-PR): card deve mostrar nome + ao menos 1 contato com badge "via snippet do Google" e linha de timeline explicando que veio do resumo.
