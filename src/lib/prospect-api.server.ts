import { z } from "zod";

const Input = z.object({
  municipio: z.string().min(1),
  uf: z.string().length(2),
  ibgeId: z.number().int().positive().optional(),
  fase: z.enum(["completo", "dominio", "secretario", "contato", "rapido"]).default("completo"),
});

export type ProspectInput = z.infer<typeof Input>;
export { Input };

/**
 * Roda o pipeline de prospecção (mesmo usado pelo admin em /api/prospect),
 * mas sem checagem de autenticação — destinado à rota pública.
 * Reaproveita a persistência e o cursor de tentativas do lote.
 */
export async function prospectPipelineHandler(
  body: unknown,
): Promise<Response> {
  let parsedBody: unknown;
  try {
    parsedBody = typeof body === "string" ? JSON.parse(body) : body;
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const parsed = Input.safeParse(parsedBody);
  if (!parsed.success) {
    return new Response(JSON.stringify(parsed.error.flatten()), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { municipio, uf, ibgeId, fase } = parsed.data;

  // Se já sabemos o domínio oficial confirmado deste município (de uma run
  // anterior ou de edição manual do admin), o pipeline usa ele com
  // exclusividade (sem busca no Google/Apify) — ver Estágio 0 em prospect.server.ts.
  let dominioConfirmado: string | null = null;
  let paginaEducacaoConhecida: string | null = null;
  if (ibgeId) {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: edu } = await supabaseAdmin
      .from("municipios_educacao")
      .select("dominio_oficial, pagina_educacao_url, dominio_confirmado_em")
      .eq("ibge_id", ibgeId)
      .maybeSingle();
    dominioConfirmado = edu?.dominio_oficial ?? null;
    const confirmadoRecente = edu?.dominio_confirmado_em
      ? Date.now() - new Date(edu.dominio_confirmado_em).getTime() < 120 * 24 * 60 * 60 * 1000
      : false;
    paginaEducacaoConhecida = confirmadoRecente ? (edu?.pagina_educacao_url ?? null) : null;
  }

  if ((fase === "secretario" || fase === "contato") && !dominioConfirmado) {
    if (ibgeId) {
      const { marcarTentativaProspeccao } = await import("@/lib/catalog-update.server");
      await marcarTentativaProspeccao(ibgeId, fase).catch(() => {});
    }
    return new Response(
      JSON.stringify({ kind: "progress", level: "error", etapa: "final", message: "Domínio oficial ainda não confirmado — rode a Fase 1 (domínio) primeiro", ts: Date.now() }) + "\n",
      { status: 400, headers: { "Content-Type": "application/x-ndjson; charset=utf-8" } },
    );
  }

  const { prospectar, prospectarDominio, prospectarSecretario, prospectarContato, prospectarRapido } = await import("@/lib/prospect.server");
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (obj: unknown) => {
        controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
      };
      const persistFase = fase === "rapido" ? "completo" : fase;
      try {
        let result;
        if (fase === "dominio") {
          result = await prospectarDominio(municipio, uf, (evt) => send(evt));
          send({ kind: "final", result, ts: Date.now() });
        } else if (fase === "secretario") {
          result = await prospectarSecretario(municipio, uf, dominioConfirmado!, (evt) => send(evt));
          send({ kind: "final", result, ts: Date.now() });
        } else if (fase === "contato") {
          result = await prospectarContato(municipio, uf, dominioConfirmado!, (evt) => send(evt), paginaEducacaoConhecida);
          send({ kind: "final", result, ts: Date.now() });
        } else if (fase === "rapido") {
          result = await prospectarRapido(municipio, uf, (evt) => send(evt));
          send({ kind: "final", result, ts: Date.now() });
        } else {
          result = await prospectar(municipio, uf, (evt) => send(evt), ibgeId, dominioConfirmado, paginaEducacaoConhecida);
        }
        if (ibgeId && result) {
          try {
            const { persistProspectResult } = await import("@/lib/catalog-update.server");
            await persistProspectResult(ibgeId, result, persistFase);
            send({
              kind: "progress",
              level: "success",
              etapa: "final",
              message: "Dados salvos no catálogo e score recalculado",
              ts: Date.now(),
            });
          } catch (e) {
            send({
              kind: "progress",
              level: "error",
              etapa: "final",
              message: "Falha ao salvar no catálogo",
              data: String(e),
              ts: Date.now(),
            });
          }
        }
      } catch (e) {
        send({
          kind: "progress",
          level: "error",
          etapa: "final",
          message: "Falha inesperada na prospecção",
          data: String(e),
          ts: Date.now(),
        });
        send({
          kind: "final",
          result: {
            status: "not_found",
            hierarquia: null,
            secretario: null,
            cargo: null,
            emails: [],
            telefones: [],
            fonte: null,
            fonteUrl: null,
            contexto: e instanceof Error ? e.message : "Erro desconhecido",
          },
          ts: Date.now(),
        });
      } finally {
        if (ibgeId) {
          try {
            const { marcarTentativaProspeccao } = await import("@/lib/catalog-update.server");
            await marcarTentativaProspeccao(ibgeId, persistFase);
          } catch { /* noop */ }
        }
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
