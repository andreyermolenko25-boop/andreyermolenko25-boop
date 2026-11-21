// Builds the animated terminal cards of the profile README from live GitHub data.
// Usage: GITHUB_TOKEN=... node scripts/build.mjs   (LOGIN defaults to the repo owner)
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const LOGIN = process.env.LOGIN || "andreyermolenko25-boop";
const HANDLE = process.env.HANDLE || "mevis";
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

// ---- shared look -------------------------------------------------------
const W = 840;
const C = { bg: "#0d1117", bar: "#161b22", line: "#30363d", text: "#e6edf3", muted: "#7d8590", dim: "#484f58", green: "#3fb950", blue: "#58a6ff" };
const LEVEL = ["#161b22", "#0e4429", "#006d32", "#26a641", "#39d353"];
const FONT = `ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace`;
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const baseCss = `
  text { font-family: ${FONT}; fill: ${C.text}; }
  .muted { fill: ${C.muted}; } .dim { fill: ${C.dim}; } .green { fill: ${C.green}; } .blue { fill: ${C.blue}; }
  .fade { opacity: 0; animation: fade .5s ease-out forwards; }
  @keyframes fade { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
  .pop { opacity: 0; animation: pop .35s ease-out forwards; transform-box: fill-box; transform-origin: center; }
  @keyframes pop { from { opacity: 0; transform: scale(.3); } to { opacity: 1; transform: scale(1); } }
  .grow { transform: scaleY(0); animation: grow .7s cubic-bezier(.2,.8,.2,1) forwards; transform-box: fill-box; transform-origin: bottom; }
  @keyframes grow { to { transform: scaleY(1); } }
  .type { animation: type 1.1s steps(var(--n)) forwards; }
  @keyframes type { from { width: 0; } }
  .cursor { animation: blink 1s steps(1) infinite; }
  @keyframes blink { 50% { opacity: 0; } }
  @media (prefers-reduced-motion: reduce) { .fade, .pop, .grow, .type { animation: none; opacity: 1; transform: none; } }
`;

