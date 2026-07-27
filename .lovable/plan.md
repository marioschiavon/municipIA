## Alpha v0.35 — Diagnóstico e robustez do importador INEP

Dois sintomas relatados:

1. **Matrículas** → erro `Colunas obrigatórias ausentes (CO_ENTIDADE, CO_MUNICIPIO, TP_DEPENDENCIA)`. Essa mensagem só existe em `processInepEscolas`, ou seja, ou o tipo selecionado ficou em "INEP - Escolas" (default do radio) e o usuário subiu o CSV de matrículas, ou a detecção do header falha e o parser trata como escolas por engano.
2. **Escolas** → upload conclui sem erro, mas nenhuma contagem muda. Sinal típico de: (a) delimitador/encoding diferente do esperado (Papa devolve 1 coluna gigante, headers não batem, `municipais` fica vazio), ou (b) o `sample` é lido mas as linhas de dado caem no filtro `!co || !ibge || !dep`.

### Correções

**1. Detecção automática de delimitador e header do CSV (`src/routes/api/admin/import.ts`)**
- Substituir `parseCsvSemicolon` por `parseCsvAuto`: tenta `;`, depois `,`, depois `\t`, e escolhe o que produz o maior número de colunas no header.
- Strip de BOM (`\uFEFF`) do primeiro campo.
- Log inicial: `[headers detectados] delimiter=";" cols=57 primeiras=[NU_ANO_CENSO, CO_ENTIDADE, ...]` — envia via `send({ type:"progress", data:{ headers, delimiter } })` para aparecer no painel de log.

**2. Autodetecção do tipo de arquivo INEP**
- Antes de processar, inspecionar o header:
  - Tem `TP_DEPENDENCIA` + `NO_ENTIDADE` → Tabela_Escola.
  - Tem `QT_MAT_INF_CRE` ou `QT_MAT_FUND_AI` → Tabela_Matricula.
- Se o tipo escolhido no radio não bate com o detectado, abortar com mensagem clara: `"Arquivo parece ser Tabela_Matricula, mas o tipo selecionado é 'INEP - Escolas'. Ajuste o seletor."` — evita o erro genérico atual.

**3. Telemetria dos updates em Escolas**
- Contar e reportar: linhas totais, linhas com `TP_DEPENDENCIA=3`, linhas com `TP_SITUACAO_FUNCIONAMENTO=1`, escolas municipais ativas, municípios afetados, updates bem-sucedidos.
- Enviar amostra dos 3 primeiros IBGEs atualizados no log final para o admin conferir no banco.

**4. Compatibilidade de nomes de coluna**
- `TP_SITUACAO_FUNCIONAMENTO` já é tratado, mas algumas releases usam `TP_SITUACAO`. Aceitar ambos.
- `CO_MUNICIPIO` vs `CO_MUNICIPIO_IBGE` — aceitar ambos como fallback.

**5. Bump de versão** em `src/lib/version.ts` para `Alpha v0.35`.

### Fora de escopo
- Alterações de esquema (não há migração).
- Mudanças no FNDE (não relatadas nesta rodada).

### Nota técnica
As duas causas mais prováveis do sintoma "Escolas sem efeito" são delimitador errado (Papa devolve 1 coluna, `CO_ENTIDADE in sample` é falso, mas ainda assim passa da checagem porque o `sample` pode ter só uma chave composta) ou header com BOM (`"\uFEFFCO_ENTIDADE"` ≠ `"CO_ENTIDADE"`). O plano cobre ambos e adiciona log suficiente para diagnosticar qualquer novo caso sem precisar de novo turno.
