import type { ScoringDimension, ScoredResource, PlanningWorkspace, UserModel } from "./types";

interface ArtifactPageOpts {
  dimensions: ScoringDimension[];
  scoredResources: ScoredResource[];
  menteeModel: UserModel;
  workspace: PlanningWorkspace;
}

function parseSourceRefs(source: string): { prefix: string; id: string }[] {
  const matches = source.matchAll(/\[(MV|MB|MG|MP|TV|TB|TG|TP)\d+\]/g);
  return Array.from(matches).map((m) => ({
    prefix: m[1],
    id: m[0].slice(1, -1),
  }));
}

function provenanceLabel(prefix: string): { label: string; color: string } {
  switch (prefix) {
    case "MV": return { label: "values", color: "#9B80E6" };
    case "MB": return { label: "beliefs", color: "#009E73" };
    case "MG": return { label: "goals", color: "#D55E00" };
    case "MP": return { label: "relationships", color: "#CC79A7" };
    default: return { label: "model", color: "#7a7a99" };
  }
}

function stripModelIds(text: string): string {
  return text
    .replace(/\s*\[(?:MV|MB|MG|MP|TV|TB|TG|TP)\d+\]\s*/g, " ")
    .replace(/^(Excellent|Near-ideal|Top|Strong|Good|Great|Perfect|Solid|Exceptional)\s+(fit|match)\s*[—–-]\s*/i, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function extractPeople(model: UserModel): { name: string; relationship?: string; claims: string[] }[] {
  const people = model.people;
  if (!Array.isArray(people)) return [];
  return people.map((p: Record<string, unknown>) => {
    const name = String(p.name || "");
    const relationship = p.relationship ? String(p.relationship) : undefined;
    const situation = Array.isArray(p.situation)
      ? p.situation.map((s: Record<string, unknown>) => String(s.claim || "")).filter(Boolean)
      : [];
    return { name, relationship, claims: situation.slice(0, 3) };
  }).filter((p) => p.name);
}

function extractValues(model: UserModel): { value: string; evidence?: string }[] {
  const values = model.values;
  if (!Array.isArray(values)) return [];
  return values.slice(0, 5).map((v: Record<string, unknown>) => ({
    value: String(v.value || ""),
    evidence: Array.isArray(v.evidence) && v.evidence.length > 0 ? String(v.evidence[0]) : undefined,
  })).filter((v) => v.value);
}

export function generateArtifactPage(opts: ArtifactPageOpts): string {
  const { dimensions, scoredResources, menteeModel, workspace } = opts;

  const people = extractPeople(menteeModel);
  const values = extractValues(menteeModel);

  const dimensionProvenance = dimensions.map((d) => {
    const refs = parseSourceRefs(d.source || "");
    const prefixes = [...new Set(refs.map((r) => r.prefix))];
    const tags = prefixes.map((p) => provenanceLabel(p));
    return { ...d, tags };
  });

  // Deduplicate by normalized title (case-insensitive, ignoring trailing parentheticals)
  const seenTitles = new Set<string>();
  const dedupedResources = scoredResources.filter((r) => {
    const key = r.title.toLowerCase().replace(/\s*\(.*?\)\s*$/, "").trim();
    if (seenTitles.has(key)) return false;
    seenTitles.add(key);
    return true;
  });

  const resourcesJson = JSON.stringify(dedupedResources.map((r) => ({
    title: r.title,
    url: r.url,
    description: r.description,
    cost: r.cost,
    domains: r.domains,
    scores: r.scores,
    oneLiner: stripModelIds(r.oneLiner),
  })));

  const dimensionsJson = JSON.stringify(dimensions.map((d) => ({
    id: d.id,
    label: d.label,
    definition: d.definition,
    required: d.required,
  })));

  // Build sidebar HTML — dimensions with provenance
  const dimensionsHtml = dimensionProvenance.map((d) => {
    const tagHtml = d.tags.map((t) =>
      `<span class="prov-tag" style="background:${t.color}15;color:${t.color};border:1px solid ${t.color}30">${escapeHtml(t.label)}</span>`
    ).join(" ");
    return `<div class="sidebar-dim">
      <div class="sidebar-dim-label">${escapeHtml(d.label)}${d.required ? '<span class="req-tag">req</span>' : ""} ${tagHtml}</div>
      <div class="sidebar-dim-def">${escapeHtml(d.definition)}</div>
    </div>`;
  }).join("\n");

  const valuesHtml = values.length > 0 ? values.map((v) =>
    `<div class="sidebar-value">
      <span class="sidebar-value-name">${escapeHtml(v.value)}</span>
      ${v.evidence ? `<div class="sidebar-value-ev">"${escapeHtml(v.evidence)}"</div>` : ""}
    </div>`
  ).join("\n") : "";

  const peopleHtml = people.length > 0 ? people.map((p) => {
    const claimsHtml = p.claims.map((c) =>
      `<div class="sidebar-person-claim">${escapeHtml(c)}</div>`
    ).join("\n");
    return `<div class="sidebar-person">
      <div class="sidebar-person-name">${escapeHtml(p.name)}${p.relationship ? ` <span class="sidebar-person-rel">${escapeHtml(p.relationship)}</span>` : ""}</div>
      ${claimsHtml}
    </div>`;
  }).join("\n") : "";

  const goalText = workspace.goal || "Career Options";

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(goalText)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Libre+Baskerville:ital,wght@0,400;0,700;1,400&family=Source+Sans+3:wght@300;400;500;600;700&display=swap" rel="stylesheet">
<style>
  :root {
    --cream: #FAF6F0;
    --parchment: #F3EDE4;
    --sand: #E8DFCF;
    --ink: #1a1a2e;
    --ink-light: #3d3d5c;
    --ink-muted: #7a7a99;
    --teal: #4a8f8f;
    --teal-light: #6fb3b3;
    --teal-bg: rgba(74,143,143,0.08);
    --amber: #c87941;
    --amber-light: #e8a96a;
    --white: #ffffff;
    --font-heading: 'Libre Baskerville', serif;
    --font-body: 'Source Sans 3', sans-serif;
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    background: var(--cream);
    color: var(--ink);
    font-family: var(--font-body);
    line-height: 1.6;
    -webkit-font-smoothing: antialiased;
    font-size: 15px;
  }

  /* === Sticky pills bar === */
  .pills-bar {
    position: sticky;
    top: 0;
    z-index: 100;
    background: rgba(255,255,255,0.92);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    border-bottom: 1px solid var(--sand);
    padding: 12px 28px;
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
  }
  .pill {
    padding: 6px 16px;
    border-radius: 20px;
    font-size: 13px;
    cursor: pointer;
    font-family: var(--font-body);
    transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
    letter-spacing: 0.15px;
    border: 1.5px solid var(--sand);
    background: transparent;
    color: var(--ink-muted);
    font-weight: 400;
  }
  .pill:hover {
    border-color: var(--teal-light);
    color: var(--teal);
  }
  .pill.prioritized {
    border: 2px solid var(--teal);
    background: var(--teal);
    color: var(--white);
    font-weight: 700;
    box-shadow: 0 1px 4px rgba(74,143,143,0.25);
  }
  .pill.off {
    border: 1.5px dashed var(--sand);
    color: var(--ink-muted);
    text-decoration: line-through;
    opacity: 0.45;
  }
  .pills-summary {
    font-size: 12px;
    color: var(--ink-muted);
    margin-left: auto;
    font-variant-numeric: tabular-nums;
  }

  /* === Two-column layout === */
  .layout {
    display: grid;
    grid-template-columns: 300px 1fr;
    gap: 0;
    max-width: 1200px;
    margin: 0 auto;
    min-height: calc(100vh - 50px);
  }
  @media (max-width: 800px) {
    .layout { grid-template-columns: 1fr; }
    .sidebar { border-right: none; border-bottom: 1px solid var(--sand); }
  }

  /* === Left sidebar === */
  .sidebar {
    border-right: 1px solid var(--sand);
    padding: 28px 24px;
    background: var(--cream);
    position: sticky;
    top: 52px;
    height: calc(100vh - 52px);
    overflow-y: auto;
    scrollbar-width: thin;
    scrollbar-color: var(--sand) transparent;
  }
  .sidebar::-webkit-scrollbar { width: 4px; }
  .sidebar::-webkit-scrollbar-thumb { background: var(--sand); border-radius: 2px; }
  @media (max-width: 800px) {
    .sidebar { position: static; height: auto; }
  }
  .sidebar-section {
    margin-bottom: 28px;
  }
  .sidebar-section:last-child { margin-bottom: 0; }
  .sidebar-heading {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 2px;
    color: var(--ink-muted);
    margin-bottom: 14px;
    font-weight: 600;
    opacity: 0.7;
  }

  /* People — card style */
  .sidebar-person {
    margin-bottom: 12px;
    padding: 14px 16px;
    background: var(--white);
    border: 1px solid var(--sand);
    border-radius: 10px;
    box-shadow: 0 1px 3px rgba(0,0,0,0.03);
  }
  .sidebar-person-name {
    font-size: 17px;
    font-weight: 700;
    font-family: var(--font-heading);
    color: var(--ink);
  }
  .sidebar-person-rel {
    font-weight: 400;
    font-family: var(--font-body);
    color: var(--ink-muted);
    font-size: 13px;
    margin-left: 4px;
  }
  .sidebar-person-claim {
    font-size: 13px;
    color: var(--ink-light);
    margin-top: 5px;
    padding-left: 12px;
    border-left: 2px solid var(--sand);
    line-height: 1.55;
  }

  /* Values — purple text with italic evidence quotes */
  .sidebar-value {
    margin-bottom: 14px;
    padding-bottom: 14px;
    border-bottom: 1px solid rgba(0,0,0,0.04);
  }
  .sidebar-value:last-child { border-bottom: none; margin-bottom: 0; padding-bottom: 0; }
  .sidebar-value-name {
    font-size: 14px;
    font-weight: 500;
    color: #9B80E6;
    line-height: 1.45;
  }
  .sidebar-value-ev {
    font-size: 12px;
    color: var(--ink-muted);
    font-style: italic;
    line-height: 1.5;
    margin-top: 3px;
    padding-left: 2px;
    opacity: 0.75;
  }

  /* === Results column === */
  .results {
    padding: 0;
    background: var(--cream);
  }

  /* === Uniform resource rows === */
  .resource-row {
    padding: 14px 32px;
    border-bottom: 1px solid var(--sand);
    background: var(--white);
    border-left: 3px solid transparent;
    transition: background 0.15s ease, border-color 0.15s ease;
  }
  .resource-row:first-child { margin-top: 12px; }
  .resource-row:last-child { margin-bottom: 32px; }
  .resource-row:hover {
    background: #FDFCFA;
  }
  .resource-row.top-pick {
    border-left-color: var(--teal);
  }
  .row-header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 10px;
    margin-bottom: 5px;
    flex-wrap: wrap;
  }
  .row-rank {
    font-size: 14px;
    font-weight: 700;
    color: var(--ink-muted);
    font-variant-numeric: tabular-nums;
    min-width: 22px;
    opacity: 0.5;
  }
  .row-title {
    font-family: var(--font-heading);
    font-size: 15px;
    font-weight: 700;
    color: var(--ink);
    text-decoration: none;
    transition: color 0.15s ease;
  }
  .row-title:hover { color: var(--teal); }
  .domain-badge {
    font-size: 10px;
    padding: 3px 9px;
    border-radius: 10px;
    background: var(--parchment);
    color: var(--ink-muted);
    font-weight: 500;
    letter-spacing: 0.2px;
  }
  .row-oneliner {
    font-size: 13px;
    color: var(--ink-light);
    margin-bottom: 5px;
    margin-left: 28px;
    line-height: 1.5;
  }
  .fit-bullet {
    font-size: 12px;
    color: var(--teal);
    line-height: 1.6;
    display: flex;
    gap: 7px;
    margin-left: 28px;
  }
  .fit-bullet .plus { flex-shrink: 0; font-weight: 700; opacity: 0.7; }
  .tension-note {
    font-size: 12px;
    color: var(--amber);
    margin-top: 4px;
    margin-left: 28px;
    padding-left: 12px;
    border-left: 2px solid var(--amber-light);
    font-style: italic;
    line-height: 1.55;
  }
  .expand-trigger {
    font-size: 12px;
    color: var(--teal);
    cursor: pointer;
    background: none;
    border: none;
    font-family: var(--font-body);
    padding: 4px 0;
    margin-top: 6px;
    margin-left: 28px;
    font-weight: 500;
    opacity: 0.7;
    transition: opacity 0.15s ease;
  }
  .expand-trigger:hover { opacity: 1; }
  .expand-detail {
    display: none;
    margin: 10px 0 0 28px;
    padding-top: 10px;
    border-top: 1px solid var(--sand);
  }
  .expand-detail.open { display: block; }
  .score-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 4px 0;
    font-size: 12px;
  }
  .score-label { width: 130px; flex-shrink: 0; color: var(--ink-muted); font-weight: 500; }
  .score-bar-bg {
    width: 90px;
    flex-shrink: 0;
    height: 5px;
    background: var(--sand);
    border-radius: 3px;
    overflow: hidden;
  }
  .score-bar-fill {
    height: 100%;
    border-radius: 3px;
    transition: width 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  }
  .score-signal { font-size: 11px; color: var(--ink-muted); opacity: 0.8; }

  /* === Section divider === */
  .section-divider {
    padding: 10px 32px;
    font-size: 11px;
    color: var(--ink-muted);
    background: var(--parchment);
    border-bottom: 1px solid var(--sand);
    font-weight: 600;
    letter-spacing: 0.5px;
    text-transform: uppercase;
    font-size: 10px;
    letter-spacing: 1.5px;
  }

  /* === Dealbreakers === */
  .dealbreakers-toggle {
    display: block;
    width: 100%;
    text-align: left;
    font-size: 12px;
    color: var(--ink-muted);
    cursor: pointer;
    background: var(--parchment);
    border: none;
    border-bottom: 1px solid var(--sand);
    font-family: var(--font-body);
    font-style: italic;
    padding: 10px 32px;
    transition: color 0.15s ease;
  }
  .dealbreakers-toggle:hover { color: var(--ink-light); }
  .dealbreakers-list {
    display: none;
    background: var(--parchment);
    padding: 4px 32px 12px;
  }
  .dealbreakers-list.open { display: block; }
  .dealbreaker-row {
    padding: 5px 0;
    font-size: 12px;
    color: var(--ink-muted);
  }
  .dealbreaker-name { font-weight: 600; }
  .dealbreaker-reason { color: var(--amber); }
</style>
</head>
<body>

<!-- Sticky pills bar -->
<div class="pills-bar" id="pills-bar">
  ${dimensionProvenance.map((d) =>
    `<button class="pill" data-id="${escapeHtml(d.id)}" onclick="cyclePill('${escapeHtml(d.id)}')" title="${escapeHtml(d.definition)} — Click to prioritize · click again to exclude">${escapeHtml(d.label)}</button>`
  ).join("\n  ")}
  <span class="pills-summary" id="pills-summary"></span>
</div>

<!-- Two-column layout -->
<div class="layout">

  <!-- Left sidebar: dimensions + values + people -->
  <div class="sidebar">
    ${peopleHtml ? `
    <div class="sidebar-section">
      <div class="sidebar-heading">People</div>
      ${peopleHtml}
    </div>` : ""}
    ${valuesHtml ? `
    <div class="sidebar-section">
      <div class="sidebar-heading">Key Values</div>
      ${valuesHtml}
    </div>` : ""}
  </div>

  <!-- Right: results rows -->
  <div class="results" id="results"></div>

</div>

<script>
const RESOURCES = ${resourcesJson};
const DIMENSIONS = ${dimensionsJson};
const pillStates = {};
DIMENSIONS.forEach(d => pillStates[d.id] = "normal");

function cyclePill(id) {
  const current = pillStates[id] || "normal";
  pillStates[id] = current === "normal" ? "prioritized" : current === "prioritized" ? "off" : "normal";
  updatePillUI();
  renderResults();
}

function updatePillUI() {
  document.querySelectorAll('.pill').forEach(btn => {
    const id = btn.dataset.id;
    const state = pillStates[id];
    btn.className = 'pill';
    if (state === 'prioritized') btn.classList.add('prioritized');
    else if (state === 'off') btn.classList.add('off');
  });
}

function stripIds(text) {
  return text
    .replace(/\\s*\\[(?:MV|MB|MG|MP|TV|TB|TG|TP)\\d+\\]\\s*/g, " ")
    .replace(/^(Excellent|Near-ideal|Top|Strong|Good|Great|Perfect|Solid|Exceptional)\\s+(fit|match)\\s*[—–-]\\s*/i, "")
    .replace(/\\s{2,}/g, " ")
    .trim();
}

function computeScore(resource) {
  const activeIds = Object.keys(pillStates).filter(id => pillStates[id] !== 'off');
  if (activeIds.length === 0) return { score: 0, failedRequired: [] };
  const requiredIds = DIMENSIONS.filter(d => d.required && pillStates[d.id] !== 'off').map(d => d.id);
  const failedRequired = requiredIds.filter(id => (resource.scores[id]?.score || 0) < 0.3);
  let weightedSum = 0, totalWeight = 0;
  for (const id of activeIds) {
    const weight = pillStates[id] === 'prioritized' ? 2 : 1;
    weightedSum += (resource.scores[id]?.score || 0) * weight;
    totalWeight += weight;
  }
  const avg = totalWeight > 0 ? weightedSum / totalWeight : 0;
  if (failedRequired.length > 0) return { score: Math.min(avg * 0.3, 0.25), failedRequired };
  return { score: avg, failedRequired: [] };
}

function buildFits(resource) {
  const activeIds = Object.keys(pillStates).filter(id => pillStates[id] !== 'off');
  return DIMENSIONS
    .filter(d => activeIds.includes(d.id) && (resource.scores[d.id]?.score || 0) >= 0.7)
    .sort((a, b) => (resource.scores[b.id]?.score || 0) - (resource.scores[a.id]?.score || 0))
    .slice(0, 3)
    .map(d => stripIds(resource.scores[d.id]?.signal || d.label));
}

function buildTensions(resource) {
  const activeIds = Object.keys(pillStates).filter(id => pillStates[id] !== 'off');
  return DIMENSIONS
    .filter(d => {
      if (!activeIds.includes(d.id)) return false;
      const s = resource.scores[d.id]?.score || 0;
      return s >= 0.2 && s < 0.5;
    })
    .slice(0, 2)
    .map(d => stripIds(resource.scores[d.id]?.signal || d.label));
}

function scoreBarColor(score) {
  if (score >= 0.7) return 'var(--teal)';
  if (score >= 0.5) return 'var(--amber-light)';
  if (score >= 0.3) return 'var(--amber)';
  return '#ccc';
}

function escapeH(text) {
  const d = document.createElement('div');
  d.textContent = text;
  return d.innerHTML;
}

function renderRow(resource, rank, isTopPick) {
  const fits = buildFits(resource);
  const tensions = buildTensions(resource);
  const activeIds = Object.keys(pillStates).filter(id => pillStates[id] !== 'off');

  const fitsHtml = (fits.length > 0 ? fits : [resource.oneLiner]).map(f =>
    '<div class="fit-bullet"><span class="plus">+</span><span>' + escapeH(f) + '</span></div>'
  ).join('');

  const tensionHtml = tensions.length > 0
    ? '<div class="tension-note">' + escapeH(tensions.join('. ')) + '</div>'
    : '';

  const domainsHtml = resource.domains.map(d =>
    '<span class="domain-badge">' + escapeH(d) + '</span>'
  ).join(' ');

  const detailRows = DIMENSIONS.filter(d => activeIds.includes(d.id)).map(d => {
    const s = resource.scores[d.id];
    const score = s?.score || 0;
    const signal = s ? stripIds(s.signal) : '';
    return '<div class="score-row">' +
      '<span class="score-label">' + escapeH(d.label) + '</span>' +
      '<div class="score-bar-bg"><div class="score-bar-fill" style="width:' + (score * 100) + '%;background:' + scoreBarColor(score) + '"></div></div>' +
      '<span class="score-signal">' + escapeH(signal) + '</span>' +
    '</div>';
  }).join('');

  return '<div class="resource-row' + (isTopPick ? ' top-pick' : '') + '">' +
    '<div class="row-header">' +
      '<div style="display:flex;align-items:baseline;gap:8px">' +
        '<span class="row-rank">' + rank + '.</span>' +
        '<a href="' + escapeH(resource.url) + '" target="_blank" class="row-title">' + escapeH(resource.title) + '</a>' +
      '</div>' +
      '<div style="display:flex;gap:4px;flex-shrink:0">' + domainsHtml + '</div>' +
    '</div>' +
    '<div class="row-oneliner">' + escapeH(resource.oneLiner) + '</div>' +
    fitsHtml +
    tensionHtml +
    '<button class="expand-trigger" onclick="toggleDetail(this)">See all scores ▸</button>' +
    '<div class="expand-detail">' + detailRows + '</div>' +
  '</div>';
}

function toggleDetail(btn) {
  if (!btn) return;
  const detail = btn.nextElementSibling;
  if (!detail) return;
  const isOpen = detail.classList.contains('open');
  document.querySelectorAll('.expand-detail.open').forEach(el => {
    el.classList.remove('open');
    if (el.previousElementSibling) el.previousElementSibling.textContent = 'See all scores ▸';
  });
  if (!isOpen) {
    detail.classList.add('open');
    btn.textContent = 'Hide scores ▾';
  }
}

function renderResults() {
  const scored = RESOURCES.map(r => {
    const { score, failedRequired } = computeScore(r);
    return { resource: r, score, failedRequired };
  });
  scored.sort((a, b) => b.score - a.score);

  const topPicks = scored.filter(s => s.failedRequired.length === 0);
  const dealbreakers = scored.filter(s => s.failedRequired.length > 0);
  const topCount = Math.min(topPicks.length, 4);

  let html = '';

  // Top picks (first 4 rows, teal left border)
  topPicks.slice(0, topCount).forEach((s, i) => {
    html += renderRow(s.resource, i + 1, true);
  });

  // More results
  if (topPicks.length > topCount) {
    html += '<div class="section-divider">More options</div>';
    topPicks.slice(topCount).forEach((s, i) => {
      html += renderRow(s.resource, topCount + i + 1, false);
    });
  }

  // Dealbreakers
  if (dealbreakers.length > 0) {
    html += '<button class="dealbreakers-toggle" onclick="toggleDealbreakers()">' +
      dealbreakers.length + ' didn\\u2019t meet requirements ▸</button>';
    html += '<div class="dealbreakers-list" id="dealbreakers-list">';
    dealbreakers.forEach(({ resource, failedRequired }) => {
      const reasons = failedRequired.map(id => {
        const dim = DIMENSIONS.find(d => d.id === id);
        const signal = resource.scores[id] ? stripIds(resource.scores[id].signal) : '';
        return signal ? signal + ' (' + (dim?.label || id) + ')' : (dim?.label || id);
      });
      html += '<div class="dealbreaker-row">' +
        '<span class="dealbreaker-name">' + escapeH(resource.title) + '</span>' +
        '<span class="dealbreaker-reason"> \\u2014 ' + escapeH(reasons.join(', ')) + '</span>' +
      '</div>';
    });
    html += '</div>';
  }

  // Summary in pills bar
  const total = RESOURCES.length;
  const showing = topPicks.length;
  const dbCount = dealbreakers.length;
  document.getElementById('pills-summary').textContent =
    showing + ' of ' + total + (dbCount > 0 ? ' \\u2014 ' + dbCount + ' didn\\u2019t meet requirements' : '');

  document.getElementById('results').innerHTML = html;
}

function toggleDealbreakers() {
  const list = document.getElementById('dealbreakers-list');
  if (!list) return;
  const btn = list.previousElementSibling;
  const isOpen = list.classList.contains('open');
  list.classList.toggle('open');
  const count = list.children.length;
  btn.textContent = isOpen
    ? count + ' didn\\u2019t meet requirements ▸'
    : count + ' didn\\u2019t meet requirements ▾';
}

renderResults();
</script>
</body>
</html>`;
}
