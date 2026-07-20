import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const Input = z.object({
  url: z.string().url(),
  maxRequests: z.number().int().min(1).max(20).optional(),
  maxDepth: z.number().int().min(0).max(3).optional(),
  timeoutMs: z.number().int().min(10_000).max(180_000).optional(),
});

export const Route = createFileRoute("/api/debug/apify")({
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

        const { crawlSite } = await import("@/lib/apify.server");
        const { extractContactsRegex } = await import("@/lib/scraper.server");

        const result = await crawlSite(parsed.data.url, {
          maxRequests: parsed.data.maxRequests,
          maxDepth: parsed.data.maxDepth,
        });

        if (!result.ok) {
          return Response.json({
            ok: false,
            reason: result.reason,
            elapsedMs: result.elapsedMs,
          });
        }

        const emailsSet = new Set<string>();
        const phonesSet = new Set<string>();
        const perPage = result.pages.map((p) => {
          const { emails, telefones } = extractContactsRegex(p.markdown);
          emails.forEach((e) => emailsSet.add(e));
          telefones.forEach((t) => phonesSet.add(t));
          return {
            url: p.url,
            title: p.title,
            bytes: p.markdown.length,
            emails,
            telefones,
            preview: p.markdown.slice(0, 400),
          };
        });

        return Response.json({
          ok: true,
          elapsedMs: result.elapsedMs,
          pagesCrawled: result.pages.length,
          emails: [...emailsSet],
          telefones: [...phonesSet],
          pages: perPage,
        });
      },
    },
  },
});
