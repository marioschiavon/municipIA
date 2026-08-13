import { createFileRoute } from "@tanstack/react-router";
import { prospectPipelineHandler } from "@/lib/prospect-api.server";

export const Route = createFileRoute("/api/public/prospect")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return new Response("Invalid JSON", { status: 400 });
        }
        return prospectPipelineHandler(body);
      },
    },
  },
});