function frame(h, title, body, css = "") {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${h}" viewBox="0 0 ${W} ${h}" role="img" aria-label="${esc(title)}">
<style>${baseCss}${css}</style>
<rect x=".5" y=".5" width="${W - 1}" height="${h - 1}" rx="10" fill="${C.bg}" stroke="${C.line}"/>
<path d="M.5 10.5a10 10 0 0 1 10-10h${W - 21}a10 10 0 0 1 10 10V34H.5z" fill="${C.bar}"/>
<line x1="0" y1="34" x2="${W}" y2="34" stroke="${C.line}"/>
<circle cx="20" cy="17" r="6" fill="#ff5f57"/><circle cx="40" cy="17" r="6" fill="#febc2e"/><circle cx="60" cy="17" r="6" fill="#28c840"/>
<text x="${W / 2}" y="21.5" text-anchor="middle" font-size="12" class="muted">${esc(title)}</text>
${body}
</svg>`;
}

// typed prompt line: "<handle>@github ~ $ <cmd>"
let clipId = 0;
function prompt(x, y, cmd, delay = 0) {
  const pre = `${HANDLE}@github ~ $ `;
  const id = `c${clipId++}`;
  const cw = 7.83; // advance of a 13px monospace glyph
  return `<clipPath id="${id}"><rect x="${x + pre.length * cw}" y="${y - 14}" width="${cmd.length * cw + 2}" height="20" class="type" style="--n:${cmd.length};animation-delay:${delay}s;animation-fill-mode:both"/></clipPath>
<text x="${x}" y="${y}" font-size="13"><tspan class="green">${esc(HANDLE)}@github</tspan><tspan class="blue"> ~ </tspan><tspan class="muted">$ </tspan></text>
<text x="${x + pre.length * cw}" y="${y}" font-size="13" clip-path="url(#${id})">${esc(cmd)}</text>`;
}

// ---- card 1: contributions heatmap --------------------------------------
{
  const cell = 11, gap = 3, step = cell + gap;
  const gx = 62, gy = 92;
  const max = Math.max(1, ...days.map((d) => d.contributionCount));
  const level = (n) => (n === 0 ? 0 : Math.min(4, 1 + Math.floor((n / max) * 4 * 0.999 + (n >= max / 8 ? 0.5 : 0))));
  let cells = "", labels = "";
  let lastMonth = -1;
  weeks.forEach((w, wi) => {
    const m = +w[0].date.slice(5, 7) - 1;
    if (m !== lastMonth && w[0].date.slice(8) <= "07" && wi < weeks.length - 1) {
      labels += `<text x="${gx + wi * step}" y="${gy - 10}" font-size="11" class="muted">${MONTHS[m]}</text>`;
      lastMonth = m;
    }
    for (const d of w) {
      const lv = level(d.contributionCount);
      const delay = (0.9 + wi * 0.035 + d.weekday * 0.01).toFixed(3);
      cells += `<rect x="${gx + wi * step}" y="${gy + d.weekday * step}" width="${cell}" height="${cell}" rx="2" fill="${LEVEL[lv]}"${lv ? ` class="pop" style="animation-delay:${delay}s"` : ""}><title>${d.contributionCount} on ${d.date}</title></rect>`;
    }
  });
  for (const [i, name] of [[1, "Mon"], [3, "Wed"], [5, "Fri"]])
    labels += `<text x="${gx - 10}" y="${gy + i * step + 9}" font-size="10" text-anchor="end" class="muted">${name}</text>`;
  const endY = gy + 7 * step + 22;
  const doneAt = (0.9 + weeks.length * 0.035 + 0.3).toFixed(2);
  let legend = `<text x="${W - 168}" y="${endY}" font-size="11" class="muted fade" style="animation-delay:${doneAt}s">Less</text>`;
  LEVEL.forEach((c, i) => { legend += `<rect x="${W - 134 + i * 15}" y="${endY - 10}" width="11" height="11" rx="2" fill="${c}" class="fade" style="animation-delay:${doneAt}s"/>`; });
  legend += `<text x="${W - 56}" y="${endY}" font-size="11" class="muted fade" style="animation-delay:${doneAt}s">More</text>`;
  const body = `${prompt(24, 60, "./contributions.sh")}
${labels}
${cells}
<text x="${gx}" y="${endY}" font-size="12" class="fade" style="animation-delay:${doneAt}s"><tspan class="green" font-weight="700">${fmt(cal.totalContributions)}</tspan> contributions in the last year</text>
${legend}`;
  writeFileSync(join(ROOT, "assets/contributions.svg"), frame(endY + 22, `${LOGIN} — contributions.sh`, body));
}

// ---- card 2: whoami (portrait + stats + monthly bars + languages) -------
{
  // pixel portrait: one hex digit per cell (0 dark .. f light), drawn row by row
  const rows = readFileSync(join(ROOT, "assets/portrait.txt"), "utf8").replace(/\r/g, "").split("\n").filter(Boolean);
  const N = rows.length, size = 320, cellPx = size / N, px = 28, py = 74;
  const stops = ["#0d1117", "#0e4429", "#006d32", "#26a641", "#39d353", "#aff5b4"];
  const mix = (a, b, t) => "#" + [1, 3, 5].map((i) => Math.round(parseInt(a.slice(i, i + 2), 16) * (1 - t) + parseInt(b.slice(i, i + 2), 16) * t).toString(16).padStart(2, "0")).join("");
  const shade = (v) => { const t = (v / 15) * (stops.length - 1), i = Math.min(stops.length - 2, Math.floor(t)); return mix(stops[i], stops[i + 1], t - i); };
  let pixCss = `.px rect { width: .86px; height: .86px; }`;
  for (let v = 1; v < 16; v++) pixCss += ` .p${v.toString(16)} { fill: ${shade(v)}; }`;
  const portraitCss = pixCss + ` .row { opacity: 0; animation: row .45s ease-out forwards; transform-box: fill-box; transform-origin: center; }
  @keyframes row { from { opacity: 0; transform: scaleX(.2); } to { opacity: 1; transform: none; } }`;
  let art = `<rect x="${px}" y="${py}" width="${size}" height="${size}" rx="6" fill="${C.bg}" stroke="${C.line}"/>
<g class="px" transform="translate(${px} ${py}) scale(${cellPx})">`;
  rows.forEach((line, y) => {
    let cells = "";
    for (let x = 0; x < line.length; x++) if (line[x] !== "0") cells += `<rect x="${x}" y="${y}" class="p${line[x]}"/>`;
    art += `<g class="row" style="animation-delay:${(0.8 + y * 0.025).toFixed(3)}s">${cells}</g>`;
  });
  art += `</g>`;
  const artBottom = py + size;

  const stats = [
    ["contributions", fmt(cal.totalContributions), "last 12 months"],
    ["current streak", `${current}`, current === 1 ? "day" : "days"],
    ["longest streak", `${longest}`, "days in a row"],
    ["best day", `${best.contributionCount}`, shortDate(best.date)],
    ["active days", `${active}`, `of ${days.length}`],
    ["per active day", perActive.toFixed(1), "contributions"],
  ];
  const sx = 380, sy = 56, cw = 214, ch = 62, g = 12;
  let cards = "";
  stats.forEach(([label, value, sub], i) => {
    const x = sx + (i % 2) * (cw + g), y = sy + Math.floor(i / 2) * (ch + g);
    const d = (1.2 + i * 0.12).toFixed(2);
    cards += `<g class="fade" style="animation-delay:${d}s">
  <rect x="${x}" y="${y}" width="${cw}" height="${ch}" rx="6" fill="${C.bar}" stroke="${C.line}"/>
  <text x="${x + 14}" y="${y + 20}" font-size="10.5" class="muted">› ${esc(label)}</text>
  <text x="${x + 14}" y="${y + 47}" font-size="22" font-weight="700" class="green">${esc(value)}</text>
  <text x="${x + 14 + value.length * 13.6 + 8}" y="${y + 47}" font-size="11" class="muted">${esc(sub)}</text>
</g>`;
  });

  // monthly bars
  const by = sy + 3 * (ch + g) + 10, bh = 92, bw = 26, bgap = (2 * cw + g - 12 * bw) / 11;
  const mmax = Math.max(1, ...months.map(([, v]) => v));
  let bars = `<text x="${sx}" y="${by + 4}" font-size="10.5" class="muted fade" style="animation-delay:1.9s">› contributions per month</text>`;
  months.forEach(([k, v], i) => {
    const h = Math.max(v ? 3 : 1, (v / mmax) * bh);
    const x = sx + i * (bw + bgap), base = by + 18 + bh;
    bars += `<rect x="${x}" y="${base - h}" width="${bw}" height="${h}" rx="2" fill="${v ? C.green : C.line}" class="grow" style="animation-delay:${(2 + i * 0.06).toFixed(2)}s"><title>${v} in ${MONTHS[+k.slice(5) - 1]} ${k.slice(0, 4)}</title></rect>`;
    bars += `<text x="${x + bw / 2}" y="${base + 14}" font-size="9.5" text-anchor="middle" class="dim">${MONTHS[+k.slice(5) - 1].slice(0, 1)}</text>`;
  });
  const barsBottom = by + 18 + bh + 14;

  // language strip
  const ly = Math.max(artBottom, barsBottom) + 30;
  let lang = `<text x="28" y="${ly}" font-size="10.5" class="muted fade" style="animation-delay:2.6s">› public code by language</text>`;
  let lx = 28; const lwTotal = W - 56;
  langList.forEach(([name, v], i) => {
    const w = (v.size / langTotal) * lwTotal;
    lang += `<rect x="${lx}" y="${ly + 10}" width="${Math.max(2, w - 2)}" height="8" rx="2" fill="${v.color || C.green}" class="fade" style="animation-delay:${(2.7 + i * 0.1).toFixed(2)}s"/>`;
    lx += w;
  });
  let tx = 28;
  langList.forEach(([name, v], i) => {
    const label = `${name} ${((v.size / langTotal) * 100).toFixed(0)}%`;
    lang += `<g class="fade" style="animation-delay:${(2.8 + i * 0.1).toFixed(2)}s"><circle cx="${tx + 4}" cy="${ly + 36}" r="4" fill="${v.color || C.green}"/><text x="${tx + 14}" y="${ly + 40}" font-size="11.5">${esc(label)}</text></g>`;
    tx += 14 + label.length * 7 + 26;
  });
  const footY = ly + 74;
  const foot = `<g class="fade" style="animation-delay:3.2s">${prompt(24, footY, "", 0).replace(/<clipPath[\s\S]*?<\/clipPath>\n/, "").replace(/<text[^>]*clip-path[\s\S]*?<\/text>/, "")}<rect x="${24 + (HANDLE.length + 12) * 7.83}" y="${footY - 12}" width="8" height="15" fill="${C.text}" class="cursor"/></g>`;

  const body = `${prompt(24, 56, "whoami")}
${art}
${cards}
${bars}
${lang}
${foot}`;
  writeFileSync(join(ROOT, "assets/whoami.svg"), frame(footY + 24, `${LOGIN} — whoami`, body, portraitCss));
}

// ---- card 3: achievements (earned from the same data, with tiers) -------
{
  const years = (Date.now() - new Date(user.createdAt)) / (365.25 * 864e5);
  const tiered = (value, tiers) => {
    let t = 0; while (t < tiers.length && value >= tiers[t]) t++;
    return { tier: t, next: tiers[Math.min(t, tiers.length - 1)], max: t === tiers.length };
  };
  const list = [
    ["⚡", "Contributor", "contributions in a year", cal.totalContributions, [100, 500, 1000, 2500]],
    ["🔥", "On Fire", "longest daily streak", longest, [3, 7, 14, 30]],
    ["📅", "Regular", "active days in a year", active, [10, 30, 100, 200]],
    ["🚀", "Big Day", "contributions in one day", best.contributionCount, [10, 25, 50, 100]],
    ["📦", "Shipper", "public repositories", user.repositories.totalCount, [1, 3, 10, 25]],
    ["🧬", "Polyglot", "languages in public code", langs.size, [2, 3, 5, 8]],
  ].map(([icon, name, what, value, tiers]) => ({ icon, name, what, value, ...tiered(value, tiers), tiers }));
  const TIER = ["locked", "bronze", "silver", "gold", "diamond"];
  const TIERC = ["#484f58", "#c0855a", "#b7c3cf", "#e3b341", "#79c0ff"];

  const cw = 252, ch = 88, g = 12, x0 = 24, y0 = 88;
  let cards = "";
  list.forEach((a, i) => {
    const x = x0 + (i % 3) * (cw + g), y = y0 + Math.floor(i / 3) * (ch + g);
    const d = (1.1 + i * 0.15).toFixed(2);
    const on = a.tier > 0, col = TIERC[a.tier];
    const prev = a.tier ? a.tiers[a.tier - 1] : 0;
    const prog = a.max ? 1 : Math.min(1, (a.value - prev) / (a.next - prev));
    cards += `<g class="fade" style="animation-delay:${d}s">
  <rect x="${x}" y="${y}" width="${cw}" height="${ch}" rx="8" fill="${C.bar}" stroke="${on ? col : C.line}" stroke-opacity="${on ? 0.7 : 1}"/>
  <circle cx="${x + 34}" cy="${y + 36}" r="20" fill="${C.bg}" stroke="${col}" stroke-width="2"/>
  <text x="${x + 34}" y="${y + 43}" font-size="19" text-anchor="middle"${on ? "" : ' opacity=".35"'}>${a.icon}</text>
  <text x="${x + 64}" y="${y + 28}" font-size="13.5" font-weight="700"${on ? "" : ' class="muted"'}>${esc(a.name)}</text>
  <text x="${x + 64}" y="${y + 46}" font-size="10.5" class="muted">${esc(fmt(a.value))} ${esc(a.what)}</text>
  <text x="${x + cw - 14}" y="${y + 28}" font-size="9.5" text-anchor="end" fill="${col}" letter-spacing="1">${TIER[a.tier].toUpperCase()}</text>
  <rect x="${x + 14}" y="${y + 66}" width="${cw - 28}" height="6" rx="3" fill="${C.bg}"/>
  <rect x="${x + 14}" y="${y + 66}" width="${Math.max(6, (cw - 28) * prog)}" height="6" rx="3" fill="${on ? col : C.dim}" class="grow-x" style="animation-delay:${(+d + 0.3).toFixed(2)}s"/>
  <text x="${x + cw - 14}" y="${y + 60}" font-size="9" text-anchor="end" class="dim">${a.max ? "max tier" : `next: ${fmt(a.next)}`}</text>
</g>`;
  });
  const unlocked = list.filter((a) => a.tier > 0).length;
  const endY = y0 + 2 * (ch + g) + 18;
  const body = `${prompt(24, 60, "./achievements.sh --all")}
${cards}
<text x="24" y="${endY}" font-size="12" class="fade" style="animation-delay:2.2s"><tspan class="green" font-weight="700">${unlocked}/${list.length}</tspan> unlocked · member for ${years.toFixed(1)} years · updated daily from the GitHub API</text>`;
  const css = `.grow-x { transform: scaleX(0); animation: growx .8s cubic-bezier(.2,.8,.2,1) forwards; transform-box: fill-box; transform-origin: left; }
  @keyframes growx { to { transform: scaleX(1); } }`;
  writeFileSync(join(ROOT, "assets/achievements.svg"), frame(endY + 24, `${LOGIN} — achievements.sh`, body, css));
}

console.log(`ok:${fmt(cal.totalContributions)} contributions, streak ${current}/${longest}, best ${best.contributionCount} on ${best.date}, ${active} active days`);
