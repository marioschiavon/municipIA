import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const Input = z.object({
  prompt: z.string().min(2).default("Quem é o secretário de educação de Maringá/PR atual?"),
  model: z.string().optional(),
  useJson: z.boolean().optional().default(false),
  timeoutMs: z.number().int().min(5_000).max(180_000).optional().default(60_000),
});

export const Route = createFileRoute("/api/debug/openai")({
  head: () => ({
    meta: [{ title: "Debug OpenAI — MunicipIA" }, { name: "robots", content: "noindex" }],
  }),
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
        const { prompt, model, useJson, timeoutMs } = parsed.data;

        const { getOpenAIKey, chatOpenAI } = await import("@/lib/openai.server");

        const key = getOpenAIKey();
        if (!key) {
          return Response.json({ ok: false, reason: "OPENAI_API_KEY não configurada" }, { status: 500 });
        }

        const messages = [
          { role: "system" as const, content: "Você é um assistente útil e conciso." },
          { role: "user" as const, content: prompt },
        ];

        const result = await chatOpenAI({
          messages,
          model,
          timeoutMs,
          responseFormat: useJson ? { type: "json_object" } : undefined,
        });

        return Response.json(result);
      },
    },
  },
});
