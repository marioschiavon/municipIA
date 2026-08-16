# Ajustar o layout do diálogo "Exportar leads"

O diálogo hoje tem largura fixa pequena e três botões lado a lado no rodapé ("Exportar CSV", "Exportar Excel", "Enviar para o Leaderei"). Em telas menores e quando o botão do Leaderei aparece, os botões estouram a largura, ficam apertados e o conteúdo pode passar da altura da tela.

## O que muda (somente visual)

- Largura do diálogo um pouco maior e responsiva, com margem lateral garantida no celular.
- Altura limitada à tela, com a área de campos rolando quando necessário; título e rodapé permanecem fixos.
- Rodapé reorganizado: botões empilhados e em largura total no celular, alinhados em linha com quebra a partir de telas médias, sem texto cortado.
- Ajustes menores de espaçamento nos campos de score e no grupo "Tipo de contato" para não colar nas bordas.

Nenhuma regra de exportação, filtro ou integração é alterada.

## Detalhes técnicos

- Arquivo: `src/routes/index.tsx`, apenas o bloco `<Dialog open={exportOpen}>`.
- `DialogContent`: `sm:max-w-lg max-h-[85vh] overflow-hidden flex flex-col`; wrapper dos campos com `flex-1 overflow-y-auto pr-1`.
- `DialogFooter`: `flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-end`; botões com `w-full sm:w-auto` e `whitespace-nowrap`.
- Bump de versão em `src/lib/version.ts` (Alpha v0.78).
