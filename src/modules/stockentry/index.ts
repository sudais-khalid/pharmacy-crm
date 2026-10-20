export { createIntake, getIntake, listIntakes, saveDraft, postIntake, discardIntake, autoMatch, checkIntake, intakeInclude, type IntakeIssue } from "./service";
export { intakeDraftSchema, intakeLineSchema, newIntakeSchema, type IntakeDraftInput, type IntakeLineInput } from "./schema";
export { matchMedicine, learnAlias, normalizeItemText, type Match, type MatchMethod } from "./matching";
export { uploadPhotos, retryReading, cleanupDiscardedPhotos, MAX_PAGES, MAX_PAGE_BYTES } from "./upload";
export { claimNextIntake, processIntake, usageKey, defaultProviders } from "./ocr/process";
export { parseDocument, parseBill, parseStockList, parseListLine, parseNumber, parseDate, parseExpiry, parseExpiryCell, parseExpiryAny, reconcileAmounts, settleLine, solveRow, cleanItemName } from "./ocr/parse";
export { cloudProvider, DEFAULT_CLOUD_MODEL } from "./ocr/cloud";
export { localProvider } from "./ocr/local";
export type { OcrProvider, ExtractedDocument, ParsedIntake, ParsedLine, OcrLine } from "./ocr/types";
