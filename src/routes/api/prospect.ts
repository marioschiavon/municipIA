import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { prospectPipelineHandler } from "@/lib/prospect-api.server";

const Input = z.object({
  municipio: z.string().min(1),
  uf: z.string().length(2),
  ibgeId: z.number().int().positive().optional(),
  fase: z.enum(["completo", "dominio", "secretario", "contato", "rapido"]).default("completo"),
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
        return prospectPipelineHandler(body);
      },
    },
  },
});
