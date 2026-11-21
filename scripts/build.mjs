// Builds the animated profile cards (light + dark) of the README from live GitHub data.
// Usage: GITHUB_TOKEN=... node scripts/build.mjs   (LOGIN defaults to the repo owner)
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const LOGIN = process.env.LOGIN || "andreyermolenko25-boop";

const TOKEN = process.env.GITHUB_TOKEN;
if (!TOKEN) throw new Error("GITHUB_TOKEN is not set");

const QUERY = `query($login: String!) {
  user(login: $login) {
    createdAt
    followers { totalCount }
    repositories(ownerAffiliations: OWNER, privacy: PUBLIC, first: 50, isFork: false) {
      totalCount
      nodes { languages(first: 6, orderBy: {field: SIZE, direction: DESC}) { edges { size node { name color } } } }
    }
    contributionsCollection {
      totalCommitContributions
      restrictedContributionsCount
      contributionCalendar {
        totalContributions
        weeks { contributionDays { date contributionCount weekday } }
      }
    }
  }
}`;

const res = await fetch("https://api.github.com/graphql", {
  method: "POST",
  headers: { Authorization: `bearer ${TOKEN}`, "Content-Type": "application/json", "User-Agent": "profile-cards" },
  body: JSON.stringify({ query: QUERY, variables: { login: LOGIN } }),
});
const json = await res.json();
if (json.errors || !json.data?.user) throw new Error(JSON.stringify(json.errors || json));
const user = json.data.user;
const cal = user.contributionsCollection.contributionCalendar;
const weeks = cal.weeks.map((w) => w.contributionDays);
const days = weeks.flat();

// ---- stats -------------------------------------------------------------
const fmt = (n) => n.toLocaleString("en-US");
const today = days[days.length - 1];
let longest = 0, run = 0;
for (const d of days) { run = d.contributionCount > 0 ? run + 1 : 0; longest = Math.max(longest, run); }
let current = 0;
for (let i = days.length - 1 - (today.contributionCount === 0 ? 1 : 0); i >= 0 && days[i].contributionCount > 0; i--) current++;
const best = days.reduce((a, d) => (d.contributionCount > a.contributionCount ? d : a), days[0]);
const active = days.filter((d) => d.contributionCount > 0).length;
const perActive = active ? cal.totalContributions / active : 0;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const shortDate = (iso) => { const [, m, d] = iso.split("-"); return `${MONTHS[+m - 1]} ${+d}`; };

const monthly = new Map();
for (const d of days) { const k = d.date.slice(0, 7); monthly.set(k, (monthly.get(k) || 0) + d.contributionCount); }
const months = [...monthly.entries()].slice(-12);

const langs = new Map();
for (const r of user.repositories.nodes) for (const e of r.languages.edges) {
  const cur = langs.get(e.node.name) || { size: 0, color: e.node.color };
  cur.size += e.size; langs.set(e.node.name, cur);
}
const langAll = [...langs.values()].reduce((s, v) => s + v.size, 0) || 1;
const langList = [...langs.entries()].sort((a, b) => b[1].size - a[1].size).filter(([, v]) => v.size / langAll >= 0.01).slice(0, 4);
const langTotal = langList.reduce((s, [, v]) => s + v.size, 0) || 1;


// ---- look: GitHub's own light and dark palettes -------------------------
const W = 840;
const THEMES = {
  light: { bg: "#ffffff", line: "#d0d7de", tile: "#f6f8fa", text: "#1f2328", muted: "#59636e", accent: "#1a7f37",
    levels: ["#ebedf0", "#9be9a8", "#40c463", "#30a14e", "#216e39"], bar: "#2da44e", ring: "#d0d7de" },
  dark: { bg: "#0d1117", line: "#3d444d", tile: "#151b23", text: "#f0f6fc", muted: "#9198a1", accent: "#3fb950",
    levels: ["#151b23", "#033a16", "#196c2e", "#2ea043", "#56d364"], bar: "#3fb950", ring: "#3d444d" },
};
const FONT = `-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans', Helvetica, Arial, sans-serif`;
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const css = (t) => `
  text { font-family: ${FONT}; fill: ${t.text}; }
  .muted { fill: ${t.muted}; } .accent { fill: ${t.accent}; }
  .fade { opacity: 0; animation: fade .6s ease-out forwards; }
  @keyframes fade { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
  .pop { opacity: 0; animation: pop .4s ease-out forwards; transform-box: fill-box; transform-origin: center; }
  @keyframes pop { from { opacity: 0; transform: scale(.2); } to { opacity: 1; transform: scale(1); } }
  .grow { transform: scaleY(0); animation: grow .8s cubic-bezier(.2,.8,.2,1) forwards; transform-box: fill-box; transform-origin: bottom; }
  @keyframes grow { to { transform: scaleY(1); } }
  .dot { opacity: 0; animation: dot .18s ease-out forwards; }
  @keyframes dot { to { opacity: 1; } }
  @media (prefers-reduced-motion: reduce) { .fade, .pop, .grow, .dot { animation: none; opacity: 1; transform: none; } }
`;

