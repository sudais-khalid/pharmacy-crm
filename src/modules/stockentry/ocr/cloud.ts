import type { ExtractedDocument, IntakeKindName, OcrImage, OcrProvider, ParsedIntake, ParsedLine } from "./types";
import { parseExpiry } from "./parse";

/**
 * Cloud OCR with a vision model (architecture, section 6.1.2): Claude reads the photos and returns the
 * fields directly, which copes with dense printed bills and with handwriting. Only the photos are sent,
 * never customer data. Needs ANTHROPIC_API_KEY; OCR_CLOUD_MODEL picks the model.
 */
const API = "https://api.anthropic.com/v1/messages";
export const DEFAULT_CLOUD_MODEL = "claude-sonnet-5-5";

const LINE_SCHEMA = {
  type: "object",
  properties: {
    text: { type: "string", description: "The row exactly as printed or written" },
    name: { type: "string", description: "Medicine name with strength and form, as written" },
    batch: { type: ["string", "null"] },
    expiry: { type: ["string", "null"], description: "Expiry as written, e.g. 04/28 or Apr-28" },
    quantity: { type: ["number", "null"], description: "Units charged (not free units)" },
    bonus: { type: ["number", "null"], description: "Free or bonus units" },
    rate: { type: ["number", "null"], description: "Price per unit before discount" },
    discount_percent: { type: ["number", "null"] },
    tax: { type: ["number", "null"], description: "Tax amount on the row" },
    amount: { type: ["number", "null"], description: "Row amount as printed" },
    confidence: { type: "number", description: "0 to 1: how sure you are of this row" },
    page: { type: "integer" },
    box: { type: ["array", "null"], items: { type: "number" }, description: "Approximate [x, y, width, height] of the row as fractions of the page" },
  },
  required: ["text", "name", "confidence", "page"],
};

const TOOL = {
  name: "record_document",
  description: "Record what the supplier bill or stock list says.",
  input_schema: {
    type: "object",
    properties: {
      supplier_name: { type: ["string", "null"] },
      invoice_no: { type: ["string", "null"] },
      bill_date: { type: ["string", "null"], description: "YYYY-MM-DD" },
      bill_total: { type: ["number", "null"], description: "Net total payable" },
      lines: { type: "array", items: LINE_SCHEMA },
    },
    required: ["lines"],
  },
};

const PROMPT: Record<IntakeKindName, string> = {
  PURCHASE_BILL: "These photos are pages of a pharmaceutical distributor's bill from Pakistan. Read every medicine row of the table with its batch, expiry, quantity, bonus (free) quantity, rate, discount, tax and amount, and the header fields. Do not invent values: use null for anything not on the page.",
  STOCK_LIST: "These photos are a pharmacy's stock list or register, possibly handwritten. Read every medicine with its quantity, and batch and expiry when written. Do not invent values: use null for anything not written.",
};

type ToolInput = {
  supplier_name?: string | null; invoice_no?: string | null; bill_date?: string | null; bill_total?: number | null;
  lines: { text: string; name: string; batch?: string | null; expiry?: string | null; quantity?: number | null; bonus?: number | null; rate?: number | null; discount_percent?: number | null; tax?: number | null; amount?: number | null; confidence: number; page: number; box?: number[] | null }[];
};

export function toParsed(input: ToolInput): ParsedIntake {
  const lines: ParsedLine[] = input.lines.map((l) => ({
    rawText: l.text, name: l.name || null, batchNumber: l.batch?.trim() || null, expiryDate: l.expiry ? parseExpiry(l.expiry) : null,
    quantity: l.quantity ?? null, bonusQty: l.bonus ?? null, rate: l.rate ?? null, discountPercent: l.discount_percent ?? null,
    taxAmount: l.tax ?? null, amount: l.amount ?? null, confidence: Math.max(0, Math.min(1, l.confidence ?? 0.5)),
    box: l.box && l.box.length === 4 ? { page: l.page, x: l.box[0], y: l.box[1], w: l.box[2], h: l.box[3] } : null,
  }));
  return {
    header: { supplierName: input.supplier_name ?? null, invoiceNo: input.invoice_no ?? null, billDate: /^\d{4}-\d{2}-\d{2}$/.test(input.bill_date ?? "") ? input.bill_date! : null, billTotal: input.bill_total ?? null, confidence: 0.9 },
    lines,
  };
}

export function cloudProvider(apiKey: string, model = process.env.OCR_CLOUD_MODEL || DEFAULT_CLOUD_MODEL, fetchFn: typeof fetch = fetch): OcrProvider {
  return {
    name: "CLOUD",
    async extract(images: OcrImage[], kind: IntakeKindName): Promise<ExtractedDocument> {
      const content = [
        ...images.flatMap((img) => [
          { type: "text", text: `Page ${img.pageNo}:` },
          { type: "image", source: { type: "base64", media_type: img.mime, data: img.data.toString("base64") } },
        ]),
        { type: "text", text: PROMPT[kind] },
      ];
      const res = await fetchFn(API, {
        method: "POST",
        headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({ model, max_tokens: 8000, tools: [TOOL], tool_choice: { type: "tool", name: TOOL.name }, messages: [{ role: "user", content }] }),
        signal: AbortSignal.timeout(120_000),
      });
      if (!res.ok) throw new Error(`The cloud reader answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const body = (await res.json()) as { content: { type: string; input?: ToolInput }[] };
      const call = body.content.find((c) => c.type === "tool_use" && c.input);
      if (!call?.input) throw new Error("The cloud reader returned no result.");
      return { provider: "CLOUD", pages: [], structured: toParsed(call.input) };
    },
  };
}
