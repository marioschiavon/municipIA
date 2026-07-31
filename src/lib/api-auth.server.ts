// Checagem de admin pra rotas cruas em src/routes/api/*.ts — o layout
// `_authenticated` do React Router só protege NAVEGAÇÃO de página, não
// protege esses endpoints HTTP (acessíveis direto, independente da UI).
// Mesmo padrão já usado em src/routes/api/admin/import.ts. Server-only.

export type AdminAuthResult =
  | { ok: true; userId: string }
  | { ok: false; message: string };

export async function requireAdminBearer(request: Request): Promise<AdminAuthResult> {
  const auth = request.headers.get("authorization") ?? "";
  const token = auth.replace(/^Bearer\s+/i, "");
  if (!token) return { ok: false, message: "Token de autenticação ausente" };

  const { createClient } = await import("@supabase/supabase-js");
  const supabaseUser = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error } = await supabaseUser.auth.getUser(token);
  if (error || !userData.user) return { ok: false, message: "Sessão inválida" };

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: isAdmin } = await supabaseAdmin.rpc("has_role", { _user_id: userData.user.id, _role: "admin" });
  if (!isAdmin) return { ok: false, message: "Acesso restrito a administradores" };

  return { ok: true, userId: userData.user.id };
}
