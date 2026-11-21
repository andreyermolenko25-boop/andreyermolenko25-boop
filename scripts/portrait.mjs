// PNG -> colour pixel portrait: one hex colour per cell.
// Make the PNG first (head with the ears, centred), e.g.:
//   ffmpeg -i avatar.jpg -vf "crop=300:300:55:135,scale=64:64:flags=area,format=rgb24" -c:v png face.png
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
// one 6-digit hex colour per cell, rows of W cells
const lines = [];
for (let y = 0; y < H; y++) {
  let row = "";
  for (let x = 0; x < W; x++) {
    const o = (y * W + x) * bpp;
    const rgb = bpp >= 3 ? [px[o], px[o + 1], px[o + 2]] : [px[o], px[o], px[o]];
    row += rgb.map((v) => v.toString(16).padStart(2, "0")).join("");
  }
  lines.push(row);
}
console.log(lines.join("\n"));
