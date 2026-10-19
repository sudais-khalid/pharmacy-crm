"use client";
import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Camera, FileSpreadsheet, Keyboard, ListChecks, Plus } from "lucide-react";
import { Badge, Button, Card, EmptyState, ErrorBox, Modal, PageHeader, Pagination, TableSkeleton, TableWrap, Tabs, useToast } from "@/components/ui";
import { useMoney } from "@/components/app-context";
import { api, formatDateTime, qs, useApi } from "@/lib/client";

type Row = {
  id: string; number: string; kind: "PURCHASE_BILL" | "STOCK_LIST"; source: "MANUAL" | "OCR" | "IMPORT"; status: string; supplierInvoice: string | null;
  billTotal: string | null; createdAt: string; updatedAt: string; supplier: { name: string } | null; purchase: { number: string } | null; _count: { lines: number; pages: number };
};
type Page = { items: Row[]; total: number; page: number; pageSize: number };
const STATUS: Record<string, [string, "slate" | "blue" | "amber" | "green" | "red"]> = {
  DRAFT: ["Draft", "slate"], UPLOADED: ["Uploaded", "blue"], PROCESSING: ["Reading", "blue"], NEEDS_REVIEW: ["Needs review", "amber"],
  POSTED: ["Posted", "green"], FAILED: ["Could not read", "red"], DISCARDED: ["Discarded", "slate"],
};
const SOURCE = { MANUAL: "Typed", OCR: "Photo", IMPORT: "File" };

/** Stock entry (task 4.3): drafts waiting for review and posted entries, and the four ways to start one. */
function StockEntryList() {
  const router = useRouter();
  const toast = useToast();
  const money = useMoney();
  const params = useSearchParams();
  const [tab, setTab] = useState<"open" | "posted" | "all">("open");
  const [page, setPage] = useState(1);
  const [choosing, setChoosing] = useState(false);
  useEffect(() => { if (params.get("new")) setChoosing(true); }, [params]);
  useEffect(() => setPage(1), [tab]);
  const { data, error, loading, reload } = useApi<Page>(`/api/stock-entry?${qs({ status: tab, page })}`);

  async function startTyping(kind: "PURCHASE_BILL" | "STOCK_LIST") {
    try {
      const r = await api<{ id: string }>("/api/stock-entry", { body: { kind, source: "MANUAL" } });
      router.push(`/stock-entry/${r.id}`);
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  return (
    <>
      <PageHeader title="Stock entry" subtitle="Bring stock in by typing a bill, photographing it, or importing a file. Everything is reviewed before it is posted."
        actions={<Button onClick={() => setChoosing(true)} data-shortcut="new" aria-keyshortcuts="Alt+N" title="Alt+N"><Plus className="h-4 w-4" aria-hidden /> New stock entry</Button>} />
      <Tabs tabs={[{ id: "open", label: "Drafts and review" }, { id: "posted", label: "Posted" }, { id: "all", label: "All" }]} value={tab} onChange={setTab} />
      <Card className="mt-3">
        {error ? <ErrorBox message={error} onRetry={reload} /> : loading && !data ? <TableSkeleton /> : !data?.items.length ? <EmptyState title={tab === "open" ? "Nothing waiting" : "No stock entries"} hint="Start a new stock entry to add stock." /> : (
          <>
            <TableWrap>
              <thead><tr className="border-b border-border"><th className="th">Entry</th><th className="th">Kind</th><th className="th">Supplier</th><th className="th">Lines</th><th className="th text-right">Bill total</th><th className="th">Status</th><th className="th">Updated</th></tr></thead>
              <tbody>
                {data.items.map((r) => (
                  <tr key={r.id} className="border-b border-border/60 hover:bg-muted/50">
                    <td className="td"><Link href={`/stock-entry/${r.id}`} className="font-medium text-primary hover:underline">{r.number}</Link><span className="block text-xs text-fg-muted">{SOURCE[r.source]}{r._count.pages ? `, ${r._count.pages} photo(s)` : ""}</span></td>
                    <td className="td">{r.kind === "PURCHASE_BILL" ? "Supplier bill" : "Stock list"}</td>
                    <td className="td">{r.supplier?.name ?? ""}{r.supplierInvoice && <span className="block text-xs text-fg-muted">Inv. {r.supplierInvoice}</span>}</td>
                    <td className="td">{r._count.lines}</td>
                    <td className="td text-right">{r.billTotal ? money(r.billTotal) : ""}</td>
                    <td className="td"><Badge tone={STATUS[r.status][1]}>{STATUS[r.status][0]}</Badge>{r.purchase && <span className="block text-xs text-fg-muted">{r.purchase.number}</span>}</td>
                    <td className="td whitespace-nowrap">{formatDateTime(r.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
            <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
          </>
        )}
      </Card>

      <Modal open={choosing} onClose={() => setChoosing(false)} title="New stock entry" wide>
        <div className="grid gap-3 sm:grid-cols-2">
          <Choice icon={<Keyboard className="h-5 w-5" />} title="Type in a supplier bill" text="A keyboard grid: medicine, batch, expiry, quantity, bonus, rate." onClick={() => startTyping("PURCHASE_BILL")} />
          <Choice icon={<ListChecks className="h-5 w-5" />} title="Type in a stock list" text="Opening stock or a count from a register; no supplier." onClick={() => startTyping("STOCK_LIST")} />
          <Choice icon={<Camera className="h-5 w-5" />} title="Photo of a supplier bill" text="Take or choose photos; the lines are read for you to check." href="/stock-entry/upload?kind=PURCHASE_BILL" />
          <Choice icon={<Camera className="h-5 w-5" />} title="Photo of a stock list" text="A handwritten or printed list, read for you to check." href="/stock-entry/upload?kind=STOCK_LIST" />
          <Choice icon={<FileSpreadsheet className="h-5 w-5" />} title="Import a file" text="Excel or CSV: opening stock or a supplier's price list." href="/stock-entry/import" />
        </div>
      </Modal>
    </>
  );
}

function Choice({ icon, title, text, onClick, href }: { icon: React.ReactNode; title: string; text: string; onClick?: () => void; href?: string }) {
  const body = (
    <span className="flex gap-3 rounded-lg border border-border p-4 text-left hover:border-primary hover:bg-muted/50">
      <span className="mt-0.5 text-primary" aria-hidden>{icon}</span>
      <span><span className="block font-medium">{title}</span><span className="block text-sm text-fg-muted">{text}</span></span>
    </span>
  );
  return href ? <Link href={href}>{body}</Link> : <button type="button" onClick={onClick}>{body}</button>;
}

export default function StockEntryPage() {
  return <Suspense><StockEntryList /></Suspense>;
}
