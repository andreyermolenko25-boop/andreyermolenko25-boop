// Gray PNG -> pixel portrait: one hex digit (0 = dark .. f = light) per cell.
// Make the PNG first (crop to the head with the ears), e.g.:
//   ffmpeg -i avatar.jpg -vf "crop=330:330:65:125,scale=80:80:flags=area,format=gray" -c:v png face.png
// Usage: node scripts/portrait.mjs face.png > assets/portrait.txt
import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";

const buf = readFileSync(process.argv[2]);
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
const g = [];
for (let i = 0; i < W * H; i++) g.push(px[i * bpp]);
const sorted = [...g].sort((a, b) => a - b);
const lo = sorted[Math.floor(g.length * 0.02)], hi = sorted[Math.floor(g.length * 0.98)];
const lines = [];
for (let y = 0; y < H; y++) {
  let s = "";
  for (let x = 0; x < W; x++) {
    let v = Math.min(1, Math.max(0, (g[y * W + x] - lo) / (hi - lo || 1)));
    // dim the background around the head (ellipse that also covers the ears)
    const dx = (x - W * 0.5) / (W * 0.4), dy = (y - H * 0.56) / (H * 0.52);
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d > 0.85) v *= Math.max(0.12, 1 - (d - 0.85) / 0.3);
    s += Math.round(v * 15).toString(16);
  }
  lines.push(s);
}
console.log(lines.join("\n"));
