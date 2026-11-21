// PNG -> grey pixel portrait with the background cut out.
// The background is everything light-and-grey (or bluish) that is connected to the image edge
// (flood fill), so it works for photos shot on a plain light backdrop.
// Make the PNG first, e.g. (the smoking-cat meme):
//   ffmpeg -i cat.jpg -vf "crop=404:300:108:70,format=rgb24" -c:v png cat.png
// Usage: node scripts/portrait.mjs cat.png [cols=64] > assets/portrait.txt
// Output: one line per row, 2 hex digits of grey per cell, "--" = background.
import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";

const buf = readFileSync(process.argv[2]);
const COLS = +(process.argv[3] || 64);
let p = 8, W = 0, H = 0, ct = 0;
const idat = [];
while (p < buf.length) {
  const len = buf.readUInt32BE(p), type = buf.toString("ascii", p + 4, p + 8);
  const data = buf.subarray(p + 8, p + 8 + len);
  if (type === "IHDR") { W = data.readUInt32BE(0); H = data.readUInt32BE(4); ct = data[9]; }
  if (type === "IDAT") idat.push(data);
  p += 12 + len;
}
const bpp = ct === 0 ? 1 : ct === 4 ? 2 : ct === 2 ? 3 : 4;
const raw = inflateSync(Buffer.concat(idat));
const stride = W * bpp, px = Buffer.alloc(H * stride);
for (let y = 0; y < H; y++) {
  const f = raw[y * (stride + 1)], row = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
  for (let x = 0; x < stride; x++) {
    const a = x >= bpp ? px[y * stride + x - bpp] : 0, b = y ? px[(y - 1) * stride + x] : 0;
    const c = x >= bpp && y ? px[(y - 1) * stride + x - bpp] : 0;
    let v = row[x];
    if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
    else if (f === 4) { const q = a + b - c, pa = Math.abs(q - a), pb = Math.abs(q - b), pc = Math.abs(q - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
    px[y * stride + x] = v & 255;
  }
}
const rgb = (i) => (bpp >= 3 ? [px[i * bpp], px[i * bpp + 1], px[i * bpp + 2]] : [px[i * bpp], px[i * bpp], px[i * bpp]]);
const lum = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const looksLikeBackground = (i) => {
  const [r, g, b] = rgb(i), sat = Math.max(r, g, b) - Math.min(r, g, b);
  return (sat < 34 && lum([r, g, b]) > 150) || b > r + 12;
};

// flood fill the background from every edge pixel
const bg = new Uint8Array(W * H);
const stack = [];
for (let x = 0; x < W; x++) stack.push(x, (H - 1) * W + x);
for (let y = 0; y < H; y++) stack.push(y * W, y * W + W - 1);
while (stack.length) {
  const i = stack.pop();
  if (bg[i] || !looksLikeBackground(i)) continue;
  bg[i] = 1;
  const x = i % W, y = (i / W) | 0;
  if (x > 0) stack.push(i - 1);
  if (x < W - 1) stack.push(i + 1);
  if (y > 0) stack.push(i - W);
  if (y < H - 1) stack.push(i + W);
}

// downsample: a cell is drawn when most of it is foreground
const cw = W / COLS, ROWS = Math.round(H / cw);
const cells = [], vals = [];
for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
  let n = 0, fg = 0, sum = 0;
  for (let y = Math.floor(r * cw); y < Math.min(H, Math.floor((r + 1) * cw)); y++)
    for (let x = Math.floor(c * cw); x < Math.min(W, Math.floor((c + 1) * cw)); x++) {
      n++;
      const i = y * W + x;
      if (!bg[i]) { fg++; sum += lum(rgb(i)); }
    }
  const v = fg > n * 0.5 ? sum / fg : null;
  cells.push(v);
  if (v !== null) vals.push(v);
}
vals.sort((a, b) => a - b);
const lo = vals[Math.floor(vals.length * 0.01)], hi = vals[Math.floor(vals.length * 0.99)];
const lines = [];
for (let r = 0; r < ROWS; r++) {
  let row = "";
  for (let c = 0; c < COLS; c++) {
    const v = cells[r * COLS + c];
    row += v === null ? "--" : Math.round(Math.min(1, Math.max(0, (v - lo) / (hi - lo || 1))) * 255).toString(16).padStart(2, "0");
  }
  lines.push(row);
}
console.log(lines.join("\n"));
