// PNG -> grey pixel portrait of the head and ears only (background cut out).
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
// Outline of the head with the cat ears, in 0..600 units of the 300x300 crop (traced by hand).
const OUTLINE = [[105,55],[160,72],[205,80],[245,55],[300,42],[360,45],[420,72],[470,95],[540,75],[548,130],[535,190],[515,220],
  [505,270],[505,330],[500,400],[490,440],[470,490],[440,540],[420,600],[230,600],[180,540],[140,490],[110,430],[95,380],
  [100,310],[110,260],[122,205],[110,150],[100,90]].map(([x, y]) => [x / 600, y / 600]);
const inside = (x, y) => {
  let ins = false;
  for (let i = 0, j = OUTLINE.length - 1; i < OUTLINE.length; j = i++) {
    const [xi, yi] = OUTLINE[i], [xj, yj] = OUTLINE[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) ins = !ins;
  }
  return ins;
};

// grey level per cell (2 hex digits), "--" = background (not drawn)
const lum = (o) => (bpp >= 3 ? 0.2126 * px[o] + 0.7152 * px[o + 1] + 0.0722 * px[o + 2] : px[o]);
const vals = [];
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (inside((x + 0.5) / W, (y + 0.5) / H)) vals.push(lum((y * W + x) * bpp));
vals.sort((a, b) => a - b);
const lo = vals[Math.floor(vals.length * 0.01)], hi = vals[Math.floor(vals.length * 0.99)];
const lines = [];
for (let y = 0; y < H; y++) {
  let row = "";
  for (let x = 0; x < W; x++) {
    if (!inside((x + 0.5) / W, (y + 0.5) / H)) { row += "--"; continue; }
    const v = Math.min(1, Math.max(0, (lum((y * W + x) * bpp) - lo) / (hi - lo || 1)));
    row += Math.round(v * 255).toString(16).padStart(2, "0");
  }
  lines.push(row);
}
console.log(lines.join("\n"));
