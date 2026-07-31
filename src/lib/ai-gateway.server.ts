import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";

export function createLovableAiGatewayProvider(lovableApiKey: string) {
  return createOpenAICompatible({
    name: "lovable",
    baseURL: "https://ai.gateway.lovable.dev/v1",
    headers: {
      "Lovable-API-Key": lovableApiKey,
      "X-Lovable-AIG-SDK": "vercel-ai-sdk",
    },
  });
}

export function createOpenAIProvider(openaiApiKey: string) {
  return createOpenAICompatible({
    name: "openai",
    baseURL: "https://api.openai.com/v1",
    headers: { Authorization: `Bearer ${openaiApiKey}` },
  });
}

export const OPENAI_DEFAULT_MODEL = "gpt-4o-mini";
export const LOVABLE_DEFAULT_MODEL = "google/gemini-3-flash-preview";

/**
 * Modelo principal de extração: OpenAI (OPENAI_API_KEY) quando disponível,
 * com fallback automático para o Lovable AI Gateway (LOVABLE_API_KEY).
 */
export function getExtractionModel(): { model: LanguageModel; provider: "openai" | "lovable"; modelId: string } {
  const openaiKey = process.env.OPENAI_API_KEY;
  if (openaiKey) {
    const modelId = process.env.OPENAI_MODEL || OPENAI_DEFAULT_MODEL;
    return { model: createOpenAIProvider(openaiKey)(modelId), provider: "openai", modelId };
  }
  const lovableKey = process.env.LOVABLE_API_KEY;
  if (!lovableKey) throw new Error("Nenhuma chave de IA configurada (OPENAI_API_KEY ou LOVABLE_API_KEY)");
  return {
    model: createLovableAiGatewayProvider(lovableKey)(LOVABLE_DEFAULT_MODEL),
    provider: "lovable",
    modelId: LOVABLE_DEFAULT_MODEL,
  };
}
