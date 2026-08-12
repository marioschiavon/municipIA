export type Hierarquia = "educacao" | "camara" | "geral" | "gabinete";

export type EquipeMembro = {
  nome: string;
  cargo: string | null;
  email?: string | null;
  telefone?: string | null;
};

export type ProspectResult = {
  status: "found" | "partial" | "not_found";
  hierarquia: Hierarquia | null;
  secretario: string | null;
  cargo: string | null;
  emails: string[];
  telefones: string[];
  fonte: string | null;
  fonteUrl: string | null;
  contexto: string | null;
  /** Origem do NOME do secretário, quando aplicável. */
  nomeFonte?: "site" | "diario" | "busca-nome" | "snippet" | "ai-overview" | null;
  /** Data/período de referência da informação (ex.: "2025-11", "abril/2025"). */
  dataReferencia?: string | null;
  /** Horário de atendimento, quando aparece literalmente na fonte (ex.: "Seg a Sex 8h–17h"). */
  horarioAtendimento?: string | null;
  /** Equipe da Secretaria — outras pessoas com nome + cargo (coordenadores, diretores, assessores). */
  equipe?: EquipeMembro[];
  /** Domínio raiz confirmado como oficial do município nesta run; null se nada confirmável (ex.: Câmara Municipal). */
  dominioOficialConfirmado?: string | null;
  /** URL específica da página de Educação usada/confirmada nesta run. */
  paginaEducacaoUrl?: string | null;
  /** Confiança da extração desta run (quando aplicável) — usada para decidir `revisar`. */
  confianca?: "alta" | "media" | "baixa" | null;
  /** true quando o resultado é fraco/incerto e deve entrar na fila de revisão manual do admin. */
  revisar?: boolean;
  /** Fontes citadas pela Visão Geral por IA do Google nesta run (para julgar atualidade). */
  fontesAiOverview?: Array<{ url?: string; title?: string }> | null;
  /** Motivo curto do `revisar`, ex.: "confiança baixa", "apenas e-mail genérico (ouvidoria)". */
  motivoRevisao?: string | null;
};


export type ProgressLevel = "info" | "success" | "warn" | "error";

export type EtapaTag =
  | Hierarquia
  | "init"
  | "fallback"
  | "final"
  | "diario"
  | "nome"
  | "contato-secretario";

export type ProgressEvent =
  | {
      kind: "progress";
      level: ProgressLevel;
      etapa: EtapaTag;
      message: string;
      data?: unknown;
      ts: number;
      /** Milissegundos decorridos desde o início da prospecção deste município. */
      elapsedMs?: number;
    }
  | {
      kind: "final";
      result: ProspectResult;
      ts: number;
      elapsedMs?: number;
    };

