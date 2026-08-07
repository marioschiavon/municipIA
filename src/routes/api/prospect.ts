import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const Input = z.object({
  municipio: z.string().min(1),
  uf: z.string().length(2),
  ibgeId: z.number().int().positive().optional(),
  fase: z.enum(["completo", "dominio", "secretario", "contato"]).default("completo"),
});

export const Route = createFileRoute("/api/prospect")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return new Response("Invalid JSON", { status: 400 });
        }
        const parsed = Input.safeParse(body);
        if (!parsed.success) {
          return new Response(JSON.stringify(parsed.error.flatten()), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }
        const { requireAdminBearer } = await import("@/lib/api-auth.server");
        const auth = await requireAdminBearer(request);
        if (!auth.ok) {
          return new Response(JSON.stringify({ kind: "progress", level: "error", etapa: "final", message: auth.message, ts: Date.now() }) + "\n", {
            status: 401,
            headers: { "Content-Type": "application/x-ndjson; charset=utf-8" },
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
          // Só confia cegamente na página específica se a confirmação for recente
          // (~120 dias) — senão ainda usa o domínio (sitemap), mas redescobre a página.
          const confirmadoRecente = edu?.dominio_confirmado_em
            ? Date.now() - new Date(edu.dominio_confirmado_em).getTime() < 120 * 24 * 60 * 60 * 1000
            : false;
          paginaEducacaoConhecida = confirmadoRecente ? (edu?.pagina_educacao_url ?? null) : null;
        }

        // Fases isoladas de secretário/contato exigem domínio já confirmado
        // (Fase 1) — sem isso não têm onde vasculhar sem recorrer ao Google/Apify,
        // que é exatamente o custo que a separação em fases quer evitar.
        if ((fase === "secretario" || fase === "contato") && !dominioConfirmado) {
          // Marca a tentativa mesmo assim: sem isso o município volta pro topo da
          // fila em todo lote e trava o rodízio.
          if (ibgeId) {
            const { marcarTentativaProspeccao } = await import("@/lib/catalog-update.server");
            await marcarTentativaProspeccao(ibgeId, fase).catch(() => {});
          }
          return new Response(
            JSON.stringify({ kind: "progress", level: "error", etapa: "final", message: "Domínio oficial ainda não confirmado — rode a Fase 1 (domínio) primeiro", ts: Date.now() }) + "\n",
            { status: 400, headers: { "Content-Type": "application/x-ndjson; charset=utf-8" } },
          );
        }


        const { prospectar, prospectarDominio, prospectarSecretario, prospectarContato } = await import("@/lib/prospect.server");
        const encoder = new TextEncoder();

        const stream = new ReadableStream<Uint8Array>({
          async start(controller) {
            const send = (obj: unknown) => {
              controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
            };
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
              } else {
                // prospectar() já emite seu próprio evento "kind: final" internamente (sendFinal).
                result = await prospectar(municipio, uf, (evt) => send(evt), ibgeId, dominioConfirmado, paginaEducacaoConhecida);
              }
              // Persistir se temos ibgeId
              if (ibgeId && result) {
                try {
                  const { persistProspectResult } = await import("@/lib/catalog-update.server");
                  await persistProspectResult(ibgeId, result, fase);
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
              // Cursor do rodízio: sempre registra a tentativa (achou ou não),
              // para o próximo lote continuar de onde este parou.
              if (ibgeId) {
                try {
                  const { marcarTentativaProspeccao } = await import("@/lib/catalog-update.server");
                  await marcarTentativaProspeccao(ibgeId, fase);
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
      },
    },
  },
});