const card = (t, h, label, body) => `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${h}" viewBox="0 0 ${W} ${h}" role="img" aria-label="${esc(label)}">
<style>${css(t)}</style>
<rect x=".5" y=".5" width="${W - 1}" height="${h - 1}" rx="12" fill="${t.bg}" stroke="${t.line}"/>
${body}
</svg>`;

const portraitRows = readFileSync(join(ROOT, "assets/portrait.txt"), "utf8").replace(/\r/g, "").split("\n").filter(Boolean);

function build(theme) {
  const t = THEMES[theme];

  // ---- card 1: contributions heatmap ------------------------------------
  {
    const cell = 11, gap = 3, step = cell + gap, gx = 56, gy = 78;
    const max = Math.max(1, ...days.map((d) => d.contributionCount));
    const level = (n) => (n === 0 ? 0 : n >= max * 0.5 ? 4 : n >= max * 0.2 ? 3 : n >= max * 0.06 ? 2 : 1);
    let cells = "", labels = "", lastMonth = -1;
    weeks.forEach((w, wi) => {
      const m = +w[0].date.slice(5, 7) - 1;
      if (m !== lastMonth && w[0].date.slice(8) <= "07" && wi < weeks.length - 2) {
        labels += `<text x="${gx + wi * step}" y="${gy - 10}" font-size="11" class="muted">${MONTHS[m]}</text>`;
        lastMonth = m;
      }
      for (const d of w) {
        const lv = level(d.contributionCount);
        cells += `<rect x="${gx + wi * step}" y="${gy + d.weekday * step}" width="${cell}" height="${cell}" rx="2.5" fill="${t.levels[lv]}"${lv ? ` class="pop" style="animation-delay:${(0.3 + wi * 0.03 + d.weekday * 0.01).toFixed(3)}s"` : ""}><title>${d.contributionCount} on ${d.date}</title></rect>`;
      }
    });
    for (const [i, name] of [[1, "Mon"], [3, "Wed"], [5, "Fri"]])
      labels += `<text x="${gx - 10}" y="${gy + i * step + 9}" font-size="10.5" text-anchor="end" class="muted">${name}</text>`;
    const endY = gy + 7 * step + 22;
    let legend = `<text x="${W - 176}" y="${endY}" font-size="11" class="muted">Less</text>`;
    t.levels.forEach((c, i) => { legend += `<rect x="${W - 144 + i * 15}" y="${endY - 10}" width="11" height="11" rx="2.5" fill="${c}"/>`; });
    legend += `<text x="${W - 64}" y="${endY}" font-size="11" class="muted">More</text>`;
    const body = `<text x="28" y="38" font-size="15" font-weight="600">Contribution activity</text>
<text x="${W - 28}" y="38" font-size="13" text-anchor="end" class="muted"><tspan class="accent" font-weight="600">${fmt(cal.totalContributions)}</tspan> contributions in the last year</text>
${labels}
${cells}
${legend}`;
    writeFileSync(join(ROOT, `assets/activity-${theme}.svg`), card(t, endY + 22, `${fmt(cal.totalContributions)} contributions in the last year`, body));
  }

  // ---- card 2: pixel portrait + stats + months + languages ---------------
  {
    // portrait (assets/portrait.txt): grey, background cut out, in a square frame; squares are drawn
    // one by one from the top, left to right, like a printer
    const COLS = portraitRows[0].length / 2, ROWS = portraitRows.length, D = 280, ox = 28, oy = 28;
    const cs = D / Math.max(COLS, ROWS), px0 = ox + (D - COLS * cs) / 2, py0 = oy + (D - ROWS * cs) / 2;
    let art = `<rect x="${ox - 6}" y="${oy - 6}" width="${D + 12}" height="${D + 12}" rx="8" fill="${t.tile}" stroke="${t.line}"/>
<g transform="translate(${px0} ${py0}) scale(${cs})">`;
    let n = 0;
    portraitRows.forEach((row, y) => {
      for (let x = 0; x < COLS; x++) {
        const v = row.slice(x * 2, x * 2 + 2);
        if (v === "--") continue;
        art += `<rect x="${x}" y="${y}" width=".9" height=".9" fill="#${v}${v}${v}" class="dot" style="animation-delay:${(0.2 + n++ * 0.0012).toFixed(4)}s"/>`;
      }
    });
    art += `</g>`;

    // stats
    const stats = [
      ["Contributions", fmt(cal.totalContributions), "in the last year"],
      ["Current streak", `${current}`, current === 1 ? "day" : "days"],
      ["Longest streak", `${longest}`, "days in a row"],
      ["Best day", `${best.contributionCount}`, shortDate(best.date)],
      ["Active days", `${active}`, "this year"],
      ["Per active day", perActive.toFixed(1), "contributions"],
    ];
    const sx = 344, sy = 28, tw = 228, th = 64, g = 12;
    let tiles = "";
    stats.forEach(([label, value, sub], i) => {
      const x = sx + (i % 2) * (tw + g), y = sy + Math.floor(i / 2) * (th + g);
      tiles += `<g class="fade" style="animation-delay:${(0.5 + i * 0.1).toFixed(2)}s">
  <rect x="${x}" y="${y}" width="${tw}" height="${th}" rx="8" fill="${t.tile}" stroke="${t.line}"/>
  <text x="${x + 16}" y="${y + 24}" font-size="12" class="muted">${esc(label)}</text>
  <text x="${x + 16}" y="${y + 50}" font-size="22" font-weight="600">${esc(value)}<tspan font-size="12" font-weight="400" class="muted" dx="8">${esc(sub)}</tspan></text>
</g>`;
    });

    // months
    const by = sy + 3 * (th + g) + 6, bh = 70, bw = 26, span = 2 * tw + g, bgap = (span - 12 * bw) / 11;
    const mmax = Math.max(1, ...months.map(([, v]) => v));
    let bars = `<text x="${sx}" y="${by + 6}" font-size="12" class="muted fade" style="animation-delay:1.1s">Contributions per month</text>`;
    months.forEach(([k, v], i) => {
      const h = Math.max(v ? 3 : 2, (v / mmax) * bh), x = sx + i * (bw + bgap), base = by + 18 + bh;
      bars += `<rect x="${x}" y="${base - h}" width="${bw}" height="${h}" rx="3" fill="${v ? t.bar : t.levels[0]}" class="grow" style="animation-delay:${(1.2 + i * 0.05).toFixed(2)}s"><title>${v} in ${MONTHS[+k.slice(5) - 1]} ${k.slice(0, 4)}</title></rect>`;
      bars += `<text x="${x + bw / 2}" y="${base + 15}" font-size="10.5" text-anchor="middle" class="muted">${MONTHS[+k.slice(5) - 1]}</text>`;
    });

    // languages
    const ly = Math.max(oy + D + 10, by + 18 + bh + 22) + 26;
    let lang = `<text x="28" y="${ly}" font-size="12" class="muted fade" style="animation-delay:1.6s">Public code by language</text>`;
    let lx = 28; const lw = W - 56;
    lang += `<g class="fade" style="animation-delay:1.7s">`;
    langList.forEach(([, v], i) => {
      const w = (v.size / langTotal) * lw;
      lang += `<rect x="${lx}" y="${ly + 10}" width="${Math.max(2, w - (i < langList.length - 1 ? 2 : 0))}" height="8" rx="2" fill="${v.color || t.bar}"/>`;
      lx += w;
    });
    lang += `</g>`;
    let tx = 28;
    langList.forEach(([name, v], i) => {
      const pct = `${((v.size / langTotal) * 100).toFixed(0)}%`;
      lang += `<g class="fade" style="animation-delay:${(1.8 + i * 0.1).toFixed(2)}s"><circle cx="${tx + 5}" cy="${ly + 36}" r="5" fill="${v.color || t.bar}"/><text x="${tx + 16}" y="${ly + 40}" font-size="12.5" font-weight="600">${esc(name)}<tspan class="muted" font-weight="400" dx="6">${pct}</tspan></text></g>`;
      tx += 16 + (name.length + pct.length) * 7.6 + 34;
    });

    const h = ly + 60;
    writeFileSync(join(ROOT, `assets/profile-${theme}.svg`), card(t, h, `Pixel portrait and stats: ${current}-day streak, best day ${best.contributionCount}`, `${art}\n${tiles}\n${bars}\n${lang}`));
  }
}

build("light");
build("dark");
console.log(`ok: ${fmt(cal.totalContributions)} contributions, streak ${current}/${longest}, best ${best.contributionCount} on ${best.date}, ${active} active days`);
