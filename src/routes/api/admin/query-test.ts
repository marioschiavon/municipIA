import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const Input = z.object({
  variantes: z.array(z.string().min(5)).min(1).max(6),
  municipios: z
    .array(z.object({ ibgeId: z.number().int().positive(), nome: z.string().min(1), uf: z.string().length(2) }))
    .min(1)
    .max(30),
});

export const Route = createFileRoute("/api/admin/query-test")({
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
          return Response.json(parsed.error.flatten(), { status: 400 });
        }

        const { requireAdminBearer } = await import("@/lib/api-auth.server");
        const auth = await requireAdminBearer(request);
        if (!auth.ok) return new Response(auth.message, { status: 401 });

        const { variantes, municipios } = parsed.data;
        const { testarQueryAiOverview } = await import("@/lib/prospect.server");
        const { renderQueryTemplate } = await import("@/lib/prospect-query.server");
        const encoder = new TextEncoder();

        const stream = new ReadableStream<Uint8Array>({
          async start(controller) {
            const send = (obj: unknown) => controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
            try {
              for (let vi = 0; vi < variantes.length; vi++) {
                const template = variantes[vi]!;
                for (const m of municipios) {
                  const query = renderQueryTemplate(template, m.nome, m.uf);
                  send({ kind: "start", variante: vi, ibgeId: m.ibgeId, municipio: m.nome, uf: m.uf, query, ts: Date.now() });
                  const res = await testarQueryAiOverview(query, m.nome, m.uf, (evt) =>
                    send({ kind: "log", variante: vi, ibgeId: m.ibgeId, evt }),
                  );
                  send({ kind: "result", variante: vi, ibgeId: m.ibgeId, municipio: m.nome, uf: m.uf, res, ts: Date.now() });
                }
              }
              send({ kind: "done", ts: Date.now() });
            } catch (e) {
              send({ kind: "error", message: e instanceof Error ? e.message : String(e), ts: Date.now() });
            } finally {
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
