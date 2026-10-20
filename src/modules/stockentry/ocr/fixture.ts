import { readFileSync } from "node:fs";
import type { OcrProvider, ParsedIntake } from "./types";

/**
 * A photo reader that returns a prepared result from a JSON file instead of reading the photo (roadmap 9.6:
 * the end-to-end journeys need the same lines every run). Only used when PCRM_E2E=1 and OCR_FIXTURE_FILE
 * are both set, which no real installation does.
 */
export function fixtureProvider(file: string): OcrProvider {
  return {
    name: "LOCAL",
    async extract() {
      const structured = JSON.parse(readFileSync(file, "utf8")) as ParsedIntake;
      return { provider: "FIXTURE", pages: [], structured };
    },
  };
}
