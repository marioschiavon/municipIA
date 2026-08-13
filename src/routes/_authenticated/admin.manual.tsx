import { createFileRoute } from "@tanstack/react-router";
import {
  ManualShell, Secao, P, Passos, Lista, Definicoes, Caixa, type ManualSecao,
} from "@/components/manual/ManualLayout";

export const Route = createFileRoute("/_authenticated/admin/manual")({
  component: AdminManualPage,
});

const SECOES: ManualSecao[] = [
  { id: "acesso", titulo: "Acesso e permissões" },
  { id: "dashboard", titulo: "Dashboard" },
  { id: "municipios", titulo: "Municípios" },
  { id: "prospeccao", titulo: "Prospecção em lotes" },
  { id: "revisao", titulo: "Fila de revisão" },
  { id: "importar", titulo: "Importar planilhas" },
  { id: "queries", titulo: "Teste de queries" },
  { id: "score", titulo: "Pesos do score" },
  { id: "problemas", titulo: "Solução de problemas" },
];

function AdminManualPage() {
  return (
    <ManualShell
      titulo="Manual do administrador"
      subtitulo="Guia detalhado de todas as telas e opções do painel interno. Este manual só existe dentro da área administrativa."
      secoes={SECOES}
    >
      <Secao id="acesso" titulo="Acesso e permissões">
        <P>
          O painel administrativo fica em <strong>/admin</strong> e exige duas coisas: estar logado e a
          conta ter o papel <strong>admin</strong>.
        </P>
        <Passos
          itens={[
            "Acesse a tela de login e entre com e-mail e senha (ou com a conta Google).",
            "Se a conta não tiver o papel admin, aparece a mensagem “Acesso restrito”. Nesse caso, saia e entre com uma conta autorizada.",
            "Com acesso liberado, a barra superior mostra os atalhos: Dashboard, Municípios, Prospecção em lotes, Importar, Teste de queries, Pesos do score e este Manual.",
            "O link “Ver site público” abre o catálogo aberto ao visitante. O botão “Sair” encerra a sessão.",
          ]}
        />
        <Caixa tipo="aviso" titulo="Papéis ficam em tabela própria">
          A permissão de admin nunca é definida no navegador. Ela vive em uma tabela de papéis no banco e
          é verificada no servidor a cada acesso.
        </Caixa>
      </Secao>

      <Secao id="dashboard" titulo="Dashboard">
        <P>
          É a visão geral da saúde do catálogo. Os indicadores mostram, em números:
        </P>
        <Definicoes
          itens={[
            { termo: "Total de municípios", texto: "Quantas cidades existem no catálogo. O ideal é 5.570 (todos do Brasil)." },
            { termo: "Validados", texto: "Municípios com o trio completo: nome do secretário(a), e-mail e telefone." },
            { termo: "Pendentes", texto: "Têm alguma informação, mas não o conjunto completo. São os melhores candidatos ao próximo lote." },
            { termo: "Sem dados", texto: "Nunca foram prospectados. Se esse número for alto, priorize lotes." },
            { termo: "Cobertura de indicadores", texto: "Quantos municípios têm matrículas, escolas e repasse preenchidos. Cobertura baixa significa que falta importar planilha." },
          ]}
        />
        <Caixa tipo="dica">
          Leia o dashboard antes de rodar um lote: ele indica se o gargalo é falta de prospecção ou falta
          de importação de dados oficiais.
        </Caixa>
      </Secao>

      <Secao id="municipios" titulo="Municípios">
        <P>Tela de consulta e correção manual, registro por registro.</P>
        <Passos
          itens={[
            "Use a busca por nome e os filtros (UF, status, faixa) para chegar ao município.",
            "Clique na linha para abrir a ficha administrativa daquele município.",
            "Na ficha, os campos de contato ficam editáveis: nome do secretário(a), cargo, e-mails, telefones, horário de atendimento, fonte e equipe.",
            "Ajuste o que estiver errado e salve. O registro passa a contar como conferido manualmente e o status/score são recalculados.",
          ]}
        />
        <Caixa tipo="aviso" titulo="Edição manual tem prioridade">
          Corrija manualmente quando você tiver certeza da informação (por exemplo, confirmada por
          telefone). Uma nova prospecção pode sobrescrever campos, então prefira completar o que falta em
          vez de reescrever o que já está certo.
        </Caixa>
      </Secao>

      <Secao id="prospeccao" titulo="Prospecção em lotes">
        <P>
          É onde o catálogo é preenchido em escala. Em vez de um município por vez, o sistema percorre
          uma fila. Existem quatro modos de execução:
        </P>
        <Definicoes
          itens={[
            { termo: "Fase 1 — Domínio oficial", texto: "Descobre e confirma qual é o site oficial da prefeitura. É a base para as outras fases." },
            { termo: "Fase 2 — Secretário(a)", texto: "Descobre o nome e o cargo de quem responde pela Educação." },
            { termo: "Fase 3 — Contatos", texto: "Busca e-mail, telefone, horário de atendimento e a equipe da secretaria." },
            { termo: "Lote completo (3 em 1)", texto: "Roda as três fases seguidas para cada município da fila, no mesmo passo. É o modo mais completo e o mais caro em créditos." },
          ]}
        />
        <P>Como executar:</P>
        <Passos
          itens={[
            "Escolha o modo (fase específica ou lote completo).",
            "Defina o tamanho do lote — quantos municípios serão processados nesta rodada.",
            "Inicie. O progresso aparece em tempo real, município por município, com a etapa atual.",
            "Você pode interromper a qualquer momento; o que já foi processado fica salvo.",
            "Ao iniciar novamente, o sistema continua de onde parou: cada município guarda a data da última tentativa, e a fila sempre traz primeiro quem nunca foi tentado ou foi tentado há mais tempo.",
            "Enquanto um lote roda, um indicador no topo do painel mostra que há execução em andamento, mesmo se você navegar para outra tela.",
          ]}
        />
        <Caixa tipo="aviso" titulo="Cada execução custa">
          As buscas usam serviços externos pagos por uso. Lotes grandes consomem crédito rapidamente.
          Comece com lotes pequenos para validar a qualidade e só depois aumente.
        </Caixa>
      </Secao>

      <Secao id="revisao" titulo="Fila de revisão">
        <P>
          Do lado direito da tela de prospecção fica a lista de municípios que precisam de conferência
          humana. Um município entra nessa fila quando:
        </P>
        <Lista
          itens={[
            "O resultado veio parcial (por exemplo, achou o nome mas nenhum contato).",
            "A confiança da extração ficou baixa.",
            "Só apareceu e-mail genérico, como ouvidoria ou gabinete.",
            "A informação parece antiga — a data de referência é anterior ao mandato atual.",
          ]}
        />
        <P>Como tratar um item da fila:</P>
        <Passos
          itens={[
            "Abra o card: ele mostra o que foi encontrado, o motivo da revisão e as fontes consultadas (inclusive as fontes citadas pela Visão Geral por IA do Google).",
            "Abra a fonte em outra aba e confira se a informação bate.",
            "Se estiver correta, aprove — o município sai da fila e passa a contar como conferido.",
            "Se estiver errada ou incompleta, corrija na ficha do município ou rode a prospecção novamente para aquele registro.",
          ]}
        />
      </Secao>

      <Secao id="importar" titulo="Importar planilhas">
        <P>
          Os indicadores de alunos, escolas e repasses vêm de planilhas oficiais. É nesta tela que elas
          entram no catálogo.
        </P>
        <Definicoes
          itens={[
            { termo: "INEP", texto: "Planilha de escolas e matrículas por município. Alimenta as colunas Matrículas e Escolas." },
            { termo: "FNDE / FUNDEB", texto: "Planilha de repasses. Alimenta a estimativa de repasse anual usada no score financeiro." },
            { termo: "IBGE", texto: "A lista oficial de municípios e a população são sincronizadas direto da API, sem planilha." },
          ]}
        />
        <Passos
          itens={[
            "Escolha o tipo de importação correspondente ao arquivo.",
            "Selecione o arquivo. São aceitos CSV e arquivos compactados .gz; o separador é detectado automaticamente.",
            "Inicie a importação e acompanhe o log em tela: total de linhas lidas, quantas foram associadas a um município, quantas foram ignoradas e por quê.",
            "Ao final, confira no Dashboard se a cobertura subiu.",
          ]}
        />
        <Caixa tipo="info" titulo="Atualiza, não apaga">
          A importação faz atualização por código IBGE: o registro existente é complementado, nunca
          apagado e recriado. Reimportar o mesmo arquivo é seguro.
        </Caixa>
        <Caixa tipo="aviso" titulo="Faltaram municípios?">
          Normalmente é divergência de código IBGE ou linhas com o nome do município escrito de forma
          diferente. O log lista as linhas não associadas — use-o para corrigir a planilha e reimportar.
        </Caixa>
      </Secao>

      <Secao id="queries" titulo="Teste de queries">
        <P>
          A qualidade da prospecção depende muito da frase usada na busca. Esta tela permite testar
          variações e medir qual acerta mais, antes de aplicar em um lote inteiro.
        </P>
        <Passos
          itens={[
            "Escreva uma ou mais variações da frase de busca, uma por linha.",
            "Use o marcador {municipio}, {uf} e {ano} dentro da frase. Eles são substituídos automaticamente — {ano} entra com o ano corrente, o que ajuda a evitar resultados antigos.",
            "Escolha um conjunto de municípios de teste e execute.",
            "Compare as métricas: quantas execuções acharam nome, e-mail e telefone, e quantas voltaram vazias.",
            "Adote a variação com melhor desempenho como frase padrão da prospecção.",
          ]}
        />
        <Caixa tipo="dica" titulo="Amostra representativa">
          Teste com cidades de portes diferentes (uma capital, uma cidade média e uma pequena). Uma frase
          que funciona só em capitais engana a métrica.
        </Caixa>
      </Secao>

      <Secao id="score" titulo="Pesos do score">
        <P>
          O score de 0 a 100 é a soma de quatro componentes, e você controla o peso de cada um:
        </P>
        <Definicoes
          itens={[
            { termo: "Porte", texto: "População, matrículas e escolas. Aumente se o objetivo for priorizar cidades grandes." },
            { termo: "Financeiro", texto: "PIB por habitante e repasses. Aumente se o critério for capacidade de compra." },
            { termo: "Completude", texto: "Quanto do contato já existe. Aumente para empurrar para o topo quem já está pronto para abordagem." },
            { termo: "Recência", texto: "Há quanto tempo o dado foi conferido. Aumente para penalizar dados velhos." },
          ]}
        />
        <Passos
          itens={[
            "Ajuste os pesos e salve.",
            "Execute o recálculo para reaplicar a fórmula a todo o catálogo.",
            "Confira no Dashboard como a distribuição entre as faixas Alto, Médio e Baixo mudou.",
          ]}
        />
        <Caixa tipo="aviso">
          Mudar pesos altera a ordenação vista pelos usuários públicos e o resultado das exportações
          filtradas por faixa. Faça alterações graduais.
        </Caixa>
      </Secao>

      <Secao id="problemas" titulo="Solução de problemas">
        <Definicoes
          itens={[
            {
              termo: "Buscas voltando vazias em série",
              texto: "Normalmente indica falha do provedor de busca ou cota esgotada. Pare o lote, teste um município na tela de Teste de queries e retome depois.",
            },
            {
              termo: "Erro de cota",
              texto: "O sistema tenta um provedor alternativo automaticamente. Se todos falharem, aguarde a renovação da cota antes de rodar novos lotes.",
            },
            {
              termo: "Muitos itens na fila de revisão",
              texto: "Sinal de que a frase de busca está genérica demais. Ajuste em Teste de queries antes de continuar.",
            },
            {
              termo: "Score não mudou depois de prospectar",
              texto: "Rode o recálculo na tela Pesos do score; ele reaplica a fórmula para todo o catálogo.",
            },
            {
              termo: "Municípios validados em massa",
              texto: "Quem tem o trio nome + e-mail + telefone pode ser marcado como validado em lote. Faça isso apenas após uma amostragem de conferência.",
            },
          ]}
        />
      </Secao>
    </ManualShell>
  );
}
