## Resposta à sua ideia (subir o arquivo inteiro para o banco)

A ideia é boa em espírito — separar "receber o arquivo" de "processar o arquivo" é exatamente o que resolve interrupções. Mas subir o **arquivo bruto** (190 MB / ~400 colunas) para uma tabela de staging e depois apagar tem dois problemas práticos:

- O gargalo continua sendo a mesma requisição HTTP: gravar 215 mil linhas cruas via API leva **mais** tempo do que gravar só as 5 colunas úteis. Trocaríamos uma etapa lenta por uma ainda mais lenta.
- Guardar texto bruto (com todas as colunas do Censo) infla o banco em centenas de MB para depois descartar.

**O que realmente resolve é o mesmo princípio, sem o peso:** a `inep_escolas` já *é* a tabela de staging (só com as colunas que importam). O que falta é **checkpoint e retomada** — saber onde parou e continuar dali. Proponho isso.

## Plano

**1. Log verbose de linhas já importadas (`src/routes/api/admin/import.ts`)**
- Ao iniciar, consultar quantas linhas já existem para o ano e mostrar: "Já existem N escolas importadas (último CO_ENTIDADE X) — pulando linhas já gravadas".
- Durante a leitura, a cada lote emitir evento verbose: linhas lidas, linhas puladas por já existirem, linhas gravadas neste lote, municípios distintos acumulados, tempo decorrido e taxa (linhas/s).
- Ao final, resumo de sanidade: lidas vs. gravadas vs. municípios, com **alerta explícito** se o total ficar abaixo do esperado (< 150 mil escolas) — o import nunca mais "termina" silenciosamente pela metade.

**2. Retomada real (checkpoint)**
- Modo "continuar de onde parou": pular rapidamente as linhas cujo `CO_ENTIDADE` já está no banco, sem reprocessar/reescrever.
- Aplicar a contagem `municipios.escolas` **em lotes progressivos** durante a leitura (hoje só no fim, por isso apenas 22 municípios foram atualizados quando caiu).
- Trocar os ~5.500 `UPDATE` individuais por upsert em lote por `ibge_id`.

**3. Robustez do stream**
- Heartbeat periódico no NDJSON para evitar que proxies fechem a conexão em trechos lentos.
- Opção de subir o CSV **dividido por UF/pedaços** — como o import passa a ser idempotente por `CO_ENTIDADE`, subir em partes é seguro e some com o risco de timeout.

**4. Fluxo recomendado agora**
1. Reenviar `Tabela_Escola_2025` (o banco só tem UFs 11→23; falta 3/4 do país).
2. Se cair de novo, reenviar o mesmo arquivo — ele continuará de onde parou.
3. Reenviar `Tabela_Matricula_2025`.
4. Rodar "Recalcular scores".

**5. `src/lib/version.ts`** → `Alpha v0.43`.

## Fora de escopo
- Nenhuma mudança de schema (nenhuma tabela de arquivo bruto será criada).
- Nenhuma alteração no cálculo de score nem no importador FNDE/FUNDEB.
