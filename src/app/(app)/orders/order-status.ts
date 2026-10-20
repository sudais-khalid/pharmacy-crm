/** How an order's status reads on screen. */
export type OrderRow = { id: string; number: string; status: string; expectedDate: string | null; createdAt: string; estimatedTotal: string; lines: number; ordered: number; received: number; pending: number; supplier: { id: string; name: string } };
export const ORDER_STATUS: Record<string, { label: string; tone: "slate" | "blue" | "amber" | "green" | "red" }> = {
  DRAFT: { label: "Draft", tone: "slate" }, SENT: { label: "Sent", tone: "blue" }, PARTIALLY_RECEIVED: { label: "Partly received", tone: "amber" },
  RECEIVED: { label: "Received", tone: "green" }, CLOSED: { label: "Closed short", tone: "slate" }, CANCELLED: { label: "Cancelled", tone: "red" },
};

