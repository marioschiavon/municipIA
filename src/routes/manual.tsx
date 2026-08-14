import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, BookOpen } from "lucide-react";
import {
  ManualShell, Secao, P, Passos, Lista, Definicoes, Caixa, type ManualSecao,
} from "@/components/manual/ManualLayout";

export const Route = createFileRoute("/manual")({
  head: () => ({
    meta: [
      { title: "Manual do usuário — MunicipIA" },
      {
        name: "description",
        content:
          "Guia passo a passo para buscar municípios, entender o score, prospectar contatos da Secretaria de Educação em tempo real e exportar leads no MunicipIA.",
      },
      { property: "og:title", content: "Manual do usuário — MunicipIA" },
      {
        property: "og:description",
        content: "Como buscar, prospectar e exportar contatos de Secretarias de Educação, explicado em linguagem simples.",
      },
      { property: "og:type", content: "article" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ManualPage,
});

const SECOES: ManualSecao[] = [
  { id: "o-que-e", titulo: "O que é o MunicipIA" },
  { id: "tela-inicial", titulo: "A tela inicial explicada" },
  { id: "buscar", titulo: "Como buscar municípios" },
  { id: "score", titulo: "Entendendo o Score" },
  { id: "status", titulo: "Entendendo o Status" },
  { id: "prospectar", titulo: "Como prospectar em tempo real" },
  { id: "prospectar-varios", titulo: "Prospectar vários municípios de uma vez" },
  { id: "ficha", titulo: "A ficha do município" },
  { id: "exportar", titulo: "Como exportar leads" },
  { id: "faq", titulo: "Perguntas frequentes" },
];

function ManualPage() {
  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-border bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Link to="/" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4" /> Voltar ao catálogo
          </Link>
          <span className="inline-flex items-center gap-2 text-sm font-medium">
            <BookOpen className="h-4 w-4 text-primary" /> Manual do usuário
          </span>
        </div>
      </header>

      <ManualShell
        titulo="Manual do usuário"
        subtitulo="Um guia completo, em linguagem simples, para você encontrar municípios e conseguir os contatos das Secretarias de Educação. Não é preciso ter conhecimento técnico."
        secoes={SECOES}
      >
        <Secao id="o-que-e" titulo="O que é o MunicipIA">
          <P>
            O MunicipIA é uma lista (um catálogo) com os 5.570 municípios do Brasil. Para cada município,
            o sistema tenta descobrir e guardar quem é a pessoa responsável pela Educação na prefeitura
            — o secretário ou a secretária de Educação — junto com o e-mail e o telefone de contato.
          </P>
          <P>
            Quando falamos em <strong>lead</strong>, queremos dizer "um contato para você abordar":
            uma pessoa com nome, cargo e alguma forma de falar com ela (e-mail ou telefone).
          </P>
          <P>
            Além dos contatos, cada município mostra números públicos que ajudam a priorizar quem
            procurar primeiro: quantidade de habitantes, quantidade de alunos matriculados, número de
            escolas e quanto dinheiro o município recebe para a educação.
          </P>
          <Caixa tipo="info" titulo="Você não precisa criar conta">
            Toda a parte de busca, consulta e prospecção da página inicial é aberta. Login é necessário
            apenas para o painel administrativo, usado pela equipe interna.
          </Caixa>
        </Secao>

        <Secao id="tela-inicial" titulo="A tela inicial explicada">
          <P>Ao abrir o site, você vê três áreas:</P>
          <Definicoes
            itens={[
              {
                termo: "Topo (cabeçalho)",
                texto: (
                  <>
                    Mostra o nome MunicipIA, a versão do sistema e três contadores: quantos municípios
                    existem no catálogo, quantos têm "Score alto" e quantos já estão "Validados".
                  </>
                ),
              },
              {
                termo: "Barra de filtros",
                texto: "A caixa de busca e as listas suspensas (UF, Faixa, Status, Ordenar), mais o botão Exportar.",
              },
              {
                termo: "Tabela",
                texto: "A lista de municípios, 50 por página, com botões de ação em cada linha.",
              },
            ]}
          />
          <P>Cada coluna da tabela significa:</P>
          <Definicoes
            itens={[
              { termo: "Município", texto: "Nome da cidade. Clicando nele você abre a ficha completa." },
              { termo: "UF", texto: "A sigla do estado (ex.: SP, PR, BA)." },
              { termo: "População", texto: "Número de habitantes segundo o IBGE." },
              { termo: "Matrículas", texto: "Quantidade de alunos matriculados na rede, segundo o INEP." },
              { termo: "Status", texto: "Como estão os dados de contato daquele município (veja a seção Status)." },
              { termo: "Score", texto: "Uma nota de 0 a 100 que indica o quanto vale a pena prospectar." },
            ]}
          />
        </Secao>

        <Secao id="buscar" titulo="Como buscar municípios">
          <Passos
            itens={[
              <>
                <strong>Digite o nome</strong> da cidade na caixa "Buscar município" (ex.: Maringá) e
                aperte Enter ou clique na lupa. Não precisa acentuar corretamente.
              </>,
              <>
                <strong>Filtre por estado</strong> na lista "UF" para ver só as cidades daquele estado.
              </>,
              <>
                <strong>Filtre por faixa</strong> para ver apenas as cidades com potencial Alto (nota 70
                ou mais), Médio (40 a 69) ou Baixo (abaixo de 40).
              </>,
              <>
                <strong>Filtre por status</strong> para ver apenas municípios "Validado" (já tem contato
                confirmado), "Pendente" (tem algo, mas incompleto) ou "Sem dados" (ainda não buscamos nada).
              </>,
              <>
                <strong>Escolha a ordenação</strong> em "Ordenar": por Score, População, Matrículas ou
                Nome. A lista sempre começa pelo maior valor.
              </>,
              <>
                <strong>Navegue pelas páginas</strong> nos botões no rodapé da tabela. Cada página mostra
                50 municípios.
              </>,
            ]}
          />
          <Caixa tipo="dica" titulo="Combinação mais usada">
            UF do seu interesse + Faixa "Alto" + Status "Validado". Isso mostra as cidades grandes que já
            têm contato pronto para abordar.
          </Caixa>
        </Secao>

        <Secao id="score" titulo="Entendendo o Score">
          <P>
            O Score é uma nota de 0 a 100 calculada automaticamente. Quanto maior, mais interessante
            aquele município tende a ser para uma abordagem comercial. Ele é a soma de quatro partes:
          </P>
          <Definicoes
            itens={[
              { termo: "Porte", texto: "Tamanho do município — população, alunos matriculados e número de escolas." },
              { termo: "Financeiro", texto: "Capacidade de investir: PIB por habitante e repasses recebidos para educação." },
              { termo: "Contato (completude)", texto: "Quanto do contato já temos: nome do secretário, e-mail, telefone e equipe." },
              { termo: "Recência", texto: "Há quanto tempo o dado foi conferido. Dado recente vale mais que dado antigo." },
            ]}
          />
          <P>
            As faixas são só um jeito rápido de ler a nota: <strong>Alto</strong> (70 ou mais),
            <strong> Médio</strong> (40 a 69) e <strong>Baixo</strong> (menos de 40).
          </P>
          <Caixa tipo="info">
            Se você prospectar um município e encontrar novos contatos, o Score dele sobe sozinho, porque
            as partes "Contato" e "Recência" melhoram.
          </Caixa>
        </Secao>

        <Secao id="status" titulo="Entendendo o Status">
          <Definicoes
            itens={[
              {
                termo: "Validado",
                texto: "Já temos o conjunto principal: nome do secretário(a), e-mail e telefone. Pode abordar.",
              },
              {
                termo: "Pendente",
                texto: "Encontramos parte das informações (por exemplo, só o e-mail geral). Vale rodar a prospecção para completar.",
              },
              {
                termo: "Sem dados",
                texto: "Ainda não foi feita nenhuma busca para esse município. Clique em prospectar para começar.",
              },
            ]}
          />
        </Secao>

        <Secao id="prospectar" titulo="Como prospectar em tempo real">
          <P>
            Prospectar significa pedir ao sistema para ir buscar, na internet, quem é o secretário ou a
            secretária de Educação daquele município e como falar com essa pessoa. Isso acontece na hora,
            enquanto você espera.
          </P>
          <Passos
            itens={[
              <>
                Na tabela da página inicial, encontre a linha do município desejado e clique no botão de
                <strong> prospectar</strong> (o ícone de brilho, na coluna de ações à direita).
              </>,
              <>
                Abre uma janela no centro da tela com um <strong>círculo girando</strong> e frases
                explicando o que está acontecendo, como "Buscando site oficial…", "Procurando
                secretário(a)…", "Achando contato…". Isso serve para você saber que o sistema está
                trabalhando.
              </>,
              <>
                A busca costuma levar de 30 segundos a <strong>2 minutos</strong>. Não feche o navegador
                nesse tempo. Se quiser interromper, clique em <strong>Cancelar</strong>.
              </>,
              <>
                Quando termina, o círculo vira um <strong>sinal verde</strong> e a própria janela mostra
                o que foi encontrado: secretário(a), e-mail, telefone e quantas pessoas da equipe foram
                identificadas. Você não precisa recarregar a página.
              </>,
              <>
                Clique em <strong>Fechar</strong>. A linha na tabela já aparece atualizada, com o novo
                Status e o novo Score. Para ver tudo em detalhe, abra a ficha do município.
              </>,
            ]}
          />
          <P>Se a busca não encontrar nada, a janela avisa. Os motivos mais comuns são:</P>
          <Lista
            itens={[
              "A prefeitura não tem site, ou o site estava fora do ar naquele momento.",
              "O site existe, mas não publica nome nem contato da Secretaria de Educação.",
              "O município acabou de trocar de secretário e ainda não atualizou a página.",
              "A conexão caiu no meio da busca.",
            ]}
          />
          <Caixa tipo="dica" titulo="Vale tentar de novo">
            Em muitos casos, rodar a prospecção uma segunda vez em outro momento traz resultado, porque o
            sistema consulta fontes diferentes a cada tentativa.
          </Caixa>
        </Secao>

        <Secao id="prospectar-varios" titulo="Prospectar vários municípios de uma vez">
          <P>
            Se você precisa dos contatos de várias cidades, não é preciso clicar em uma de cada vez. Na
            página inicial dá para <strong>selecionar até 10 municípios</strong> e mandar o sistema
            prospectar todos, um atrás do outro, sem você acompanhar clique por clique.
          </P>
          <Passos
            itens={[
              <>
                Na tabela da página inicial, marque a <strong>caixinha de seleção</strong> que fica na
                primeira coluna de cada linha. Você pode marcar quantas quiser, até o limite de 10.
              </>,
              <>
                Assim que você marca a primeira caixinha, aparece uma <strong>barra flutuante</strong> na
                parte de baixo da tela mostrando quantos municípios estão selecionados.
              </>,
              <>
                Clique em <strong>Prospectar selecionados</strong>. Abre uma janela com a lista dos
                municípios escolhidos.
              </>,
              <>
                O sistema trabalha <strong>um município por vez</strong>, na ordem da lista. O que está
                sendo pesquisado no momento aparece com o círculo girando e as frases de progresso; os já
                concluídos aparecem com sinal verde e os contatos encontrados logo abaixo do nome.
              </>,
              <>
                Como cada cidade leva de 30 segundos a 2 minutos, 10 municípios podem levar algo em torno
                de <strong>10 a 20 minutos</strong>. Deixe a janela aberta enquanto isso.
              </>,
              <>
                Se quiser parar no meio, clique em <strong>Cancelar</strong>. Tudo que já tinha sido
                encontrado até ali fica salvo; apenas os municípios ainda não processados são
                descartados.
              </>,
              <>
                Ao terminar, clique em <strong>Fechar</strong>. A tabela já mostra os Status e Scores
                atualizados, e esses contatos entram normalmente na exportação de leads.
              </>,
            ]}
          />
          <Caixa tipo="dica" titulo="Por que só 10 por vez">
            Cada busca consulta várias fontes na internet. O limite de 10 evita que a janela fique aberta
            tempo demais e garante que nenhuma busca seja cortada pela metade. Terminou uma leva? Basta
            desmarcar e selecionar os próximos 10.
          </Caixa>
          <Caixa tipo="aviso" titulo="Não feche a aba">
            A prospecção em lote acontece no seu navegador. Se você fechar a aba ou o computador
            hibernar, as buscas que ainda não terminaram são interrompidas (as concluídas continuam
            salvas).
          </Caixa>
        </Secao>

        <Secao id="ficha" titulo="A ficha do município">
          <P>
            Clique no nome de qualquer município na tabela para abrir a ficha dele. A ficha reúne tudo o
            que sabemos sobre aquela cidade, organizado em cartões:
          </P>
          <Definicoes
            itens={[
              {
                termo: "Secretaria de Educação",
                texto: "Nome do secretário(a), cargo, e-mail, telefone, horário de atendimento e o link da página onde a informação foi encontrada (Fonte).",
              },
              { termo: "Equipe", texto: "Outras pessoas da secretaria (coordenadores, diretores, assessores) com cargo e contato, quando disponíveis." },
              { termo: "Indicadores IBGE", texto: "População e PIB por habitante." },
              { termo: "Indicadores INEP", texto: "Total de matrículas e número de escolas." },
              { termo: "Indicadores FNDE", texto: "Estimativa de repasse anual para a educação." },
            ]}
          />
          <P>
            No topo da ficha existe o botão <strong>Verificar dados</strong>. Ele funciona assim:
          </P>
          <Passos
            itens={[
              "Primeiro o sistema relê o que já está salvo no catálogo.",
              "Se já houver nome do secretário(a), e-mail e telefone, e essa informação tiver sido conferida nos últimos 180 dias, ele apenas avisa: “Dados estão atualizados no catálogo.” e não gasta uma nova busca.",
              "Se faltar alguma dessas informações, ou se estiver antiga, ele abre a mesma janela de progresso e roda a busca completa na internet.",
              "Ao terminar, os campos encontrados aparecem na própria janela e a ficha é atualizada automaticamente.",
            ]}
          />
          <P>
            No alto da página também aparece uma faixa verde com o resumo do que aconteceu na última
            verificação — por exemplo, o que continuou faltando.
          </P>
        </Secao>

        <Secao id="exportar" titulo="Como exportar leads">
          <P>
            Exportar é baixar a lista para um arquivo que você abre no Excel, no Google Planilhas ou
            importa no seu CRM.
          </P>
          <Passos
            itens={[
              <>Clique no botão <strong>Exportar</strong>, ao lado dos filtros.</>,
              <>
                Escolha a <strong>quantidade</strong> de municípios que deseja levar. Existe um limite
                máximo por download, indicado na própria janela.
              </>,
              <>
                Escolha a <strong>faixa de score</strong> (Alto, Médio, Baixo ou todas) e, se quiser, um
                <strong> intervalo exato</strong> preenchendo score mínimo e máximo.
              </>,
              <>
                Escolha o <strong>tipo de contato</strong>: apenas o secretário(a), apenas a equipe, ou
                ambos.
              </>,
              <>
                Clique em <strong>CSV</strong> (arquivo de texto, aceito por quase todo sistema) ou
                <strong> Excel</strong> (planilha pronta). O arquivo baixa direto no seu computador.
              </>,
            ]}
          />
          <Caixa tipo="info" titulo="Uma linha por contato">
            No arquivo, cada pessoa vira uma linha própria, com um e-mail e um telefone por linha. Assim
            cada linha já é um lead pronto para o seu processo comercial. Os filtros de UF, busca e status
            que estão aplicados na tela também valem para a exportação.
          </Caixa>
        </Secao>

        <Secao id="faq" titulo="Perguntas frequentes">
          <Definicoes
            itens={[
              {
                termo: "O dado está desatualizado. E agora?",
                texto: "Use o botão de prospectar (na tabela) ou Verificar dados (na ficha). O sistema busca de novo e substitui pela informação mais recente que encontrar.",
              },
              {
                termo: "O que é a data “Atualizado em”?",
                texto: "É o dia em que aquela informação foi conferida pela última vez. Quanto mais antiga, maior a chance de ter mudado — trocas de secretário são comuns após eleições.",
              },
              {
                termo: "Por que às vezes o telefone vem sem DDD?",
                texto: "Porque a prefeitura publicou assim no site. Nesse caso, use o DDD do estado do município.",
              },
              {
                termo: "Por que o e-mail é “gabinete@” ou “ouvidoria@”?",
                texto: "Quando não existe um e-mail direto da Educação publicado, o sistema guarda o contato geral da prefeitura, que ainda serve como porta de entrada.",
              },
              {
                termo: "A prospecção pode ser feita por qualquer pessoa?",
                texto: "Sim. Na página inicial não é preciso login. Cada busca consulta serviços externos, então evite clicar repetidamente no mesmo município sem necessidade.",
              },
              {
                termo: "Cliquei em prospectar e fechei a janela. Perdi o resultado?",
                texto: "Fechar a janela cancela a busca em andamento. Se ela já tinha terminado, o resultado foi salvo e aparece na ficha do município.",
              },
            ]}
          />
        </Secao>
      </ManualShell>
    </div>
  );
}
