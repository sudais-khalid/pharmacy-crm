/**
 * OCR (architecture, section 6.1.2): providers turn photos into an ExtractedDocument; the parsers turn
 * that into header fields and lines for the review grid. Boxes are fractions of the page (0 to 1), so the
 * review screen can outline a row on the photo at any size.
 */
export type Box = { page: number; x: number; y: number; w: number; h: number };
export type OcrWord = { text: string; conf: number; box: Box };
export type OcrLine = { text: string; conf: number; box: Box; words: OcrWord[] };
export type OcrPage = { pageNo: number; lines: OcrLine[] };

export type ParsedLine = {
  rawText: string;
  name: string | null;
  batchNumber: string | null;
  expiryDate: string | null;
  quantity: number | null;
  bonusQty: number | null;
  rate: number | null;
  discountPercent: number | null;
  taxAmount: number | null;
  amount: number | null;
  confidence: number; // 0..1
  box: Box | null;
};

export type ParsedHeader = { supplierName: string | null; invoiceNo: string | null; billDate: string | null; billTotal: number | null; confidence: number };
export type ParsedIntake = { header: ParsedHeader; lines: ParsedLine[] };

/** What a provider returns: text with positions (local engines), or fields already structured (vision models). */
export type ExtractedDocument = { provider: string; pages: OcrPage[]; structured?: ParsedIntake };

export type OcrImage = { pageNo: number; data: Buffer; mime: string };
export type IntakeKindName = "PURCHASE_BILL" | "STOCK_LIST";

export interface OcrProvider {
  name: "LOCAL" | "CLOUD";
  extract(images: OcrImage[], kind: IntakeKindName): Promise<ExtractedDocument>;
}
