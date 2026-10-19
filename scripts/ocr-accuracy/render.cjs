// Electron main script: renders synthetic supplier bills and stock lists to PNG with their true contents,
// for scripts/ocr-accuracy.mjs. Deterministic: the same seed gives the same documents.
//   electron scripts/ocr-accuracy/render.cjs <out dir> <count>
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

const out = path.resolve(process.argv[2] ?? "ocr-samples");
const count = Number(process.argv[3] ?? 12);

let seed = 20261019;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = (a) => a[Math.floor(rand() * a.length)];
const int = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));

const MEDICINES = [
  "Panadol 500mg Tablet", "Augmentin 625mg Tablet", "Brufen 400mg Tablet", "Flagyl 400mg Tablet", "Risek 20mg Capsule",
  "Arinac Forte Tablet", "Calpol Syrup 60ml", "Ventolin Inhaler", "Disprin 300mg Tablet", "Lipiget 10mg Tablet",
  "Glucophage 500mg Tablet", "Amoxil 250mg Capsule", "Zyrtec 10mg Tablet", "Softin 10mg Tablet", "Nexum 40mg Capsule",
  "Ponstan 250mg Tablet", "Surbex Z Tablet", "Cac 1000 Plus", "Motilium 10mg Tablet", "Ciproxin 500mg Tablet",
];
const SUPPLIERS = ["Muller and Phipps Pakistan", "Ali Medical Distributors", "United Distributors", "Premier Sales"];
const FONTS = ["Arial", "Courier New", "Times New Roman", "Segoe UI", "Consolas"];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const lastDay = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();

function makeLine() {
  const y = int(2027, 2029);
  const m = int(1, 12);
  const qty = pick([10, 12, 20, 24, 30, 50, 100, 120, 200]);
  const rate = Math.round(rand() * 900 * 100) / 100 + 5;
  const style = int(0, 2);
  const expiryText = style === 0 ? `${String(m).padStart(2, "0")}/${String(y).slice(2)}` : style === 1 ? `${MON[m - 1]}-${String(y).slice(2)}` : `${String(m).padStart(2, "0")}/${y}`;
  return {
    name: pick(MEDICINES),
    batchNumber: `${pick(["B", "L", "AX", "K"])}${int(100, 9999)}`,
    expiryDate: `${y}-${String(m).padStart(2, "0")}-${lastDay(y, m)}`,
    expiryText,
    quantity: qty,
    bonusQty: pick([0, 0, 0, Math.round(qty / 10)]),
    rate,
    amount: Math.round(qty * rate * 100) / 100,
  };
}

function billHtml(doc, font, tilt) {
  const rows = doc.lines.map((l) => `<tr><td>${l.name}</td><td>${l.batchNumber}</td><td>${l.expiryText}</td><td class=n>${l.quantity}</td><td class=n>${l.bonusQty || ""}</td><td class=n>${l.rate.toFixed(2)}</td><td class=n>${l.amount.toFixed(2)}</td></tr>`).join("");
  return `<!doctype html><html><body style="margin:0;background:#fff">
<div style="font-family:'${font}';font-size:17px;color:#111;padding:40px;width:1100px;transform:rotate(${tilt}deg);transform-origin:center">
<div style="font-size:26px;font-weight:bold">${doc.supplierName}</div>
<div>Plot 12, Industrial Area, Karachi</div>
<div style="margin-top:16px">Invoice No: ${doc.invoiceNo}</div><div>Date: ${doc.billDateText}</div>
<table style="width:100%;margin-top:20px;border-collapse:collapse" cellpadding=6>
<style>td,th{border-bottom:1px solid #999;text-align:left}.n{text-align:right}</style>
<tr><th>Description</th><th>Batch</th><th>Expiry</th><th class=n>Qty</th><th class=n>Bonus</th><th class=n>Rate</th><th class=n>Amount</th></tr>
${rows}</table>
<div style="margin-top:20px;text-align:right;font-weight:bold">Net Total: ${doc.billTotal.toFixed(2)}</div>
</div></body></html>`;
}

function listHtml(doc, font, tilt) {
  const rows = doc.lines.map((l) => `<div>${l.name} ${l.batchNumber} exp ${l.expiryText} qty ${l.quantity}</div>`).join("");
  return `<!doctype html><html><body style="margin:0;background:#fff">
<div style="font-family:'${font}';font-size:19px;line-height:1.7;color:#111;padding:40px;width:1000px;transform:rotate(${tilt}deg)">
<div style="font-weight:bold;margin-bottom:12px">Stock count</div>${rows}</div></body></html>`;
}

app.whenReady().then(async () => {
  fs.mkdirSync(out, { recursive: true });
  const win = new BrowserWindow({ show: false, width: 1200, height: 1600, webPreferences: { offscreen: true } });
  const truth = [];
  for (let i = 0; i < count; i++) {
    const kind = i % 3 === 2 ? "STOCK_LIST" : "PURCHASE_BILL";
    const lines = Array.from({ length: int(4, 12) }, makeLine);
    const d = int(1, 28);
    const doc = {
      file: `sample-${String(i + 1).padStart(2, "0")}.png`, kind, lines,
      supplierName: pick(SUPPLIERS), invoiceNo: `${pick(["INV", "SI", "A"])}-${int(1000, 99999)}`,
      billDate: `2026-10-${String(d).padStart(2, "0")}`, billDateText: `${String(d).padStart(2, "0")}/10/2026`,
      billTotal: Math.round(lines.reduce((s, l) => s + l.amount, 0) * 100) / 100,
    };
    const font = FONTS[i % FONTS.length];
    const tilt = pick([0, 0, 0.6, -0.8]);
    const html = kind === "PURCHASE_BILL" ? billHtml(doc, font, tilt) : listHtml(doc, font, tilt);
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    const height = await win.webContents.executeJavaScript("document.body.scrollHeight + 40");
    win.setContentSize(1200, Math.min(3000, height));
    await new Promise((r) => setTimeout(r, 150));
    const image = await win.webContents.capturePage();
    fs.writeFileSync(path.join(out, doc.file), image.toPNG());
    truth.push({ ...doc, font, tilt });
  }
  fs.writeFileSync(path.join(out, "truth.json"), JSON.stringify(truth, null, 2));
  app.quit();
});
