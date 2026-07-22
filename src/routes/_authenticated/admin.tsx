import { createFileRoute, Outlet, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getMyRole } from "@/lib/admin.functions";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { APP_VERSION } from "@/lib/version";
import { Database, Home, Sliders, LogOut, Loader2, ShieldAlert } from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin")({
  component: AdminLayout,
});

function AdminLayout() {
  const navigate = useNavigate();
  const roleFn = useServerFn(getMyRole);
  const role = useQuery({ queryKey: ["my-role"], queryFn: () => roleFn() });

  async function logout() {
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  if (role.isLoading) {
    return <div className="flex min-h-screen items-center justify-center"><Loader2 className="h-5 w-5 animate-spin" /></div>;
  }
  if (role.data && !role.data.isAdmin) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
        <div className="max-w-md rounded-lg border border-red-200 bg-red-50 p-6 text-center">
          <ShieldAlert className="mx-auto h-8 w-8 text-red-600" />
          <h1 className="mt-3 text-lg font-semibold text-red-900">Acesso restrito</h1>
          <p className="mt-2 text-sm text-red-800">
            Sua conta não tem papel <code>admin</code>. Faça login com uma conta autorizada.
          </p>
          <Button onClick={logout} variant="outline" className="mt-4">Sair</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 text-foreground">
      <header className="border-b border-border bg-white">
        <div className="mx-auto flex max-w-[1400px] items-center justify-between px-6 py-3">
          <div className="flex items-center gap-4">
            <Link to="/admin" className="flex items-center gap-2">
              <div className="rounded-md bg-primary/10 p-2"><Database className="h-4 w-4 text-primary" /></div>
              <div>
                <h1 className="text-base font-bold tracking-tight">MunicipIA · Admin</h1>
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{APP_VERSION}</p>
              </div>
            </Link>
            <nav className="ml-6 flex items-center gap-1 text-sm">
              <NavLink to="/admin" icon={<Home className="h-4 w-4" />}>Dashboard</NavLink>
              <NavLink to="/admin/municipios" icon={<Database className="h-4 w-4" />}>Municípios</NavLink>
              <NavLink to="/admin/score" icon={<Sliders className="h-4 w-4" />}>Pesos do score</NavLink>
            </nav>
          </div>
          <div className="flex items-center gap-2">
            <Link to="/" className="text-xs text-muted-foreground hover:underline">Ver site público</Link>
            <Button variant="outline" size="sm" onClick={logout}>
              <LogOut className="mr-1.5 h-3.5 w-3.5" /> Sair
            </Button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-[1400px] px-6 py-6">
        <Outlet />
      </main>
    </div>
  );
}

function NavLink({ to, icon, children }: { to: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <Link
      to={to}
      className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-slate-600 hover:bg-slate-100 hover:text-slate-900 [&.active]:bg-primary/10 [&.active]:text-primary"
      activeOptions={{ exact: to === "/admin" }}
    >
      {icon}{children}
    </Link>
  );
}
