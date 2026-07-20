import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const Input = z.object({
  mode: z.enum(["wcc", "rag", "serp"]).default("wcc"),
  url: z.string().url().optional(),
  query: z.string().min(2).optional(),
  maxRequests: z.number().int().min(1).max(20).optional(),
  maxDepth: z.number().int().min(0).max(3).optional(),
  maxResults: z.number().int().min(1).max(15).optional(),
  timeoutMs: z.number().int().min(10_000).max(180_000).optional(),
  useGlobs: z.boolean().optional(),
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
        const { mode, url, query } = parsed.data;

        const { crawlSite, ragBrowse, googleSerp } = await import("@/lib/apify.server");
        const { extractContactsRegex } = await import("@/lib/scraper.server");

        let result;
        if (mode === "wcc") {
          if (!url) return Response.json({ ok: false, reason: "url é obrigatória no modo wcc" }, { status: 400 });
          result = await crawlSite(url, {
            maxRequests: parsed.data.maxRequests,
            maxDepth: parsed.data.maxDepth,
            timeoutMs: parsed.data.timeoutMs,
            useGlobs: parsed.data.useGlobs,
          });
        } else if (mode === "rag") {
          if (!query) return Response.json({ ok: false, reason: "query é obrigatória no modo rag" }, { status: 400 });
          result = await ragBrowse(query, {
            maxResults: parsed.data.maxResults,
            timeoutMs: parsed.data.timeoutMs,
          });
        } else {
          if (!query) return Response.json({ ok: false, reason: "query é obrigatória no modo serp" }, { status: 400 });
          result = await googleSerp(query, {
            resultsPerPage: parsed.data.maxResults,
            timeoutMs: parsed.data.timeoutMs,
          });
        }

        if (!result.ok) {
          return Response.json({
            ok: false,
            reason: result.reason,
            elapsedMs: result.elapsedMs,
            mode,
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
            preview: p.markdown.slice(0, 500),
          };
        });

        return Response.json({
          ok: true,
          mode,
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
