export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      inep_escolas: {
        Row: {
          ano: number
          co_entidade: number
          created_at: string
          ibge_id: number
          tp_dependencia: number
          tp_situacao: number
          updated_at: string
        }
        Insert: {
          ano: number
          co_entidade: number
          created_at?: string
          ibge_id: number
          tp_dependencia: number
          tp_situacao?: number
          updated_at?: string
        }
        Update: {
          ano?: number
          co_entidade?: number
          created_at?: string
          ibge_id?: number
          tp_dependencia?: number
          tp_situacao?: number
          updated_at?: string
        }
        Relationships: []
      }
      municipios: {
        Row: {
          created_at: string
          escolas: number
          fnde_anual: number
          ibge_id: number
          matriculas_total: number
          nome: string
          pib_percapita: number
          populacao: number
          slug: string
          uf: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          escolas?: number
          fnde_anual?: number
          ibge_id: number
          matriculas_total?: number
          nome: string
          pib_percapita?: number
          populacao?: number
          slug: string
          uf: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          escolas?: number
          fnde_anual?: number
          ibge_id?: number
          matriculas_total?: number
          nome?: string
          pib_percapita?: number
          populacao?: number
          slug?: string
          uf?: string
          updated_at?: string
        }
        Relationships: []
      }
      municipios_educacao: {
        Row: {
          atualizado_em: string | null
          breakdown: Json
          cargo: string | null
          contato_confirmado_em: string | null
          contato_confirmado_por: string | null
          created_at: string
          dominio_confirmado_em: string | null
          dominio_confirmado_por: string | null
          dominio_oficial: string | null
          emails: string[]
          equipe: Json
          faixa: string
          fonte: string | null
          fonte_url: string | null
          horario: string | null
          ibge_id: number
          pagina_educacao_url: string | null
          revisao_motivos: string[]
          revisao_necessaria: boolean
          score: number
          secretario: string | null
          secretario_confirmado_em: string | null
          secretario_confirmado_por: string | null
          status: string
          telefones: string[]
          tentativa_completo_em: string | null
          tentativa_contato_em: string | null
          tentativa_dominio_em: string | null
          tentativa_secretario_em: string | null
          updated_at: string
        }
        Insert: {
          atualizado_em?: string | null
          breakdown?: Json
          cargo?: string | null
          contato_confirmado_em?: string | null
          contato_confirmado_por?: string | null
          created_at?: string
          dominio_confirmado_em?: string | null
          dominio_confirmado_por?: string | null
          dominio_oficial?: string | null
          emails?: string[]
          equipe?: Json
          faixa?: string
          fonte?: string | null
          fonte_url?: string | null
          horario?: string | null
          ibge_id: number
          pagina_educacao_url?: string | null
          revisao_motivos?: string[]
          revisao_necessaria?: boolean
          score?: number
          secretario?: string | null
          secretario_confirmado_em?: string | null
          secretario_confirmado_por?: string | null
          status?: string
          telefones?: string[]
          tentativa_completo_em?: string | null
          tentativa_contato_em?: string | null
          tentativa_dominio_em?: string | null
          tentativa_secretario_em?: string | null
          updated_at?: string
        }
        Update: {
          atualizado_em?: string | null
          breakdown?: Json
          cargo?: string | null
          contato_confirmado_em?: string | null
          contato_confirmado_por?: string | null
          created_at?: string
          dominio_confirmado_em?: string | null
          dominio_confirmado_por?: string | null
          dominio_oficial?: string | null
          emails?: string[]
          equipe?: Json
          faixa?: string
          fonte?: string | null
          fonte_url?: string | null
          horario?: string | null
          ibge_id?: number
          pagina_educacao_url?: string | null
          revisao_motivos?: string[]
          revisao_necessaria?: boolean
          score?: number
          secretario?: string | null
          secretario_confirmado_em?: string | null
          secretario_confirmado_por?: string | null
          status?: string
          telefones?: string[]
          tentativa_completo_em?: string | null
          tentativa_contato_em?: string | null
          tentativa_dominio_em?: string | null
          tentativa_secretario_em?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "municipios_educacao_ibge_id_fkey"
            columns: ["ibge_id"]
            isOneToOne: true
            referencedRelation: "municipios"
            referencedColumns: ["ibge_id"]
          },
        ]
      }
      municipios_matriculas_etapa: {
        Row: {
          ano: number
          created_at: string
          etapa: Database["public"]["Enums"]["etapa_ensino"]
          ibge_id: number
          id: string
          matriculas: number
          updated_at: string
        }
        Insert: {
          ano?: number
          created_at?: string
          etapa: Database["public"]["Enums"]["etapa_ensino"]
          ibge_id: number
          id?: string
          matriculas?: number
          updated_at?: string
        }
        Update: {
          ano?: number
          created_at?: string
          etapa?: Database["public"]["Enums"]["etapa_ensino"]
          ibge_id?: number
          id?: string
          matriculas?: number
          updated_at?: string
        }
        Relationships: []
      }
      prospect_query_config: {
        Row: {
          created_at: string
          id: number
          query_ai_overview: string
          updated_at: string
          variantes: Json
        }
        Insert: {
          created_at?: string
          id?: number
          query_ai_overview?: string
          updated_at?: string
          variantes?: Json
        }
        Update: {
          created_at?: string
          id?: number
          query_ai_overview?: string
          updated_at?: string
          variantes?: Json
        }
        Relationships: []
      }
      score_config: {
        Row: {
          id: number
          pesos_etapa: Json
          pesos_macro: Json
          updated_at: string
        }
        Insert: {
          id?: number
          pesos_etapa?: Json
          pesos_macro?: Json
          updated_at?: string
        }
        Update: {
          id?: number
          pesos_etapa?: Json
          pesos_macro?: Json
          updated_at?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "editor" | "viewer"
      etapa_ensino:
        | "creche"
        | "pre_escola"
        | "fundamental_ai"
        | "fundamental_af"
        | "medio"
        | "eja"
        | "especial"
        | "profissionalizante"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "editor", "viewer"],
      etapa_ensino: [
        "creche",
        "pre_escola",
        "fundamental_ai",
        "fundamental_af",
        "medio",
        "eja",
        "especial",
        "profissionalizante",
      ],
    },
  },
} as const
