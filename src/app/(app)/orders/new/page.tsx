"use client";
import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { PageHeader, useToast } from "@/components/ui";
import { api } from "@/lib/client";
import { OrderEditor, emptyEditor } from "../order-editor";

/** A new order to a supplier, saved as a draft (roadmap 7.4). */
function NewOrder() {
  const router = useRouter();
  const toast = useToast();
  const supplier = useSearchParams().get("supplier") ?? "";
  const [value, setValue] = useState(() => emptyEditor(supplier));
  const [saving, setSaving] = useState(false);
  async function save(body: unknown) {
    setSaving(true);
    try {
      const o = await api<{ id: string; number: string }>("/api/orders", { body });
      toast.success(`${o.number} saved as a draft`);
      router.push(`/orders/${o.id}`);
    } finally {
      setSaving(false);
    }
  }
  return (
    <>
      <PageHeader title="New supply order" subtitle="An order changes no stock and no account. Stock comes in when the order is received." />
      <OrderEditor value={value} onChange={setValue} onSave={save} saving={saving} />
    </>
  );
}

export default function NewOrderPage() { return <Suspense><NewOrder /></Suspense>; }
