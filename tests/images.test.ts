import { describe, it, expect } from "vitest";
import { deflateSync } from "node:zlib";
import { sniffImage } from "@/lib/images";

function png(w: number, h: number) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  const chunk = (t: string, d: Buffer) => Buffer.concat([Buffer.from([0, 0, 0, d.length]).subarray(0, 4), Buffer.from(t), d, Buffer.alloc(4)]);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(Buffer.alloc(10)))]);
}
const jpeg = (w: number, h: number) =>
  Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, h >> 8, h & 255, w >> 8, w & 255, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0]);

describe("image sniffing", () => {
  it("reads the type and size from the bytes", () => {
    expect(sniffImage(png(512, 256))).toEqual({ mime: "image/png", width: 512, height: 256 });
    expect(sniffImage(jpeg(1600, 1200))).toEqual({ mime: "image/jpeg", width: 1600, height: 1200 });
  });
  it("refuses anything else, whatever it claims to be", () => {
    expect(sniffImage(Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>"))).toBeNull();
    expect(sniffImage(Buffer.from("%PDF-1.7"))).toBeNull();
    expect(sniffImage(Buffer.alloc(0))).toBeNull();
  });
});
