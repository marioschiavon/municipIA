import { useEffect, useState } from "react";
import { Download, Send, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { exportCSV, exportXLSX, type ExportRow } from "@/lib/export";
import {
  initLeadereiBridge,
  onLeadereiSession,
  getLeadereiSession,
  sendToLeaderei,
} from "@/lib/leaderei-bridge";

export function ExportButtons({ rows, disabled }: { rows: ExportRow[]; disabled: boolean }) {
  const noData = rows.length === 0;
  const [hasLeaderei, setHasLeaderei] = useState(false);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    setHasLeaderei(!!getLeadereiSession());
    const cleanup = initLeadereiBridge();
    const off = onLeadereiSession((s) => setHasLeaderei(!!s));
    return () => {
      cleanup?.();
      off();
    };
  }, []);

  async function handleSend() {
    setSending(true);
    try {
      const r = await sendToLeaderei(rows);
      toast.success(`${r.created} leads criados, ${r.updated} atualizados`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao enviar para o Leaderei");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex flex-wrap gap-2">
      <Button variant="outline" size="sm" disabled={disabled || noData} onClick={() => exportCSV(rows)}>
        <Download className="mr-2 h-4 w-4" /> Exportar CSV
      </Button>
      <Button variant="outline" size="sm" disabled={disabled || noData} onClick={() => exportXLSX(rows)}>
        <Download className="mr-2 h-4 w-4" /> Exportar Excel (.xlsx)
      </Button>
      {hasLeaderei && (
        <Button size="sm" disabled={disabled || noData || sending} onClick={handleSend}>
          {sending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
          Enviar para o Leaderei
        </Button>
      )}
    </div>
  );
}
