/* Agent Nexus — demo application. Plain JS, hash-routed, state kept in memory (+ localStorage when available). */
(function () {
'use strict';

/* ---------- utilities ---------- */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clone = o => JSON.parse(JSON.stringify(o));
const fmt = n => Number(n).toLocaleString('en-AU');
const KEY = 'agent-nexus-demo-v2';

function hash(str) { // two FNV-1a passes → 16 hex chars; good enough to demo a hash chain
  let h1 = 0x811c9dc5, h2 = 0x01000193 ^ 0x5bd1e995;
  for (let i = 0; i < str.length; i++) { const c = str.charCodeAt(i); h1 ^= c; h1 = Math.imul(h1, 16777619); h2 ^= c + 7; h2 = Math.imul(h2, 16777619); }
  return ((h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0'));
}
function nowStamp() { const d = new Date(); return '2026-10-29 ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); }

function chainAudit(list) { // list newest-first; recompute hashes oldest→newest
  let prev = '0000000000000000';
  for (let i = list.length - 1; i >= 0; i--) { const e = list[i]; e.prev = prev; e.hash = hash(prev + '|' + e.ts + '|' + e.actor + '|' + e.type + '|' + e.text + '|' + (e.ref || '')); prev = e.hash; }
  return list;
}
function seedAudit() { return chainAudit(AUDIT_SEED.map(([ts, actor, type, text, ref]) => ({ ts, actor, type, text, ref }))); }

function fresh() { return { v: 2, connectors: clone(CONNECTORS), agents: clone(BASE_AGENTS), reviews: clone(REVIEWS), incidents: clone(INCIDENTS), audit: seedAudit(), seqR: 316, seqI: 2042 }; }
function load() { try { const v = localStorage.getItem(KEY); return v ? JSON.parse(v) : null; } catch (e) { return null; } }
function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { /* storage unavailable */ } }
let S = load() || fresh();

function audit(actor, type, text, ref) {
  const prev = S.audit.length ? S.audit[0].hash : '0000000000000000';
  const e = { ts: nowStamp(), actor, type, text, ref: ref || '' };
  e.prev = prev; e.hash = hash(prev + '|' + e.ts + '|' + e.actor + '|' + e.type + '|' + e.text + '|' + e.ref);
  S.audit.unshift(e); save();
}

const UI = { catTab: 'agents', catView: 'cards', catQ: '', catPlat: '', catBU: '', catRisk: '', catStatus: '', regTab: 'agents', owOnly: false, revFilter: 'Pending', revSel: null, auditType: 'All', auditQ: '', towerSort: 'trust', flash: [] };

/* ---------- icons ---------- */
const sv = p => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
const ICON = {
  tower: sv('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/><path d="M12 12 18.4 5.6"/>'),
  registry: sv('<ellipse cx="12" cy="5.5" rx="7.5" ry="2.8"/><path d="M4.5 5.5v6c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8v-6M4.5 11.5v6c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8v-6"/>'),
  catalog: sv('<circle cx="6" cy="6" r="2.5"/><circle cx="18" cy="6" r="2.5"/><circle cx="12" cy="18" r="2.5"/><path d="M7.4 8.1 10.8 15.8M16.6 8.1 13.2 15.8M8.5 6h7"/>'),
  reviews: sv('<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V3h6v1M9 12.5l2 2 4-4.5"/>'),
  incidents: sv('<path d="M12 3.5 2.8 20h18.4L12 3.5z"/><path d="M12 10v4.2M12 17.2v.3"/>'),
  audit: sv('<path d="M6 3h9l4 4v14H6z"/><path d="M15 3v4h4M9 12h7M9 16h7M9 8h3"/>'),
  scan: sv('<path d="M3 8V4h4M21 8V4h-4M3 16v4h4M21 16v4h-4M3 12h18"/>'),
  check: sv('<path d="m5 12.5 4.5 4.5L19 7.5"/>'),
  x: sv('<path d="M6 6l12 12M18 6 6 18"/>'),
  shield: sv('<path d="M12 3 5 6v5c0 4.5 3 8.3 7 10 4-1.7 7-5.5 7-10V6z"/><path d="m9 12 2 2 4-4"/>'),
  download: sv('<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>'),
  plus: sv('<path d="M12 5v14M5 12h14"/>'),
  fit: sv('<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>'),
  expand: sv('<circle cx="12" cy="12" r="3"/><path d="M12 3v4M12 17v4M3 12h4M17 12h4"/>'),
  reset: sv('<path d="M4 12a8 8 0 1 0 2.4-5.7L4 8.5M4 4v4.5h4.5"/>'),
  link: sv('<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>'),
};

/* ---------- lookups & scoring ---------- */
const agentById = id => S.agents.find(a => a.id === id);
const trust = a => Math.round(a.scores.gov * .25 + a.scores.sec * .25 + a.scores.data * .2 + a.scores.rel * .15 + a.scores.trans * .15);
const scoreTone = v => v >= 80 ? 'ok' : v >= 65 ? 'warn' : 'crit';
const toneVar = t => ({ ok: 'var(--ok)', warn: 'var(--warn)', crit: 'var(--crit)', info: 'var(--info)' }[t] || 'var(--muted)');
const STATUS = { 'Approved': 'ok', 'Approved with conditions': 'info', 'In review': 'warn', 'Sent back': 'warn', 'Shadow': 'crit', 'Suspended': 'crit', 'Rejected': 'crit', 'Pending': 'warn',
  'Open': 'crit', 'Contained': 'warn', 'Remediated': 'ok', 'Closed': 'ok', 'Done': 'ok', 'In progress': 'warn' };
const BAD = ['Unverified', 'No auth', 'Unapproved use', 'Unmasked', 'Suspended', 'Unregistered', 'Wildcard bucket access', 'Unclassified bucket'];
const MID = ['Restricted', 'Stale: 94 days', 'Draft', 'Unreviewed', 'Bias audit pending', 'Residency exception', 'Bias review', 'Third party', 'Community', 'External content', 'Untrusted input', 'Consent required', 'Unknown'];
const GOOD = ['Approved', 'Verified', 'Trusted', 'Clean', 'Lineage verified', 'Evaluated', 'Verified publisher', 'Weights hash verified', 'Zero data retention', 'Validated', 'Citations verified', 'Injection hardened', 'Model validated', 'Re-evaluated', 'Masked for AI', 'Tokenised', 'Redacted', 'System of record', 'Versioned', 'Weights hash matched to HF', 'Scanned for injection', 'Vendor attested', 'Contract on file', 'Consent tracked'];
const tagTone = t => BAD.includes(t) ? 'crit' : MID.includes(t) ? 'warn' : GOOD.includes(t) ? 'ok' : 'info';
const riskOf = tags => tags.some(t => BAD.includes(t)) ? 'crit' : tags.some(t => MID.includes(t)) ? 'warn' : '';

const chip = (t, tone) => `<span class="chip ${tone || tagTone(t)}">${esc(t)}</span>`;
const tagChips = tags => `<div class="chips">${(tags || []).map(t => chip(t)).join('')}</div>`;
const statusChip = s => `<span class="status"><span class="dot ${STATUS[s] || ''}"></span>${esc(s)}</span>`;
const riskChip = r => chip(r + ' risk', r === 'High' ? 'crit' : r === 'Medium' ? 'warn' : 'ok');
const sevChip = s => chip(s, s === 'Sev 1' ? 'crit' : s === 'Sev 2' ? 'warn' : 'info');
const pt = (p, size) => { const P = PLATFORMS[p] || { short: '?', hue: '#777', name: p }; return `<span class="pt ${size || ''}" style="background:${P.hue}" title="${esc(P.name)}">${esc(P.short)}</span>`; };
const scoreBar = v => `<span class="score"><span class="num">${v}</span><span class="bar"><i style="width:${v}%;background:${toneVar(scoreTone(v))}"></i></span></span>`;
function ring(v, size = 84, label = 'Trust') {
  const r = size / 2 - 7, c = 2 * Math.PI * r;
  return `<div class="ring" style="width:${size}px;height:${size}px"><svg width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="var(--surface-2)" stroke-width="8"/><circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${toneVar(scoreTone(v))}" stroke-width="8" stroke-linecap="round" stroke-dasharray="${c * v / 100} ${c}"/></svg><div class="v" style="font-size:${Math.round(size * .28)}px">${v}${label ? `<small>${label}</small>` : ''}</div></div>`;
}
const isOpenInc = i => i.status === 'Open' || i.status === 'Contained';
const usersOf = a => a.users.count;
const offshore = a => /us-|europe|asia-east/.test(a.region) || a.models.some(m => /us-/.test(MODELS[m].region));

function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => { t.hidden = true; }, 2800); }

/* ---------- nav ---------- */
const NAV = [['tower', 'Control tower'], ['registry', 'Agent registry'], ['catalog', 'AI catalog'], ['reviews', 'Reviews'], ['incidents', 'Incidents'], ['audit', 'Audit log']];
function renderNav(active) {
  const pend = S.reviews.filter(r => r.status === 'Pending').length;
  const open = S.incidents.filter(isOpenInc).length;
  $('#nav').innerHTML = `<div class="nav-label">Govern</div>` + NAV.map(([k, l]) => {
    const b = k === 'reviews' && pend ? `<span class="badge">${pend}</span>` : k === 'incidents' && open ? `<span class="badge">${open}</span>` : k === 'registry' ? `<span class="badge soft">${S.agents.length}</span>` : '';
    return `<a href="#${k}" class="${k === active ? 'on' : ''}">${ICON[k]}<span>${l}</span>${b}</a>`;
  }).join('');
}

/* ---------- router ---------- */
let cy = null;
function route() {
  if (cy) { try { cy.destroy(); } catch (e) {} cy = null; }
  const h = decodeURIComponent(location.hash.slice(1)) || 'tower';
  let nav = h, html;
  if (h.startsWith('agent-')) { nav = 'catalog'; html = viewAgent(h.slice(6)); }
  else if (h.startsWith('review-')) { nav = 'reviews'; UI.revSel = h.slice(7); html = viewReviews(); }
  else if (h.startsWith('incident-')) { nav = 'incidents'; html = viewIncident(h.slice(9)); }
  else if (h === 'registry') html = viewRegistry();
  else if (h === 'catalog') html = viewCatalog();
  else if (h === 'reviews') html = viewReviews();
  else if (h === 'incidents') html = viewIncidents();
  else if (h === 'audit') html = viewAudit();
  else { nav = 'tower'; html = viewTower(); }
  renderNav(nav);
  const v = $('#view'); v.innerHTML = html; v.scrollTop = 0;
  if (h.startsWith('agent-')) mountAgent(h.slice(6));
  UI.flash = [];
}
function rerender() { const st = $('#view').scrollTop; route(); $('#view').scrollTop = st; }
window.addEventListener('hashchange', route);
function go(h) { if (location.hash === '#' + h) route(); else location.hash = h; }

/* ======================================================================
   CONTROL TOWER
   ====================================================================== */
function viewTower() {
  const A = S.agents, governed = A.filter(a => a.status !== 'Shadow');
  const shadow = A.filter(a => a.status === 'Shadow').length + S.incidents.filter(i => isOpenInc(i) && /Shadow/.test(i.category) && !i.agent).length;
  const avg = Math.round(governed.reduce((s, a) => s + trust(a), 0) / Math.max(1, governed.length));
  const pend = S.reviews.filter(r => r.status === 'Pending').length;
  const openInc = S.incidents.filter(isOpenInc);
  const plats = new Set(A.map(a => a.platform)).size;
  const users = A.reduce((s, a) => s + usersOf(a), 0);
  const mcpN = mcpInUse().length, modelN = modelsInUse().length;
  const newConns = S.connectors.filter(c => c.status === 'new');

  const banner = newConns.length ? `<div class="banner"><div><b>${newConns.length} cloud landscape${newConns.length > 1 ? 's are' : ' is'} connected but not yet scanned</b><span class="small">${newConns.map(c => esc(c.label)).join(' and ')}. Scan to find agents, MCP servers and models running there.</span></div><button class="btn primary" data-act="scan" data-conn="${newConns[0].id}">${ICON.scan} Scan ${esc(newConns[0].label.split('·')[0].trim())}</button></div>` : '';

  const kpis = `<div class="grid g-kpi" style="margin-bottom:16px">
    <button class="kpi" data-go="registry"><span class="lbl">AI agents</span><span class="val">${A.length}</span><span class="sub">${plats} platforms · ${mcpN} MCP servers · ${modelN} models</span></button>
    <button class="kpi ${shadow ? 'alert' : ''}" data-go="catalog" data-filter-status="Shadow"><span class="lbl">Shadow AI</span><span class="val">${shadow}</span><span class="sub">${shadow ? 'Unregistered, no owner' : 'None detected'}</span></button>
    <button class="kpi" data-go="catalog"><span class="lbl">Avg trust score</span><span class="val" style="color:${toneVar(scoreTone(avg))}">${avg}</span><span class="sub">Across ${governed.length} governed agents</span></button>
    <button class="kpi ${pend ? 'warnk' : ''}" data-go="reviews"><span class="lbl">Awaiting review</span><span class="val">${pend}</span><span class="sub">${S.reviews.filter(r => r.status === 'Pending' && r.due <= '2026-10-31').length} due by Friday</span></button>
    <button class="kpi ${openInc.length ? 'alert' : ''}" data-go="incidents"><span class="lbl">Open incidents</span><span class="val">${openInc.length}</span><span class="sub">${fmt(users)} people use these agents</span></button>
  </div>`;

  // platform bars stacked by risk
  const byP = {}; A.forEach(a => { const p = byP[a.platform] || (byP[a.platform] = { High: 0, Medium: 0, Low: 0, n: 0 }); p[a.risk]++; p.n++; });
  const maxP = Math.max(...Object.values(byP).map(p => p.n));
  const pbars = Object.entries(byP).sort((a, b) => b[1].n - a[1].n).map(([k, p]) => `<div class="hbar"><span class="lab">${pt(k, 'sm')}<span>${esc(PLATFORMS[k].name)}</span></span><span class="track" style="width:${p.n / maxP * 100}%">${['High', 'Medium', 'Low'].map(r => p[r] ? `<i style="width:${p[r] / p.n * 100}%;background:${toneVar(r === 'High' ? 'crit' : r === 'Medium' ? 'warn' : 'ok')}" title="${p[r]} ${r}"></i>` : '').join('')}</span><span class="n">${p.n}</span></div>`).join('');

  // heat
  const cols = ['Approved', 'Approved with conditions', 'In review', 'Shadow', 'Suspended'];
  const colLab = ['Approved', 'With conditions', 'In review', 'Shadow', 'Suspended'];
  const heat = `<div class="heat"><span></span>${colLab.map(c => `<span class="h">${c}</span>`).join('')}${['High', 'Medium', 'Low'].map(r => `<span class="r">${r}</span>` + cols.map(c => {
    const n = A.filter(a => a.risk === r && (a.status === c || (c === 'Suspended' && a.status === 'Rejected') || (c === 'In review' && a.status === 'Sent back'))).length;
    const tone = c === 'Shadow' || c === 'Suspended' ? 'crit' : r === 'High' ? 'warn' : 'accent';
    const pct = n ? Math.min(85, 22 + n * 16) : 0;
    return n ? `<button class="c" data-go="catalog" data-filter-risk="${r}" data-filter-status="${c}" style="background:color-mix(in srgb, ${tone === 'accent' ? 'var(--accent)' : toneVar(tone)} ${pct}%, var(--surface-2));color:${pct > 50 ? '#fff' : 'var(--ink)'}">${n}</button>` : `<span class="c z">·</span>`;
  }).join('')).join('')}</div>`;

  // attention
  const att = [];
  A.filter(a => a.status === 'Shadow').forEach(a => att.push(['crit', `Shadow AI: ${a.name}`, a.desc, '#agent-' + a.id]));
  S.incidents.filter(i => isOpenInc(i) && i.sev === 'Sev 1').forEach(i => att.push(['crit', `${i.id} ${i.title}`, `${i.status} · owner ${i.owner}`, '#incident-' + i.id]));
  A.filter(a => a.status === 'Suspended').forEach(a => att.push(['crit', `${a.name} is suspended`, a.desc, '#agent-' + a.id]));
  const unv = mcpInUse().filter(m => MCP[m].tags.includes('Unverified'));
  unv.forEach(m => att.push(['warn', `Unverified MCP server: ${MCP[m].name}`, `${MCP[m].publisher} · auth: ${MCP[m].auth}`, '#agent-' + A.find(a => a.tools.some(t => TOOLS[t].via === m)).id]));
  A.filter(a => offshore(a)).forEach(a => att.push(['warn', `Data leaves Australia: ${a.name}`, `Runs in ${a.region}`, '#agent-' + a.id]));
  S.reviews.filter(r => r.status === 'Pending' && r.due <= '2026-10-31').forEach(r => att.push(['warn', `Review due ${r.due.slice(8)} Oct: ${r.agent}`, `${r.risk} risk · submitted by ${r.submitter}`, '#review-' + r.id]));
  A.filter(a => a.status !== 'Shadow' && a.status !== 'Suspended' && trust(a) < 70).forEach(a => att.push(['warn', `Low trust score (${trust(a)}): ${a.name}`, `Weakest: ${weakest(a)}`, '#agent-' + a.id]));
  const attHtml = att.slice(0, 7).map(([t, b, s, href]) => `<a class="li" href="${href}"><span class="sev ${t}"></span><span class="grow"><b>${esc(b)}</b><small>${esc(s)}</small></span></a>`).join('') || '<div class="empty">Nothing needs attention.</div>';

  // guardrail coverage
  const cov = guardrailCoverage();
  const covHtml = cov.map(([g, p]) => `<div class="hbar" style="grid-template-columns:160px minmax(0,1fr) 40px"><span class="lab"><span>${esc(g)}</span></span><span class="track"><i style="width:${p}%;background:${toneVar(scoreTone(p))}"></i></span><span class="n">${p}%</span></div>`).join('');

  // activity
  const act = S.audit.slice(0, 7).map(e => `<div class="li"><span class="sev ${e.type === 'Incident' ? 'crit' : e.type === 'Review' ? 'ok' : e.type === 'Scan' ? 'info' : 'warn'}"></span><span class="grow"><b>${esc(e.text)}</b><small>${esc(e.ts)} · ${esc(e.actor)}</small></span></div>`).join('');

  // inventory table
  const sorted = A.slice().sort((a, b) => UI.towerSort === 'users' ? usersOf(b) - usersOf(a) : UI.towerSort === 'name' ? a.name.localeCompare(b.name) : trust(a) - trust(b));
  const rows = sorted.map(a => `<tr class="click ${UI.flash.includes(a.id) ? 'flash' : ''}" data-href="#agent-${a.id}">
    <td><div class="cell-name">${pt(a.platform)}<span><b>${esc(a.name)}</b><small>${esc(a.bu)} · ${esc(a.owner)}</small></span></div></td>
    <td><span class="small">${esc(a.region)}</span><br><span class="muted small">${esc(PLATFORMS[a.platform].name)} · ${esc(a.env)}</span></td>
    <td class="num">${fmt(a.users.count)}<br><span class="muted small">${esc(a.users.groups[0])}</span></td>
    <td><span class="small">${a.tools.length} tools · ${a.skills.length} skills</span><br><span class="muted small">${a.models.map(m => esc(MODELS[m].name)).join(', ')}</span></td>
    <td>${a.status === 'Shadow' ? '<span class="muted">n/a</span>' : scoreBar(trust(a))}</td>
    <td>${riskChip(a.risk)}</td>
    <td>${statusChip(a.status)}</td></tr>`).join('');

  return `<div class="ph"><div><h1>Control tower</h1><p>Every AI agent running at Harbourline Bank, where it runs, who uses it and how far you can trust it.</p></div>
    <div class="actions"><button class="btn" data-go="audit">${ICON.audit} Audit log</button><button class="btn primary" data-act="scan">${ICON.scan} Connect &amp; scan</button></div></div>
    ${banner}${kpis}
    <div class="grid g-2" style="margin-bottom:16px">
      <section class="panel"><h2>Agents by platform <span class="muted">· coloured by risk tier</span></h2><div class="hbars">${pbars}</div>
        <div class="legend"><span><i style="background:var(--crit)"></i>High</span><span><i style="background:var(--warn)"></i>Medium</span><span><i style="background:var(--ok)"></i>Low</span></div></section>
      <section class="panel"><h2>Risk tier × status <span class="right muted">Click a cell to filter</span></h2>${heat}</section>
    </div>
    <div class="grid g-3" style="margin-bottom:16px">
      <section class="panel"><h2>Needs attention <span class="chip crit right">${att.length}</span></h2><div class="list">${attHtml}</div></section>
      <section class="panel"><h2>AI Safety Standard coverage <span class="muted">· share of agents with evidence</span></h2><div class="hbars">${covHtml}</div></section>
      <section class="panel"><h2>Recent activity <a href="#audit">Audit log</a></h2><div class="list">${act}</div></section>
    </div>
    <section class="panel" style="padding:0">
      <h2 style="padding:16px 18px 0">AI inventory <span class="muted">· ${A.length} agents</span>
        <span class="right"><span class="seg" role="group" aria-label="Sort inventory">${[['trust', 'Lowest trust'], ['users', 'Most used'], ['name', 'A–Z']].map(([k, l]) => `<button data-sort="${k}" class="${UI.towerSort === k ? 'on' : ''}">${l}</button>`).join('')}</span></span></h2>
      <div style="overflow-x:auto"><table><thead><tr><th>Agent</th><th>Deployed</th><th>Users</th><th>Capabilities</th><th>Trust</th><th>Risk</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table></div>
    </section>`;
}
function weakest(a) { const n = { gov: 'governance', sec: 'security', data: 'data quality', rel: 'reliability', trans: 'transparency' }; const k = Object.keys(a.scores).sort((x, y) => a.scores[x] - a.scores[y])[0]; return `${n[k]} ${a.scores[k]}`; }
function guardrailCoverage() {
  const A = S.agents, ok = (a, k) => a.scores[k] >= 75;
  const human = a => /L1|L2/.test(a.autonomy);
  const tests = [a => ok(a, 'gov') && a.owner !== 'Unassigned', a => ok(a, 'gov'), a => ok(a, 'data') && ok(a, 'sec'), a => ok(a, 'rel'), human, a => ok(a, 'trans'), a => ok(a, 'trans') && a.status !== 'Shadow', a => ok(a, 'sec') && !a.tools.some(t => MCP[TOOLS[t].via] && MCP[TOOLS[t].via].tags.includes('Unverified')), a => a.status !== 'Shadow', a => ok(a, 'gov') && ok(a, 'trans')];
  return GUARDRAILS.map((g, i) => [g, Math.round(A.filter(tests[i]).length / A.length * 100)]);
}
function mcpInUse() { const s = new Set(); S.agents.forEach(a => a.tools.forEach(t => { if (TOOLS[t].via !== 'native') s.add(TOOLS[t].via); })); return Array.from(s); }
function modelsInUse() { const s = new Set(); S.agents.forEach(a => a.models.forEach(m => s.add(m))); return Array.from(s); }

/* ======================================================================
   REGISTRY
   ====================================================================== */
function viewRegistry() {
  const conns = S.connectors.map(c => {
    const n = S.agents.filter(a => a.connector === c.id).length;
    if (c.status === 'new') return `<button class="conn new" data-act="scan" data-conn="${c.id}"><div class="head">${pt(c.platform)}<span><b>${esc(c.label)}</b><small>${esc(c.scope)}</small></span></div><div class="meta">${chip('Connected · not scanned', 'acc')}<span class="row" style="color:var(--accent);font-weight:500">${ICON.scan.replace('<svg', '<svg width="15" height="15"')} Scan now</span></div></button>`;
    return `<button class="conn" data-act="scan" data-conn="${c.id}"><div class="head">${pt(c.platform)}<span><b>${esc(c.label)}</b><small>${esc(c.method)}</small></span></div><div class="meta"><span class="status"><span class="dot ok"></span>${n} agent${n === 1 ? '' : 's'}</span><span class="muted">Scanned ${esc(c.lastScan.slice(5))}</span></div></button>`;
  }).join('') + `<button class="conn" data-act="scan" style="align-items:center;justify-content:center;color:var(--accent);font-weight:500;min-height:104px">${ICON.plus.replace('<svg', '<svg width="22" height="22"')}Add landscape</button>`;

  const mcps = mcpInUse(), models = modelsInUse(), a2a = S.agents.filter(a => a.protocols.includes('A2A'));
  const tabs = [['agents', 'Agents', S.agents.length], ['mcp', 'MCP servers', mcps.length], ['a2a', 'A2A endpoints', a2a.length], ['models', 'Models', models.length]];
  let body = '';
  if (UI.regTab === 'agents') {
    body = `<table><thead><tr><th>Agent</th><th>Platform</th><th>Protocols</th><th>Version</th><th>Discovered via</th><th>Environment</th><th>Status</th></tr></thead><tbody>${S.agents.map(a => `<tr class="click ${UI.flash.includes(a.id) ? 'flash' : ''}" data-href="#agent-${a.id}">
      <td><div class="cell-name">${pt(a.platform)}<span><b>${esc(a.name)}</b><small class="mono">${a.id} · ${esc(a.owner)}</small></span></div></td>
      <td class="small">${esc(PLATFORMS[a.platform].name)}</td>
      <td><div class="chips">${a.protocols.map(p => chip(p, 'info')).join('') || '<span class="muted small">None</span>'}</div></td>
      <td class="mono">${esc(a.version)}</td><td class="small">${esc(a.discovered)}</td><td class="small">${esc(a.env)}</td><td>${statusChip(a.status)}</td></tr>`).join('')}</tbody></table>`;
  } else if (UI.regTab === 'mcp') {
    body = `<table><thead><tr><th>MCP server</th><th>Publisher</th><th>Auth</th><th>Tools exposed</th><th>Used by</th><th>Trust tags</th></tr></thead><tbody>${mcps.map(m => {
      const M = MCP[m], tools = Object.keys(TOOLS).filter(t => TOOLS[t].via === m), users = S.agents.filter(a => a.tools.some(t => TOOLS[t].via === m));
      return `<tr class="click" data-href="#agent-${users[0].id}"><td><div class="cell-name">${pt(M.host, 'sm')}<span><b>${esc(M.name)}</b><small class="mono">${esc(M.endpoint)}</small></span></div></td><td class="small">${esc(M.publisher)}</td><td class="small">${esc(M.auth)}</td><td class="small">${tools.map(t => esc(TOOLS[t].name)).join(', ')}</td><td class="small">${users.map(u => esc(u.name)).join(', ')}</td><td>${tagChips(M.tags)}</td></tr>`;
    }).join('')}</tbody></table>`;
  } else if (UI.regTab === 'a2a') {
    body = `<table><thead><tr><th>Agent</th><th>Agent card</th><th>Advertised skills</th><th>Talks to</th><th>Status</th></tr></thead><tbody>${a2a.map(a => `<tr class="click" data-href="#agent-${a.id}"><td><div class="cell-name">${pt(a.platform)}<span><b>${esc(a.name)}</b><small>${esc(a.bu)}</small></span></div></td><td class="mono" style="max-width:320px;overflow-wrap:anywhere">${esc(a.card || 'Internal A2A runtime')}</td><td class="small">${a.skills.map(s => esc(SKILLS[s].name)).join(', ') || '—'}</td><td class="small">${a.a2a.map(id => agentById(id) ? esc(agentById(id).name) : id).join(', ') || '—'}</td><td>${statusChip(a.status)}</td></tr>`).join('')}</tbody></table>`;
  } else {
    const list = models.filter(m => !UI.owOnly || MODELS[m].type === 'Open-weight');
    body = `<table><thead><tr><th>Model</th><th>Type</th><th>Hosting &amp; region</th><th>Licence</th><th>Used by</th><th>Tags</th></tr></thead><tbody>${list.map(m => {
      const M = MODELS[m], users = S.agents.filter(a => a.models.includes(m));
      return `<tr class="click" data-href="#agent-${users[0].id}"><td><div class="cell-name">${pt(M.host, 'sm')}<span><b>${esc(M.name)}</b><small>${esc(M.provider)}</small></span></div></td><td>${chip(M.type, M.type === 'Open-weight' ? 'acc' : 'info')}</td><td class="small">${esc(M.region)}</td><td class="small">${esc(M.license || 'Commercial terms')}</td><td class="small">${users.map(u => esc(u.name)).join(', ')}</td><td>${tagChips(M.tags)}</td></tr>`;
    }).join('') || '<tr><td colspan="6" class="empty">No open-weight models found yet. Scan AWS or Google Cloud.</td></tr>'}</tbody></table>`;
  }
  return `<div class="ph"><div><h1>Agent registry</h1><p>The system of record for every agent, MCP server, A2A endpoint and model the scanner finds across your landscape.</p></div>
    <div class="actions"><button class="btn primary" data-act="scan">${ICON.scan} Connect &amp; scan</button></div></div>
    <section style="margin-bottom:22px"><h2 class="small muted" style="text-transform:uppercase;letter-spacing:.07em;font-weight:500;margin:0 0 10px">Connected landscapes</h2><div class="conns">${conns}</div></section>
    <div class="tabs" role="tablist">${tabs.map(([k, l, n]) => `<button role="tab" data-regtab="${k}" class="${UI.regTab === k ? 'on' : ''}">${l} <span class="chip">${n}</span></button>`).join('')}</div>
    ${UI.regTab === 'models' ? `<div class="filters"><label class="check" style="padding:6px 10px"><input type="checkbox" id="owOnly" ${UI.owOnly ? 'checked' : ''}><span>Open-weight models only</span></label></div>` : ''}
    <div class="tbl-wrap">${body}</div>`;
}

/* ======================================================================
   SCANNER (drawer)
   ====================================================================== */
let SC = null;
function openDrawer(html) { $('#drawer').innerHTML = html; $('#drawer').hidden = false; $('#scrim').hidden = false; }
function closeDrawer() { if (SC && SC.timer) clearTimeout(SC.timer); SC = null; $('#drawer').hidden = true; $('#scrim').hidden = true; }
function openScan(connId) {
  SC = { step: 1, conn: connId || null, methods: new Set(['cp', 'a2a', 'mcp', 'tel', 'ow']), lines: [], idx: 0, found: 0, warn: 0, tested: false };
  if (connId) { const c = S.connectors.find(x => x.id === connId); SC.platform = c.platform; SC.step = 2; }
  drawScan();
}
const PLAT_CONN = { bedrock: 'aws-retail', vertex: 'gcp-wealth' };
function drawScan() {
  const steps = ['Platform', 'Connect', 'Discover', 'Scan', 'Review results'];
  const st = `<div class="steps">${steps.map((s, i) => `<span class="${i + 1 === SC.step ? 'on' : i + 1 < SC.step ? 'done' : ''}">${i + 1}. ${s}</span>`).join('')}</div>`;
  let body = '', foot = '';
  const conn = SC.conn && S.connectors.find(c => c.id === SC.conn);
  if (SC.step === 1) {
    const groups = {}; Object.entries(PLATFORMS).forEach(([k, P]) => { if (k === 'browser') return; (groups[P.kind] = groups[P.kind] || []).push(k); });
    body = `<p class="muted" style="margin-top:0">Pick where to look for AI. Nexus connects read-only and never changes anything in the target.</p>` + Object.entries(groups).map(([g, ks]) => `<h3 class="small muted" style="text-transform:uppercase;letter-spacing:.07em;font-weight:500;margin:16px 0 8px">${g}</h3><div class="pgrid">${ks.map(k => {
      const cs = S.connectors.filter(c => c.platform === k); const isNew = cs.some(c => c.status === 'new'); const con = cs.some(c => c.status === 'connected');
      const tag = isNew ? chip('Ready to scan', 'acc') : con ? chip('Connected', 'ok') : '';
      return `<button data-pick="${k}" class="${SC.platform === k ? 'sel' : ''}">${pt(k, 'lg')}<b>${esc(PLATFORMS[k].name)}</b><small>${isNew ? 'Credentials added' : con ? cs.length + ' connection' + (cs.length > 1 ? 's' : '') : 'Available'}</small><span class="tag">${tag}</span></button>`;
    }).join('')}</div>`).join('');
    foot = `<button class="btn" data-act="close">Cancel</button>`;
  } else if (SC.step === 2) {
    const aws = conn.platform === 'bedrock', rescan = conn.status !== 'new';
    body = `<div class="row" style="margin-bottom:16px">${pt(conn.platform, 'lg')}<div><b style="font-size:16px">${esc(conn.label)}</b><div class="muted small">${esc(PLATFORMS[conn.platform].name)}${rescan ? ' · already connected' : ''}</div></div></div>` +
      (aws ? `<div class="field"><label for="f1">Account</label><input id="f1" value="${conn.id === 'aws-core' ? '331088421907' : '482177301956'} · Harbourline ${conn.id === 'aws-core' ? 'Core Banking' : 'Retail Lending AI'}"></div>
        <div class="field"><label for="f2">Read-only IAM role</label><input id="f2" class="mono" value="arn:aws:iam::${conn.id === 'aws-core' ? '331088421907' : '482177301956'}:role/AgentNexusReadOnly"><span class="hint">Created from the Nexus CloudFormation template. Grants bedrock:List*, bedrock-agentcore:List*, sagemaker:Describe*, cloudtrail:LookupEvents.</span></div>
        <div class="field"><label for="f3">External ID</label><input id="f3" class="mono" value="anx-hlb-7f3c-••••-••••" readonly></div>
        <div class="field"><label>Regions</label><div class="chips">${chip('ap-southeast-2 Sydney', 'acc')}${chip('ap-southeast-4 Melbourne', 'acc')}${chip('us-east-1 (residency check)', 'info')}</div></div>`
      : `<div class="field"><label for="f1">Project</label><input id="f1" value="hlb-wealth-cards"></div>
        <div class="field"><label for="f2">Service account</label><input id="f2" class="mono" value="agent-nexus-scanner@hlb-wealth-cards.iam.gserviceaccount.com"><span class="hint">Workload Identity Federation, no keys stored. Roles: aiplatform.viewer, logging.viewer, container.viewer.</span></div>
        <div class="field"><label>Regions</label><div class="chips">${chip('australia-southeast1 Sydney', 'acc')}${chip('australia-southeast2 Melbourne', 'acc')}${chip('All other regions (residency check)', 'info')}</div></div>`) +
      `<div class="field"><label>Data handling</label><div class="note">Nexus reads configuration and metadata. Prompts and outputs are never copied; invocation logs are summarised in your tenant (Sydney).</div></div>
       <div id="testOut">${SC.tested ? testResult(aws) : ''}</div>`;
    foot = `<button class="btn" data-act="${SC.conn && !SC.fromPick ? 'close' : 'back'}">${SC.conn && !SC.fromPick ? 'Cancel' : 'Back'}</button><button class="btn" data-act="test">${ICON.check} Test connection</button><button class="btn primary" data-act="next" ${SC.tested ? '' : 'disabled'}>Next</button>`;
  } else if (SC.step === 3) {
    body = `<p class="muted" style="margin-top:0">Choose how Nexus finds agents and GenAI workloads in <b>${esc(conn.label)}</b>.</p><div class="checks">${DISCOVERY_METHODS.map(m => `<label class="check"><input type="checkbox" data-method="${m.id}" ${SC.methods.has(m.id) ? 'checked' : ''}><span><b>${esc(m.name)}</b><small>${esc(m.detail)}</small></span></label>`).join('')}</div>`;
    foot = `<button class="btn" data-act="back">Back</button><button class="btn primary" data-act="start">${ICON.scan} Start scan</button>`;
  } else if (SC.step === 4) {
    const total = scriptFor().length, pct = Math.round(SC.idx / total * 100);
    body = `<div class="scan-stats"><div><b>${SC.found}</b><small>Assets found</small></div><div><b style="color:var(--warn)">${SC.warn}</b><small>Risks flagged</small></div><div><b>${SC.methods.size}</b><small>Discovery methods</small></div><div><b>${pct}%</b><small>Complete</small></div></div>
      <div class="console" id="console">${SC.lines.join('')}</div><div class="progress"><i style="width:${pct}%"></i></div><div class="muted small">Scanning ${esc(conn.label)}…</div>`;
    foot = `<button class="btn" data-act="close">Run in background</button><button class="btn primary" disabled>Scanning…</button>`;
  } else if (SC.step === 5) {
    const found = SCAN_AGENTS[SC.conn] || [];
    const reg = found.length && found.every(f => agentById(f.id));
    if (!found.length || (reg && SC.rescan)) {
      body = `<div class="empty"><div style="color:var(--ok);margin-bottom:8px">${ICON.shield.replace('<svg', '<svg width="36" height="36"')}</div><b>No changes since the last scan</b><p>${S.agents.filter(a => a.connector === SC.conn).length} known agents re-verified. Agent cards, MCP manifests and model versions unchanged.</p></div>`;
      foot = `<button class="btn primary" data-act="close">Done</button>`;
    } else {
      const mcps = new Set(), mods = new Set(); found.forEach(a => { a.tools.forEach(t => TOOLS[t].via !== 'native' && mcps.add(TOOLS[t].via)); a.models.forEach(m => mods.add(m)); });
      const ow = Array.from(mods).filter(m => MODELS[m].type === 'Open-weight').length;
      const shadow = found.filter(a => a.status === 'Shadow');
      body = `<div class="scan-stats"><div><b>${found.length}</b><small>Agents</small></div><div><b>${mcps.size}</b><small>MCP servers</small></div><div><b>${mods.size}</b><small>Models (${ow} open-weight)</small></div><div><b style="color:var(--crit)">${shadow.length}</b><small>Shadow AI</small></div></div>
        <div class="tbl-wrap"><table><thead><tr><th>Discovered</th><th>Found by</th><th>Risk</th><th>Next step</th></tr></thead><tbody>${found.map(a => `<tr><td><div class="cell-name" style="min-width:200px">${pt(a.platform, 'sm')}<span><b>${esc(a.name)}</b><small>${esc(a.bu)} · ${a.tools.length} tools · ${a.models.map(m => esc(MODELS[m].name)).join(', ')}</small></span></div></td><td class="small">${esc(a.discovered)}</td><td>${riskChip(a.risk)}</td><td>${a.status === 'Shadow' ? chip('Open shadow AI case', 'crit') : chip('Send to GRC review', 'warn')}</td></tr>`).join('')}</tbody></table></div>
        <p class="small muted">Registering adds these to the catalog with their graph and trust score. Sanctioned agents go to the review queue; shadow workloads open an incident case with the owner unknown.</p>`;
      foot = reg ? `<button class="btn primary" data-act="close">Done</button>` : `<button class="btn" data-act="close">Later</button><button class="btn primary" data-act="register">${ICON.check} Register ${found.length} assets</button>`;
    }
  }
  openDrawer(`<header><span>${ICON.scan.replace('<svg', '<svg width="22" height="22"')}</span><h2>${SC.step === 1 ? 'Connect &amp; scan' : conn ? 'Scan · ' + esc(conn.label) : 'Scan'}</h2><button class="btn sm x" data-act="close" aria-label="Close">${ICON.x}</button></header><div class="body">${st}${body}</div><footer>${foot}</footer>`);
  const con = $('#console'); if (con) con.scrollTop = con.scrollHeight;
}
function testResult(aws) {
  const lines = aws ? ['sts:AssumeRole succeeded (session 15 min)', 'Read-only policy confirmed: no write permissions', 'Bedrock, AgentCore, SageMaker, CloudTrail reachable in 3 regions']
    : ['Workload Identity token exchanged', 'Viewer roles confirmed: no write permissions', 'Vertex AI, Cloud Logging, GKE APIs enabled'];
  return `<div class="checks">${lines.map(l => `<div class="check" style="cursor:default"><span style="color:var(--ok)">${ICON.check.replace('<svg', '<svg width="16" height="16"')}</span><span>${esc(l)}</span></div>`).join('')}</div>`;
}
function scriptFor() {
  const c = S.connectors.find(x => x.id === SC.conn);
  if (SCAN_SCRIPT[SC.conn] && !SC.rescan) return SCAN_SCRIPT[SC.conn];
  return [['info', `Connecting to ${c.label}`], ['step', 'Control plane'], ['info', `${S.agents.filter(a => a.connector === c.id).length} known agents re-verified`], ['step', 'A2A agent cards and MCP manifests'], ['info', 'No new endpoints; manifests unchanged'], ['step', 'Model invocation telemetry'], ['info', 'Model IDs unchanged since last scan'], ['done', 'Scan complete · no changes']];
}
function runScan() {
  const script = scriptFor();
  const tick = () => {
    if (!SC || SC.step !== 4) return;
    const [k, m] = script[SC.idx]; const d = new Date(); const t = [d.getHours(), d.getMinutes(), d.getSeconds()].map(x => String(x).padStart(2, '0')).join(':');
    SC.lines.push(`<div class="ln ${k}"><span class="t">${t}</span><span>${k === 'step' ? '▸ ' : k === 'found' ? '+ ' : k === 'warn' ? '! ' : k === 'done' ? '✓ ' : ''}${esc(m)}</span></div>`);
    if (k === 'found') SC.found++; if (k === 'warn') SC.warn++;
    SC.idx++;
    if (SC.idx >= script.length) { SC.timer = setTimeout(() => { if (!SC) return; SC.step = 5; finishScanMeta(); drawScan(); }, 650); }
    else SC.timer = setTimeout(tick, k === 'step' ? 520 : 330);
    drawScan();
  };
  tick();
}
function finishScanMeta() {
  const c = S.connectors.find(x => x.id === SC.conn);
  if (SC.rescan || c.status !== 'new') { c.lastScan = nowStamp(); audit('Scanner', 'Scan', `${c.label} rescanned: ${S.agents.filter(a => a.connector === c.id).length} agents, 0 changes`, c.id); }
}
function registerScan() {
  const c = S.connectors.find(x => x.id === SC.conn), found = clone(SCAN_AGENTS[SC.conn]);
  c.status = 'connected'; c.lastScan = nowStamp(); c.method = c.platform === 'bedrock' ? 'Bedrock + AgentCore APIs, CloudTrail, SageMaker' : 'Agent Engine, Cloud Audit Logs, GKE';
  audit('Mei Lin Chen', 'Scan', `${c.label} scanned: ${found.length} agents found (${found.filter(a => a.status === 'Shadow').length} shadow)`, c.id);
  const IMPACT = { S04: '1,904 calls in 30 days reading s3://hlb-loan-applications/* through an MCP server that accepts unauthenticated requests.', G05: '642 calls in 30 days sending an unmasked production customer extract to a hosted model from a personal notebook.' };
  found.forEach(a => {
    if (agentById(a.id)) return;
    S.agents.push(a); UI.flash.push(a.id);
    if (a.status === 'Shadow') {
      const id = 'INC-' + (S.seqI++);
      S.incidents.unshift({ id, title: `Shadow AI found: ${a.name}`, agent: a.id, sev: 'Sev 2', status: 'Open', opened: '2026-10-29', closed: null, owner: 'Mei Lin Chen', category: 'Shadow AI · unregistered workload',
        precedent: 'Unregistered AI built outside approved channels is a common way customer data ends up in tools nobody has assessed. Finding it early keeps it a governance issue rather than a breach.',
        summary: a.desc, impact: IMPACT[a.id] || 'Under assessment.', rootCause: 'To be confirmed. Built outside the agent intake process. Creator: ' + a.ownerRole + '.',
        timeline: [[nowStamp(), `Detected by Agent Nexus scan of ${c.label}`], [nowStamp(), 'Case opened; cloud platform team notified']],
        actions: [['Identify owner and business purpose', 'Open', 'AI Risk'], ['Restrict data access until reviewed', 'Open', 'Cloud Platform'], ['Register through intake or decommission', 'Open', 'Owner (TBC)']],
        controls: ['G1 Accountability & owner', 'G3 Data governance & security', 'CPS 234 Information Security'], evidence: [`Scan report ${c.id} ${nowStamp()}`, 'Invocation telemetry (30 days)'] });
      audit('Policy engine', 'Incident', `${id} opened: shadow AI ${a.name}`, id);
    } else {
      const id = 'R-' + (S.seqR++);
      S.reviews.unshift(reviewFromAgent(id, a));
      audit('Policy engine', 'Review', `${id} created for discovered agent ${a.name}`, id);
    }
    audit('Scanner', 'Registry', `${a.id} ${a.name} registered from ${c.label}`, a.id);
  });
  save(); closeDrawer(); toast(`${found.length} assets registered from ${c.label}`); go('registry'); UI.flash = found.map(a => a.id); rerender();
}
function reviewFromAgent(id, a) {
  const g = s => s >= 75 ? 1 : 0;
  return { id, agentId: a.id, source: 'Scan', agent: a.name, platform: a.platform, submitter: a.owner, bu: a.bu, submitted: '2026-10-29', due: '2026-11-05', purpose: a.desc,
    customerFacing: a.customerFacing, autonomy: a.autonomy, risk: a.risk, model: a.models.map(m => MODELS[m].name).join(', '), tools: a.tools.map(t => `${TOOLS[t].name} (${TOOLS[t].action.toLowerCase()})`),
    data: a.data.map(d => DATA[d].name), dataCls: Array.from(new Set(a.data.map(d => DATA[d].cls))), evals: { groundedness: null, redteam: null, bias: 'Not run', jailbreak: null },
    pia: 'Not started', cps230: a.risk === 'High' ? 'To be assessed' : 'Not material', hitl: /L1/.test(a.autonomy) ? 'Advisory output only' : /L2/.test(a.autonomy) ? 'Staff approve actions' : 'None proposed',
    guardrails: [g(a.scores.gov), g(a.scores.gov), g(Math.min(a.scores.data, a.scores.sec)), g(a.scores.rel), /L1|L2/.test(a.autonomy) ? 1 : 0, g(a.scores.trans), g(a.scores.trans), g(a.scores.sec), 1, g(a.scores.gov)], status: 'Pending', notes: [] };
}

/* ======================================================================
   CATALOG
   ====================================================================== */
function viewCatalog() {
  const tabs = [['agents', 'Agents', S.agents.length], ['skills', 'Skills', uniq(S.agents.flatMap(a => a.skills)).length], ['tools', 'Tools', uniq(S.agents.flatMap(a => a.tools)).length], ['data', 'Data sources', uniq(S.agents.flatMap(a => a.data)).length]];
  let body = '';
  if (UI.catTab === 'agents') {
    const q = UI.catQ.toLowerCase();
    const list = S.agents.filter(a => (!q || (a.name + a.bu + a.owner + a.desc).toLowerCase().includes(q)) && (!UI.catPlat || a.platform === UI.catPlat) && (!UI.catBU || a.bu === UI.catBU) && (!UI.catRisk || a.risk === UI.catRisk) && (!UI.catStatus || a.status === UI.catStatus || (UI.catStatus === 'Suspended' && a.status === 'Rejected')));
    const filters = `<div class="filters">
      <input type="search" id="catQ" placeholder="Search name, owner, purpose" value="${esc(UI.catQ)}">
      <select id="catPlat" aria-label="Platform"><option value="">All platforms</option>${uniq(S.agents.map(a => a.platform)).map(p => `<option value="${p}" ${UI.catPlat === p ? 'selected' : ''}>${esc(PLATFORMS[p].name)}</option>`).join('')}</select>
      <select id="catBU" aria-label="Business unit"><option value="">All business units</option>${uniq(S.agents.map(a => a.bu)).sort().map(b => `<option ${UI.catBU === b ? 'selected' : ''}>${esc(b)}</option>`).join('')}</select>
      <select id="catRisk" aria-label="Risk"><option value="">Any risk</option>${['High', 'Medium', 'Low'].map(r => `<option ${UI.catRisk === r ? 'selected' : ''}>${r}</option>`).join('')}</select>
      <select id="catStatus" aria-label="Status"><option value="">Any status</option>${['Approved', 'Approved with conditions', 'In review', 'Shadow', 'Suspended'].map(r => `<option ${UI.catStatus === r ? 'selected' : ''}>${r}</option>`).join('')}</select>
      ${(UI.catQ || UI.catPlat || UI.catBU || UI.catRisk || UI.catStatus) ? `<button class="btn sm" data-act="clearcat">Clear filters</button>` : ''}
      <span style="margin-left:auto" class="seg">${[['cards', 'Cards'], ['table', 'Table']].map(([k, l]) => `<button data-catview="${k}" class="${UI.catView === k ? 'on' : ''}">${l}</button>`).join('')}</span></div>`;
    if (UI.catView === 'cards') {
      body = filters + `<div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(300px,1fr))">${list.map(a => `<a class="panel" href="#agent-${a.id}" style="text-decoration:none;color:inherit;display:flex;flex-direction:column;gap:10px">
        <div class="row" style="flex-wrap:nowrap">${pt(a.platform)}<span style="min-width:0;flex:1"><b style="display:block;font-weight:600">${esc(a.name)}</b><small class="muted">${esc(a.bu)} · ${esc(a.owner)}</small></span>${a.status === 'Shadow' ? '' : `<span title="Trust score">${ring(trust(a), 48, '')}</span>`}</div>
        <div class="small" style="color:var(--ink-2);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">${esc(a.desc)}</div>
        <div class="chips">${statusChip(a.status)}&nbsp;${riskChip(a.risk)}${a.customerFacing ? chip('Customer-facing', 'info') : ''}${a.protocols.map(p => chip(p)).join('')}</div>
        <div class="row small muted" style="border-top:1px solid var(--line);padding-top:10px;gap:14px"><span><b class="num" style="color:var(--ink)">${fmt(a.users.count)}</b> users</span><span><b style="color:var(--ink)">${a.tools.length}</b> tools</span><span><b style="color:var(--ink)">${a.skills.length}</b> skills</span><span><b style="color:var(--ink)">${a.data.length}</b> data</span></div></a>`).join('') || '<div class="empty">No agents match these filters.</div>'}</div>`;
    } else {
      body = filters + `<div class="tbl-wrap"><table><thead><tr><th>Agent</th><th>Business unit</th><th>Users</th><th>Tools</th><th>Skills</th><th>Trust</th><th>Risk</th><th>Status</th></tr></thead><tbody>${list.map(a => `<tr class="click" data-href="#agent-${a.id}"><td><div class="cell-name">${pt(a.platform)}<span><b>${esc(a.name)}</b><small>${esc(a.owner)}</small></span></div></td><td class="small">${esc(a.bu)}</td><td class="num">${fmt(a.users.count)}</td><td class="num">${a.tools.length}</td><td class="num">${a.skills.length}</td><td>${a.status === 'Shadow' ? '<span class="muted">n/a</span>' : scoreBar(trust(a))}</td><td>${riskChip(a.risk)}</td><td>${statusChip(a.status)}</td></tr>`).join('')}</tbody></table></div>`;
    }
  } else if (UI.catTab === 'skills') {
    const ids = uniq(S.agents.flatMap(a => a.skills));
    body = `<div class="tbl-wrap"><table><thead><tr><th>Skill</th><th>Source library</th><th>Version</th><th>Published by</th><th>Used by</th><th>Tags</th></tr></thead><tbody>${ids.map(id => { const k = SKILLS[id]; const u = S.agents.filter(a => a.skills.includes(id)); return `<tr class="click" data-href="#agent-${u[0].id}"><td><b style="font-weight:500">${esc(k.name)}</b></td><td class="small">${esc(k.library)}</td><td class="mono">${esc(k.version)}</td><td class="small">${esc(k.publisher)}</td><td class="small">${u.map(x => esc(x.name)).join(', ')}</td><td>${tagChips(k.tags)}</td></tr>`; }).join('')}</tbody></table></div>`;
  } else if (UI.catTab === 'tools') {
    const ids = uniq(S.agents.flatMap(a => a.tools));
    body = `<div class="tbl-wrap"><table><thead><tr><th>Tool</th><th>Served by</th><th>Action</th><th>Data</th><th>Used by</th><th>Tags</th></tr></thead><tbody>${ids.map(id => { const t = TOOLS[id]; const u = S.agents.filter(a => a.tools.includes(id)); return `<tr class="click" data-href="#agent-${u[0].id}"><td><b style="font-weight:500">${esc(t.name)}</b><br><span class="mono muted">${id}</span></td><td class="small">${t.via === 'native' ? 'Native to platform' : esc(MCP[t.via].name)}</td><td>${chip(t.action, t.action === 'Write' || t.action === 'Decide' ? 'warn' : 'info')}</td><td class="small">${esc(t.data)}</td><td class="small">${u.map(x => esc(x.name)).join(', ')}</td><td>${tagChips(t.tags)}</td></tr>`; }).join('')}</tbody></table></div>`;
  } else {
    const ids = uniq(S.agents.flatMap(a => a.data));
    body = `<div class="tbl-wrap"><table><thead><tr><th>Data source</th><th>Platform</th><th>Classification</th><th>Used by</th><th>Quality &amp; trust</th></tr></thead><tbody>${ids.map(id => { const d = DATA[id]; const u = S.agents.filter(a => a.data.includes(id)); return `<tr class="click" data-href="#agent-${u[0].id}"><td><b style="font-weight:500">${esc(d.name)}</b></td><td class="small">${esc(d.platform)}</td><td>${chip(d.cls, /PII|PCI|Sensitive/.test(d.cls) ? 'warn' : 'info')}</td><td class="small">${u.map(x => esc(x.name)).join(', ')}</td><td>${tagChips(d.tags)}</td></tr>`; }).join('')}</tbody></table></div>`;
  }
  return `<div class="ph"><div><h1>AI catalog</h1><p>Business context for every AI asset: what it does, who owns it, what it can touch, and whether its parts are trusted.</p></div></div>
    <div class="tabs" role="tablist">${tabs.map(([k, l, n]) => `<button role="tab" data-cattab="${k}" class="${UI.catTab === k ? 'on' : ''}">${l} <span class="chip">${n}</span></button>`).join('')}</div>${body}`;
}
const uniq = a => Array.from(new Set(a));

/* ======================================================================
   AGENT DETAIL + GRAPH
   ====================================================================== */
let agentTab = 'graph';
function viewAgent(id) {
  const a = agentById(id);
  if (!a) return `<div class="empty"><b>Agent ${esc(id)} is not in the registry yet.</b><p>It may live in a landscape that has not been scanned.</p><a class="btn" href="#registry">Open registry</a></div>`;
  const t = trust(a);
  const incs = S.incidents.filter(i => i.agent === a.id);
  const rev = S.reviews.find(r => r.agentId === a.id && r.status === 'Pending');
  const tabs = [['graph', 'Graph'], ['trust', 'Trust score'], ['access', 'Users & access'], ['compliance', 'Compliance'], ['activity', 'Activity']];
  return `<div class="crumbs"><a href="#catalog">AI catalog</a><span>/</span><span>${esc(a.bu)}</span><span>/</span><span>${esc(a.name)}</span></div>
    <div class="agent-head">${pt(a.platform, 'lg')}<div class="grow"><h1>${esc(a.name)}</h1><p>${esc(a.desc)}</p>
      <div class="chips">${statusChip(a.status)}&nbsp;${riskChip(a.risk)}${a.customerFacing ? chip('Customer-facing', 'info') : chip('Internal', '')}${a.protocols.map(p => chip(p, 'info')).join('')}${offshore(a) ? chip('Offshore processing', 'warn') : ''}${incs.filter(isOpenInc).map(i => `<a href="#incident-${i.id}" style="text-decoration:none">${chip(i.id + ' open', 'crit')}</a>`).join('')}</div></div>
      ${a.status === 'Shadow' ? `<div class="panel" style="max-width:240px"><b style="color:var(--crit)">No trust score</b><div class="small muted">Shadow workloads are scored only after an owner registers them.</div></div>` : ring(t, 96)}
      <div class="row" style="flex-direction:column;align-items:stretch">
        ${rev ? `<a class="btn" href="#review-${rev.id}">${ICON.reviews} Open review ${rev.id}</a>` : `<button class="btn" data-act="toreview" data-id="${a.id}">${ICON.reviews} Send to review</button>`}
        ${a.status === 'Suspended' ? `<button class="btn" data-act="reinstate" data-id="${a.id}">${ICON.check} Reinstate</button>` : `<button class="btn danger" data-act="suspend" data-id="${a.id}">${ICON.x} Suspend agent</button>`}
      </div></div>
    <div class="facts">
      <div><small>Platform</small><b>${esc(PLATFORMS[a.platform].name)}</b></div>
      <div><small>Deployed in</small><b>${esc(a.region)}</b></div>
      <div><small>Environment</small><b>${esc(a.env)}</b></div>
      <div><small>Owner</small><b>${esc(a.owner)}</b></div>
      <div><small>Users</small><b class="num">${fmt(a.users.count)}</b></div>
      <div><small>Autonomy</small><b>${esc(a.autonomy)}</b></div>
      <div><small>Calls (30 days)</small><b class="num">${fmt(a.inv30)}</b></div>
      <div><small>Discovered via</small><b>${esc(a.discovered)}</b></div>
    </div>
    <div class="tabs" role="tablist">${tabs.map(([k, l]) => `<button role="tab" data-agenttab="${k}" class="${agentTab === k ? 'on' : ''}">${l}</button>`).join('')}</div>
    <div id="agentTab">${agentTabHtml(a)}</div>`;
}
function agentTabHtml(a) {
  if (agentTab === 'graph') return `<div class="graph-wrap"><div class="graph"><div id="cy"></div>
      <div class="graph-tools"><button class="btn sm" data-g="expand">${ICON.expand} Show all sources</button><button class="btn sm" data-g="fit">${ICON.fit} Fit</button><button class="btn sm" data-g="reset">${ICON.reset} Reset</button></div>
      <div class="graph-hint">Click a skill, tool, data source or model to trace where it comes from</div>
      <div class="graph-legend">${[['Agent', 'var(--accent)'], ['Model', '#7A5BC7'], ['Skill', '#2E66C7'], ['Tool', '#1F9D6B'], ['Data', '#C98A1B'], ['MCP server', '#53667A'], ['Origin', '#9AA5B1']].map(([l, c]) => `<span><i style="background:${c}"></i>${l}</span>`).join('')}<span><i style="background:transparent;border:2px solid var(--crit)"></i>Risk flag</span></div></div>
      <aside class="inspector" id="inspector">${inspectAgent(a)}</aside></div>`;
  if (agentTab === 'trust') {
    if (a.status === 'Shadow') return `<div class="panel empty">Shadow workloads have no trust score until they are registered with an owner.</div>`;
    const D = [['gov', 'Governance', 'Owner, approvals, documentation and review cadence'], ['sec', 'Security', 'Identity, least privilege, MCP auth, injection defences'], ['data', 'Data', 'Classification, quality and lineage of every source the agent reads'], ['rel', 'Reliability', 'Evaluation results, error rates, drift and incident history'], ['trans', 'Transparency', 'Disclosure to users, citations, explanation and logging']];
    const sig = [];
    a.tools.forEach(t => { const T = TOOLS[t], M = MCP[T.via]; T.tags.forEach(x => tagTone(x) !== 'ok' && tagTone(x) !== 'info' && sig.push([tagTone(x), `Tool “${T.name}”: ${x}`])); if (M) M.tags.forEach(x => tagTone(x) === 'crit' && sig.push(['crit', `MCP server ${M.name}: ${x}`])); });
    a.skills.forEach(s => SKILLS[s].tags.forEach(x => tagTone(x) !== 'ok' && tagTone(x) !== 'info' && sig.push([tagTone(x), `Skill “${SKILLS[s].name}”: ${x}`])));
    a.data.forEach(d => DATA[d].tags.forEach(x => tagTone(x) !== 'ok' && tagTone(x) !== 'info' && sig.push([tagTone(x), `Data “${DATA[d].name}”: ${x}`])));
    a.models.forEach(m => MODELS[m].tags.forEach(x => tagTone(x) !== 'ok' && tagTone(x) !== 'info' && sig.push([tagTone(x), `Model ${MODELS[m].name}: ${x}`])));
    S.incidents.filter(i => i.agent === a.id).forEach(i => sig.push([isOpenInc(i) ? 'crit' : 'info', `${i.id}: ${i.title} (${i.status.toLowerCase()})`]));
    return `<div class="grid g-2"><section class="panel"><h2>Score breakdown <span class="right muted">Weighted 25 / 25 / 20 / 15 / 15</span></h2><div class="dims">${D.map(([k, l, d]) => `<div class="dim"><span><b style="font-weight:500">${l}</b><br><small class="muted">${d}</small></span><span class="track"><i style="width:${a.scores[k]}%;background:${toneVar(scoreTone(a.scores[k]))}"></i></span><b class="num">${a.scores[k]}</b></div>`).join('')}</div></section>
      <section class="panel"><h2>Signals affecting the score</h2><div class="list">${sig.map(([t, s]) => `<div class="li"><span class="sev ${t}"></span><span class="grow">${esc(s)}</span></div>`).join('') || '<div class="empty">No negative signals.</div>'}</div></section></div>`;
  }
  if (agentTab === 'access') {
    return `<div class="grid g-2"><section class="panel"><h2>Who uses it</h2><div class="list">${a.users.groups.map(g => `<div class="li"><span class="grow"><b>${esc(g)}</b></span></div>`).join('')}</div><p class="small muted" style="margin-bottom:0">${fmt(a.users.count)} distinct users in the last 30 days.</p></section>
      <section class="panel"><h2>Runs as</h2><dl class="kv"><dt>Identity</dt><dd class="mono">${a.platform === 'bedrock' ? `arn:aws:iam::…:role/${a.name.toLowerCase().replace(/[^a-z]+/g, '-')}` : a.platform === 'vertex' ? `${a.name.toLowerCase().replace(/[^a-z]+/g, '-').slice(0, 24)}@…iam.gserviceaccount.com` : 'Platform agent user'}</dd><dt>Owner</dt><dd>${esc(a.owner)}<br><span class="muted small">${esc(a.ownerRole)}</span></dd><dt>Autonomy</dt><dd>${esc(a.autonomy)}</dd><dt>Version</dt><dd class="mono">${esc(a.version)}</dd></dl></section></div>
      <div class="tbl-wrap" style="margin-top:16px"><table><thead><tr><th>Tool permission</th><th>Action</th><th>Data</th><th>Served by</th><th>Tags</th></tr></thead><tbody>${a.tools.map(t => { const T = TOOLS[t]; return `<tr><td><b style="font-weight:500">${esc(T.name)}</b></td><td>${chip(T.action, T.action === 'Write' || T.action === 'Decide' ? 'warn' : 'info')}</td><td class="small">${esc(T.data)}</td><td class="small">${T.via === 'native' ? 'Native' : esc(MCP[T.via].name)}</td><td>${tagChips(T.tags)}</td></tr>`; }).join('')}</tbody></table></div>`;
  }
  if (agentTab === 'compliance') {
    const g = reviewFromAgent('x', a).guardrails;
    return `<div class="grid g-2"><section class="panel"><h2>Obligations</h2><div class="list">${a.regs.map(r => `<div class="li"><span class="sev ${a.status === 'Shadow' ? 'crit' : 'ok'}"></span><span class="grow"><b>${esc(REGS[r])}</b><small>${a.status === 'Shadow' ? 'No evidence: unregistered' : 'Mapped to controls · evidence current'}</small></span></div>`).join('')}</div></section>
      <section class="panel"><h2>AU AI Safety Standard guardrails</h2><div class="gr" style="grid-template-columns:repeat(2,minmax(0,1fr))">${GUARDRAILS.map((x, i) => `<span class="${g[i] ? 'y' : 'n'}">${g[i] ? '✓' : '✕'} ${esc(x)}</span>`).join('')}</div></section></div>`;
  }
  const ev = S.audit.filter(e => e.ref === a.id || e.text.includes(a.name) || S.incidents.some(i => i.agent === a.id && i.id === e.ref));
  return `<div class="tbl-wrap"><table><thead><tr><th>Time</th><th>Actor</th><th>Type</th><th>Event</th></tr></thead><tbody>${ev.map(e => `<tr><td class="mono">${esc(e.ts)}</td><td class="small">${esc(e.actor)}</td><td>${chip(e.type, 'info')}</td><td>${esc(e.text)}</td></tr>`).join('') || '<tr><td colspan="4" class="empty">No events yet.</td></tr>'}</tbody></table></div>`;
}

const GCOL = { agent: null, model: '#7A5BC7', skill: '#2E66C7', tool: '#1F9D6B', data: '#C98A1B', mcp: '#53667A', origin: '#9AA5B1', peer: null };
function baseElements(a) {
  const els = [], seen = new Set();
  const node = (id, label, type, ref, level, tags) => { if (seen.has(id)) return; seen.add(id); els.push({ data: { id, label, type, ref, level, risk: riskOf(tags || []) } }); };
  const edge = (s, t, label) => { const id = s + '>' + t; if (seen.has(id)) return; seen.add(id); els.push({ data: { id, source: s, target: t, label } }); };
  node('ag', a.name, 'agent', a.id, 4, a.status === 'Shadow' ? ['Unregistered'] : []);
  a.models.forEach(m => { node('m:' + m, MODELS[m].name, 'model', m, 3, MODELS[m].tags); edge('ag', 'm:' + m, 'reasons with'); });
  a.skills.forEach(s => { node('s:' + s, SKILLS[s].name, 'skill', s, 3, SKILLS[s].tags); edge('ag', 's:' + s, 'has skill'); });
  a.tools.forEach(t => { node('t:' + t, TOOLS[t].name, 'tool', t, 3, TOOLS[t].tags); edge('ag', 't:' + t, 'calls'); });
  a.data.forEach(d => { node('d:' + d, DATA[d].name, 'data', d, 3, DATA[d].tags); edge('ag', 'd:' + d, 'reads'); });
  a.a2a.forEach(p => { const P = agentById(p); node('p:' + p, P ? P.name : p, 'peer', p, 3, P && P.status === 'Shadow' ? ['Unregistered'] : []); edge('ag', 'p:' + p, 'A2A'); });
  return els;
}
function expandNode(n, a, noLayout) {
  const d = n.data(), add = [];
  const has = id => cy.getElementById(id).length > 0;
  const node = (id, label, type, ref, level, tags) => { if (!has(id) && !add.some(x => x.data.id === id)) add.push({ data: { id, label, type, ref, level, risk: riskOf(tags || []) } }); };
  const edge = (s, t, label) => { const id = s + '>' + t; if (!has(id) && !add.some(x => x.data.id === id)) add.push({ data: { id, source: s, target: t, label } }); };
  if (d.type === 'tool') {
    const T = TOOLS[d.ref];
    if (T.via === 'native') { node('o:' + a.platform, PLATFORMS[a.platform].name, 'origin', a.platform, 2); edge(d.id, 'o:' + a.platform, 'native to'); }
    else { const M = MCP[T.via]; node('x:' + T.via, M.name, 'mcp', T.via, 2, M.tags); edge(d.id, 'x:' + T.via, 'served by'); node('o:' + M.host, PLATFORMS[M.host].name, 'origin', M.host, 1); edge('x:' + T.via, 'o:' + M.host, 'hosted on'); node('pub:' + M.publisher, M.publisher, 'origin', M.publisher, 1); edge('x:' + T.via, 'pub:' + M.publisher, 'published by'); }
  } else if (d.type === 'skill') {
    const K = SKILLS[d.ref]; node('lib:' + K.library, K.library, 'origin', K.library, 2); edge(d.id, 'lib:' + K.library, 'from v' + K.version); node('pub:' + K.publisher, K.publisher, 'origin', K.publisher, 1); edge('lib:' + K.library, 'pub:' + K.publisher, 'maintained by');
  } else if (d.type === 'data') {
    const D = DATA[d.ref]; node('dp:' + D.platform, D.platform, 'origin', D.platform, 2); edge(d.id, 'dp:' + D.platform, 'stored in');
  } else if (d.type === 'model') {
    const M = MODELS[d.ref]; node('mp:' + M.provider, M.provider, 'origin', M.provider, 2); edge(d.id, 'mp:' + M.provider, 'provided by'); node('o:' + M.host, M.region, 'origin', M.host, 1); edge('mp:' + M.provider, 'o:' + M.host, 'served in');
  } else if (d.type === 'mcp') {
    const M = MCP[d.ref]; node('o:' + M.host, PLATFORMS[M.host].name, 'origin', M.host, 1); edge(d.id, 'o:' + M.host, 'hosted on');
  }
  if (add.length) { cy.add(add); if (!noLayout) layout(); }
}
function layout(fitOnly) {
  if (!cy) return;
  cy.layout({ name: 'concentric', concentric: n => n.data('level'), levelWidth: () => 1, minNodeSpacing: 46, animate: !fitOnly, animationDuration: 380, padding: 36, startAngle: 3.4 }).run();
}
function cssVar(n) { return getComputedStyle(document.documentElement).getPropertyValue(n).trim() || '#888'; }
function mountAgent(id) {
  const a = agentById(id); if (!a || agentTab !== 'graph') return;
  const el = $('#cy'); if (!el) return;
  if (typeof cytoscape === 'undefined') { el.innerHTML = '<div class="empty">Graph library could not load. Check your connection.</div>'; return; }
  const acc = cssVar('--accent'), ink = cssVar('--ink'), muted = cssVar('--muted'), line = cssVar('--line'), surf = cssVar('--surface'), crit = cssVar('--crit'), warn = cssVar('--warn');
  cy = cytoscape({ container: el, elements: baseElements(a), wheelSensitivity: 0.25, minZoom: .3, maxZoom: 1.25,
    style: [
      { selector: 'node', style: { 'background-color': n => GCOL[n.data('type')] || acc, 'label': 'data(label)', 'font-family': 'IBM Plex Sans, system-ui, sans-serif', 'font-size': 10.5, 'color': ink, 'text-valign': 'bottom', 'text-margin-y': 6, 'text-wrap': 'wrap', 'text-max-width': 112, 'width': 26, 'height': 26, 'border-width': 3, 'border-color': surf, 'text-background-color': surf, 'text-background-opacity': .85, 'text-background-padding': 2, 'text-background-shape': 'roundrectangle' } },
      { selector: 'node[type="agent"]', style: { 'width': 58, 'height': 58, 'font-size': 12.5, 'font-weight': 600, 'shape': 'round-rectangle', 'background-color': acc } },
      { selector: 'node[type="peer"]', style: { 'background-color': surf, 'border-color': acc, 'border-width': 3, 'shape': 'round-rectangle', 'width': 34, 'height': 34 } },
      { selector: 'node[type="origin"]', style: { 'shape': 'round-rectangle', 'width': 22, 'height': 22, 'font-size': 10, 'color': muted } },
      { selector: 'node[type="mcp"]', style: { 'shape': 'hexagon', 'width': 30, 'height': 30 } },
      { selector: 'node[risk="crit"]', style: { 'border-color': crit, 'border-width': 3.5 } },
      { selector: 'node[risk="warn"]', style: { 'border-color': warn, 'border-width': 3 } },
      { selector: 'edge', style: { 'width': 1.4, 'line-color': line, 'target-arrow-color': line, 'target-arrow-shape': 'triangle', 'arrow-scale': .7, 'curve-style': 'bezier', 'label': 'data(label)', 'font-size': 8.5, 'color': muted, 'text-rotation': 'autorotate', 'text-opacity': 0, 'text-background-color': surf, 'text-background-opacity': 1, 'text-background-padding': 2 } },
      { selector: '.faded', style: { 'opacity': .22 } },
      { selector: 'edge.hl', style: { 'line-color': acc, 'target-arrow-color': acc, 'width': 2.2, 'text-opacity': 1 } },
      { selector: 'node:selected', style: { 'overlay-color': acc, 'overlay-opacity': .14, 'overlay-padding': 8 } },
    ] });
  layout(true);
  cy.on('tap', 'node', e => {
    const n = e.target; expandNode(n, a);
    cy.elements().addClass('faded'); cy.edges().removeClass('hl');
    const nb = n.closedNeighborhood().union(n.predecessors()).union(n.successors());
    nb.removeClass('faded'); n.connectedEdges().addClass('hl'); n.successors('edge').addClass('hl'); n.predecessors('edge').addClass('hl');
    $('#inspector').innerHTML = inspectNode(n.data(), a);
  });
  cy.on('tap', e => { if (e.target === cy) { cy.elements().removeClass('faded'); cy.edges().removeClass('hl'); $('#inspector').innerHTML = inspectAgent(a); } });
}
function inspectAgent(a) {
  return `<span class="type">Agent</span><h3>${esc(a.name)}</h3><div class="chips" style="margin:6px 0 12px">${statusChip(a.status)}</div>
    <dl class="kv"><dt>Models</dt><dd>${a.models.map(m => esc(MODELS[m].name)).join(', ')}</dd><dt>Skills</dt><dd>${a.skills.length}</dd><dt>Tools</dt><dd>${a.tools.length} (${a.tools.filter(t => /Write|Decide/.test(TOOLS[t].action)).length} can change data)</dd><dt>Data</dt><dd>${a.data.map(d => esc(DATA[d].cls)).join(', ')}</dd><dt>Talks to</dt><dd>${a.a2a.map(p => agentById(p) ? esc(agentById(p).name) : p).join(', ') || 'No other agents'}</dd>${a.card ? `<dt>Agent card</dt><dd class="mono">${esc(a.card)}</dd>` : ''}</dl>
    <p class="small muted">Nodes with a red ring carry a risk flag. Click any node to see its tags and trace it back to its source.</p>`;
}
function inspectNode(d, a) {
  const lineage = steps => `<h4 class="small muted" style="text-transform:uppercase;letter-spacing:.07em;font-weight:500;margin:16px 0 0">Comes from</h4><div class="lineage">${steps.map(([b, s]) => `<div><b style="font-weight:500">${esc(b)}</b><small>${esc(s)}</small></div>`).join('')}</div>`;
  if (d.type === 'agent') return inspectAgent(a);
  if (d.type === 'tool') { const T = TOOLS[d.ref], M = MCP[T.via];
    return `<span class="type">Tool · ${esc(T.action)}</span><h3>${esc(T.name)}</h3><div style="margin:8px 0">${tagChips(T.tags)}</div><dl class="kv"><dt>Tool ID</dt><dd class="mono">${d.ref}</dd><dt>Data</dt><dd>${esc(T.data)}</dd></dl>` +
      (M ? lineage([[M.name, `MCP server · ${M.auth}`], [M.publisher, 'Publisher'], [PLATFORMS[M.host].name, M.endpoint]]) + `<div style="margin-top:10px">${tagChips(M.tags)}</div>` : lineage([[PLATFORMS[a.platform].name, 'Built-in platform action']])); }
  if (d.type === 'skill') { const K = SKILLS[d.ref];
    return `<span class="type">Skill</span><h3>${esc(K.name)}</h3><div style="margin:8px 0">${tagChips(K.tags)}</div><dl class="kv"><dt>Version</dt><dd class="mono">${esc(K.version)}</dd></dl>` + lineage([[K.library, 'Skill library'], [K.publisher, 'Maintainer']]); }
  if (d.type === 'data') { const D = DATA[d.ref];
    return `<span class="type">Data source</span><h3>${esc(D.name)}</h3><div style="margin:8px 0">${tagChips(D.tags)}</div><dl class="kv"><dt>Class</dt><dd>${esc(D.cls)}</dd><dt>Context use</dt><dd>${D.tags.includes('Clean') || D.tags.includes('Trusted') ? 'Trusted for grounding' : 'Not cleared as trusted context'}</dd></dl>` + lineage([[D.platform, 'System holding the data']]); }
  if (d.type === 'model') { const M = MODELS[d.ref];
    return `<span class="type">Model · ${esc(M.type)}</span><h3>${esc(M.name)}</h3><div style="margin:8px 0">${tagChips(M.tags)}</div><dl class="kv"><dt>Region</dt><dd>${esc(M.region)}</dd><dt>Licence</dt><dd>${esc(M.license || 'Commercial terms')}</dd></dl>` + lineage([[M.provider, 'Model provider'], [PLATFORMS[M.host].name, M.region]]); }
  if (d.type === 'mcp') { const M = MCP[d.ref];
    return `<span class="type">MCP server</span><h3>${esc(M.name)}</h3><div style="margin:8px 0">${tagChips(M.tags)}</div><dl class="kv"><dt>Endpoint</dt><dd class="mono">${esc(M.endpoint)}</dd><dt>Auth</dt><dd>${esc(M.auth)}</dd><dt>Publisher</dt><dd>${esc(M.publisher)}</dd><dt>Tools</dt><dd>${Object.keys(TOOLS).filter(t => TOOLS[t].via === d.ref).map(t => esc(TOOLS[t].name)).join(', ')}</dd></dl>`; }
  if (d.type === 'peer') { const P = agentById(d.ref);
    return `<span class="type">Peer agent (A2A)</span><h3>${esc(P ? P.name : d.ref)}</h3>${P ? `<div class="chips" style="margin:6px 0 12px">${statusChip(P.status)}</div><p class="small">${esc(P.desc)}</p><dl class="kv"><dt>Platform</dt><dd>${esc(PLATFORMS[P.platform].name)}</dd><dt>Trust</dt><dd>${P.status === 'Shadow' ? 'n/a' : trust(P)}</dd></dl><a class="btn sm" href="#agent-${P.id}">Open agent</a>` : '<p class="small muted">Not yet in the registry. Scan the landscape it runs in.</p>'}`; }
  return `<span class="type">Origin</span><h3>${esc(d.label)}</h3><p class="small muted">Where the connected asset comes from.</p>`;
}

/* ======================================================================
   REVIEWS
   ====================================================================== */
function precheck(r) {
  const f = [];
  if (r.customerFacing && /L3/.test(r.autonomy) && /none/i.test(r.hitl)) f.push(['crit', 'Customer-facing agent acts on its own with no human oversight proposed']);
  const miss = r.guardrails.map((v, i) => v ? null : GUARDRAILS[i].split(' ')[0]).filter(Boolean);
  if (miss.length) f.push([miss.length > 2 ? 'crit' : 'warn', `No evidence for guardrails ${miss.join(', ')}`]);
  if (r.pia !== 'Completed' && r.pia !== 'Not required') f.push(['warn', `Privacy impact assessment: ${r.pia.toLowerCase()}`]);
  if (r.evals.groundedness == null) f.push(['warn', 'No evaluation results submitted yet']);
  if (r.evals.redteam != null && r.evals.redteam < 90) f.push(['warn', `Red-team pass rate ${r.evals.redteam}% is below the 90% bar`]);
  if (r.evals.bias === 'Not run' && r.customerFacing) f.push(['warn', 'Bias testing not run for a customer-facing agent']);
  if (/Material|assessed/.test(r.cps230)) f.push(['info', 'May support a CPS 230 material service: Operational Risk sign-off needed']);
  if (r.source === 'Scan') f.push(['info', 'Found by scan already running in production without intake approval']);
  if (!f.length) f.push(['ok', 'All intake checks passed']);
  return f;
}
function viewReviews() {
  const list = S.reviews.filter(r => UI.revFilter === 'All' || (UI.revFilter === 'Pending' ? r.status === 'Pending' : r.status !== 'Pending'));
  if (!UI.revSel || !S.reviews.find(r => r.id === UI.revSel)) UI.revSel = (list[0] || {}).id;
  const r = S.reviews.find(x => x.id === UI.revSel);
  const q = list.map(x => `<button class="${x.id === UI.revSel ? 'on' : ''}" data-rev="${x.id}">${pt(x.platform, 'sm')}<span class="grow"><b>${esc(x.agent)}</b><small>${x.id} · ${esc(x.submitter)} · ${x.source === 'Scan' ? 'from scan' : 'submitted ' + x.submitted.slice(5)}</small></span>${x.status === 'Pending' ? riskChip(x.risk) : statusChip(x.status)}</button>`).join('') || '<div class="empty">Queue is clear.</div>';
  return `<div class="ph"><div><h1>Review workbench</h1><p>New agents and changes waiting for GRC sign-off. Decisions update the registry and are written to the audit log.</p></div></div>
    <div class="wb"><div class="queue"><div class="qhead"><span class="seg">${['Pending', 'Decided', 'All'].map(k => `<button data-revf="${k}" class="${UI.revFilter === k ? 'on' : ''}">${k}${k === 'Pending' ? ` (${S.reviews.filter(x => x.status === 'Pending').length})` : ''}</button>`).join('')}</span></div>${q}</div>
    <div class="stack">${r ? reviewDetail(r) : '<div class="panel empty">Select a review.</div>'}</div></div>`;
}
function reviewDetail(r) {
  const days = Math.round((new Date(r.due) - new Date('2026-10-29')) / 864e5);
  const pc = precheck(r), a = r.agentId && agentById(r.agentId);
  const ev = r.evals;
  return `<section class="panel"><div class="row" style="align-items:flex-start;flex-wrap:nowrap">${pt(r.platform, 'lg')}<div style="flex:1;min-width:0"><div class="muted small">${r.id} · ${esc(PLATFORMS[r.platform].name)}</div><h2 style="font-family:var(--f-display);font-size:20px;margin:2px 0 6px">${esc(r.agent)}</h2><div class="chips">${riskChip(r.risk)}${r.customerFacing ? chip('Customer-facing', 'info') : chip('Internal')}${r.status === 'Pending' ? chip(days <= 2 ? `Due in ${days} day${days === 1 ? '' : 's'}` : `Due ${r.due.slice(8)}/${r.due.slice(5, 7)}`, days <= 2 ? 'crit' : 'info') : statusChip(r.status)}${r.source === 'Scan' ? chip('Discovered by scan', 'acc') : ''}</div></div>${a ? `<a class="btn sm" href="#agent-${a.id}">${ICON.catalog} View graph</a>` : ''}</div></section>
    <section class="panel"><h2>${ICON.shield.replace('<svg', '<svg width="16" height="16"')} Nexus pre-check</h2><div class="list">${pc.map(([t, s]) => `<div class="li" style="padding:7px 0"><span class="sev ${t}"></span><span class="grow">${esc(s)}</span></div>`).join('')}</div></section>
    <div class="form-grid">
      <div class="full"><small>Purpose</small>${esc(r.purpose)}</div>
      <div><small>Business unit</small>${esc(r.bu)}</div><div><small>Submitted by</small>${esc(r.submitter)} · ${esc(r.submitted)}</div>
      <div><small>Autonomy level</small>${esc(r.autonomy)}</div><div><small>Human oversight</small>${esc(r.hitl)}</div>
      <div><small>Model</small>${esc(r.model)}</div><div><small>Data classes</small><div class="chips">${r.dataCls.map(c => chip(c, /PII|PCI|Financial/.test(c) ? 'warn' : 'info')).join('')}</div></div>
      <div><small>Tools requested</small>${r.tools.map(esc).join('<br>')}</div><div><small>Data accessed</small>${r.data.map(esc).join('<br>')}</div>
      <div><small>Privacy impact assessment</small>${statusChip(r.pia === 'Completed' || r.pia === 'Not required' ? 'Done' : r.pia === 'In progress' ? 'In progress' : 'Open').replace(/>(Done|In progress|Open)</, '>' + esc(r.pia) + '<')}</div><div><small>CPS 230 materiality</small>${esc(r.cps230)}</div>
    </div>
    <section class="panel"><h2>Evaluation results</h2><div class="evals">
      <div><b style="color:${ev.groundedness == null ? 'var(--muted)' : toneVar(ev.groundedness >= 92 ? 'ok' : 'warn')}">${ev.groundedness == null ? '—' : ev.groundedness + '%'}</b><small>Groundedness</small></div>
      <div><b style="color:${ev.redteam == null ? 'var(--muted)' : toneVar(ev.redteam >= 90 ? 'ok' : 'warn')}">${ev.redteam == null ? '—' : ev.redteam + '%'}</b><small>Red-team pass</small></div>
      <div><b style="color:${ev.jailbreak == null ? 'var(--muted)' : toneVar(ev.jailbreak >= 95 ? 'ok' : 'warn')}">${ev.jailbreak == null ? '—' : ev.jailbreak + '%'}</b><small>Jailbreak resistance</small></div>
      <div><b style="color:${ev.bias === 'Pass' ? 'var(--ok)' : ev.bias === 'n/a' ? 'var(--muted)' : 'var(--warn)'}">${esc(ev.bias)}</b><small>Bias testing</small></div></div></section>
    <section class="panel"><h2>AI Safety Standard evidence</h2><div class="gr">${GUARDRAILS.map((g, i) => `<span class="${r.guardrails[i] ? 'y' : 'n'}">${r.guardrails[i] ? '✓' : '✕'} ${esc(g)}</span>`).join('')}</div></section>
    ${r.notes.length ? `<section class="panel"><h2>Decision history</h2><div class="stack" style="gap:8px">${r.notes.map(n => `<div class="note"><b>${esc(n.decision)}</b> · ${esc(n.by)} · ${esc(n.ts)}${n.text ? `<br>${esc(n.text)}` : ''}</div>`).join('')}</div></section>` : ''}
    ${r.status === 'Pending' ? `<div class="decision"><label for="revNote" class="small" style="font-weight:500">Comments and conditions</label><textarea id="revNote" placeholder="Required when sending back or rejecting. Conditions are attached to the approval."></textarea><div id="revErr" class="small" style="color:var(--crit)" hidden>Add a comment so the submitter knows what to change.</div>
      <div class="row"><button class="btn primary" data-dec="Approved">${ICON.check} Approve</button><button class="btn" data-dec="Approved with conditions">Approve with conditions</button><button class="btn warn" data-dec="Sent back">Send back for more work</button><button class="btn danger" data-dec="Rejected">Reject</button></div></div>` : ''}`;
}
function decide(dec) {
  const r = S.reviews.find(x => x.id === UI.revSel); const txt = ($('#revNote').value || '').trim();
  if ((dec === 'Sent back' || dec === 'Rejected' || dec === 'Approved with conditions') && !txt) { $('#revErr').hidden = false; $('#revNote').focus(); return; }
  r.status = dec; r.notes.push({ decision: dec, by: ME.name, ts: nowStamp(), text: txt });
  const a = r.agentId && agentById(r.agentId);
  if (a) { a.status = dec === 'Rejected' ? 'Suspended' : dec === 'Sent back' ? 'Sent back' : dec; if (dec.startsWith('Approved')) { a.scores.gov = Math.max(a.scores.gov, 80); } }
  audit(ME.name, 'Review', `${r.id} ${r.agent}: ${dec.toLowerCase()}${txt ? ' — ' + txt : ''}`, r.id);
  save(); toast(`${r.agent}: ${dec.toLowerCase()}`);
  const next = S.reviews.find(x => x.status === 'Pending'); UI.revSel = next ? next.id : r.id;
  if (location.hash !== '#reviews') go('reviews'); else rerender();
}

/* ======================================================================
   INCIDENTS
   ====================================================================== */
function viewIncidents() {
  const I = S.incidents;
  const open = I.filter(i => i.status === 'Open').length, cont = I.filter(i => i.status === 'Contained').length, rem = I.filter(i => i.status === 'Remediated' || i.status === 'Closed').length;
  return `<div class="ph"><div><h1>Incidents &amp; cases</h1><p>AI failures tracked from detection to remediation, with root cause, controls and evidence ready for auditors.</p></div></div>
    <div class="grid g-kpi" style="grid-template-columns:repeat(4,minmax(0,1fr));margin-bottom:16px">
      <div class="kpi alert" style="cursor:default"><span class="lbl">Open</span><span class="val">${open}</span><span class="sub">Investigating</span></div>
      <div class="kpi warnk" style="cursor:default"><span class="lbl">Contained</span><span class="val">${cont}</span><span class="sub">Harm stopped, fix pending</span></div>
      <div class="kpi" style="cursor:default"><span class="lbl">Remediated</span><span class="val" style="color:var(--ok)">${rem}</span><span class="sub">Controls verified</span></div>
      <div class="kpi" style="cursor:default"><span class="lbl">Median time to contain</span><span class="val">3.2<small style="font-size:14px"> h</small></span><span class="sub">Last 90 days</span></div></div>
    <div class="tbl-wrap"><table><thead><tr><th>Case</th><th>Agent</th><th>Category</th><th>Severity</th><th>Status</th><th>Opened</th><th>Owner</th></tr></thead><tbody>${I.map(i => { const a = i.agent && agentById(i.agent);
      return `<tr class="click" data-href="#incident-${i.id}"><td><b style="font-weight:500">${esc(i.title)}</b><br><span class="mono muted">${i.id}</span></td><td><div class="row" style="flex-wrap:nowrap">${pt(a ? a.platform : i.platform, 'sm')}<span class="small">${a ? esc(a.name) : 'Unregistered tool'}</span></div></td><td class="small">${esc(i.category)}</td><td>${sevChip(i.sev)}</td><td>${statusChip(i.status)}</td><td class="mono">${esc(i.opened)}</td><td class="small">${esc(i.owner)}</td></tr>`; }).join('')}</tbody></table></div>`;
}
const NEXT_STATE = { Open: ['Contained', 'Mark contained'], Contained: ['Remediated', 'Mark remediated'], Remediated: ['Closed', 'Close case'] };
function viewIncident(id) {
  const i = S.incidents.find(x => x.id === id);
  if (!i) return `<div class="empty">Case ${esc(id)} not found. <a href="#incidents">Back to incidents</a></div>`;
  const a = i.agent && agentById(i.agent), nx = NEXT_STATE[i.status];
  return `<div class="crumbs"><a href="#incidents">Incidents</a><span>/</span><span>${i.id}</span></div>
    <div class="ph"><div><div class="chips" style="margin-bottom:6px">${sevChip(i.sev)}${statusChip(i.status)}&nbsp;${chip(i.category, 'info')}</div><h1>${esc(i.title)}</h1><p class="small muted">${i.id} · opened ${esc(i.opened)}${i.closed ? ' · closed ' + esc(i.closed) : ''} · owner ${esc(i.owner)}</p></div>
      <div class="actions"><button class="btn" data-act="pack" data-id="${i.id}">${ICON.audit} Add to auditor pack</button>${nx ? `<button class="btn primary" data-act="advance" data-id="${i.id}">${ICON.check} ${nx[1]}</button>` : ''}</div></div>
    <div class="grid g-2">
      <div class="stack">
        <section class="panel prose"><h3>What happened</h3><p>${esc(i.summary)}</p><h3>Impact</h3><p>${esc(i.impact)}</p><h3>Root cause</h3><p>${esc(i.rootCause)}</p><h3>Public precedent</h3><div class="precedent">${esc(i.precedent)}</div></section>
        <section class="panel" style="padding:0"><h2 style="padding:16px 18px 4px">Remediation actions <span class="right muted">Click a status to update</span></h2><div style="overflow-x:auto"><table><thead><tr><th>Action</th><th>Owner</th><th>Status</th></tr></thead><tbody>${i.actions.map((x, k) => `<tr><td>${esc(x[0])}</td><td class="small">${esc(x[2])}</td><td><button class="btn sm" data-act="action" data-id="${i.id}" data-k="${k}">${statusChip(x[1])}</button></td></tr>`).join('')}</tbody></table></div></section>
      </div>
      <div class="stack">
        ${a ? `<a class="panel" href="#agent-${a.id}" style="text-decoration:none;color:inherit"><h2>Linked agent</h2><div class="row" style="flex-wrap:nowrap">${pt(a.platform)}<span style="flex:1"><b style="display:block;font-weight:500">${esc(a.name)}</b><small class="muted">${esc(a.bu)} · ${esc(a.owner)}</small></span>${statusChip(a.status)}</div></a>` : `<section class="panel"><h2>Source</h2><div class="row">${pt(i.platform || 'browser')}<span><b style="font-weight:500">${esc(PLATFORMS[i.platform || 'browser'].name)}</b><br><small class="muted">Unregistered consumer AI service</small></span></div></section>`}
        <section class="panel"><h2>Timeline</h2><div class="timeline">${i.timeline.map((t, k) => `<div class="tl"><span class="when">${esc(t[0])}</span><span class="rail"><i></i>${k < i.timeline.length - 1 ? '<span></span>' : ''}</span><span class="what">${esc(t[1])}</span></div>`).join('')}</div></section>
        <section class="panel"><h2>Controls mapped</h2><div class="chips">${i.controls.map(c => chip(c, 'info')).join('')}</div></section>
        <section class="panel"><h2>Evidence</h2><div class="list">${i.evidence.map(e => `<div class="li"><span style="color:var(--muted)">${ICON.audit.replace('<svg', '<svg width="16" height="16"')}</span><span class="grow">${esc(e)}<small class="mono">sha256 ${hash(e)}${hash(e + i.id).slice(0, 8)}…</small></span></div>`).join('')}</div></section>
      </div></div>`;
}

/* ======================================================================
   AUDIT LOG
   ====================================================================== */
function viewAudit() {
  const q = UI.auditQ.toLowerCase();
  const list = S.audit.filter(e => (UI.auditType === 'All' || e.type === UI.auditType) && (!q || (e.text + e.actor + e.ref).toLowerCase().includes(q)));
  const refHref = r => /^A\d|^S\d|^G\d/.test(r) ? '#agent-' + r : /^INC-/.test(r) ? '#incident-' + r : /^R-/.test(r) && S.reviews.find(x => x.id === r) ? '#review-' + r : '';
  return `<div class="ph"><div><h1>Audit log</h1><p>A tamper-evident record of every scan, decision, policy change and incident. Each entry is chained to the one before it, so any edit breaks the chain.</p></div>
    <div class="actions"><button class="btn" data-act="verify">${ICON.shield} Verify chain</button><button class="btn primary" data-act="export">${ICON.download} Export auditor pack</button></div></div>
    <div class="filters"><span class="seg">${['All', 'Scan', 'Registry', 'Review', 'Incident', 'Policy'].map(k => `<button data-audt="${k}" class="${UI.auditType === k ? 'on' : ''}">${k}</button>`).join('')}</span><input type="search" id="auditQ" placeholder="Search events" value="${esc(UI.auditQ)}"><span class="verify" id="verifyOut" style="margin-left:auto"></span></div>
    <div class="tbl-wrap"><table><thead><tr><th>Time (AEDT)</th><th>Actor</th><th>Type</th><th>Event</th><th>Reference</th><th>Entry hash</th></tr></thead><tbody>${list.map(e => { const h = refHref(e.ref);
      return `<tr><td class="mono" style="white-space:nowrap">${esc(e.ts)}</td><td class="small">${esc(e.actor)}</td><td>${chip(e.type, e.type === 'Incident' ? 'crit' : e.type === 'Review' ? 'ok' : e.type === 'Scan' ? 'acc' : e.type === 'Policy' ? 'warn' : 'info')}</td><td>${esc(e.text)}</td><td class="mono">${h ? `<a href="${h}">${esc(e.ref)}</a>` : esc(e.ref)}</td><td class="chain" title="prev ${e.prev}">${e.hash}</td></tr>`; }).join('') || '<tr><td colspan="6" class="empty">No matching events.</td></tr>'}</tbody></table></div>`;
}
function verifyChain() {
  let prev = '0000000000000000', ok = true;
  for (let i = S.audit.length - 1; i >= 0; i--) { const e = S.audit[i]; const h = hash(prev + '|' + e.ts + '|' + e.actor + '|' + e.type + '|' + e.text + '|' + (e.ref || '')); if (e.prev !== prev || e.hash !== h) { ok = false; break; } prev = e.hash; }
  return ok;
}
function buildPack() {
  return { tenant: ORG.tenant, organisation: ORG.name, generated: nowStamp() + ' AEDT', generatedBy: ME.name + ', ' + ME.role, period: '2026-07-01 to 2026-10-29',
    frameworks: Object.values(REGS), chainHead: S.audit[0].hash, chainVerified: verifyChain(),
    inventory: S.agents.map(a => ({ id: a.id, name: a.name, platform: PLATFORMS[a.platform].name, owner: a.owner, businessUnit: a.bu, risk: a.risk, status: a.status, trustScore: a.status === 'Shadow' ? null : trust(a), models: a.models.map(m => MODELS[m].name), tools: a.tools.map(t => TOOLS[t].name), dataClasses: uniq(a.data.map(d => DATA[d].cls)) })),
    decisions: S.reviews.filter(r => r.status !== 'Pending').map(r => ({ id: r.id, agent: r.agent, decision: r.status, history: r.notes })),
    incidents: S.incidents.map(i => ({ id: i.id, title: i.title, severity: i.sev, status: i.status, opened: i.opened, closed: i.closed, rootCause: i.rootCause, actions: i.actions.map(x => ({ action: x[0], status: x[1], owner: x[2] })), controls: i.controls })),
    auditLog: S.audit };
}
function openExport() {
  const pack = buildPack(), json = JSON.stringify(pack, null, 2);
  openDrawer(`<header><span>${ICON.download.replace('<svg', '<svg width="22" height="22"')}</span><h2>Auditor pack</h2><button class="btn sm x" data-act="close" aria-label="Close">${ICON.x}</button></header>
    <div class="body"><p style="margin-top:0">Evidence pack for internal audit, APRA or external assurance. Generated from the live registry and signed with the current chain head.</p>
      <div class="scan-stats"><div><b>${pack.inventory.length}</b><small>Agents in inventory</small></div><div><b>${pack.decisions.length}</b><small>Review decisions</small></div><div><b>${pack.incidents.length}</b><small>Incident cases</small></div><div><b>${pack.auditLog.length}</b><small>Audit events</small></div></div>
      <div class="form-grid" style="margin-bottom:14px"><div><small>Period</small>${pack.period}</div><div><small>Chain head</small><span class="mono">${pack.chainHead}</span></div><div><small>Chain integrity</small>${pack.chainVerified ? statusChip('Approved').replace('Approved', 'Verified, no gaps') : statusChip('Rejected').replace('Rejected', 'Broken chain')}</div><div><small>Frameworks</small>${pack.frameworks.length} mapped</div></div>
      <pre class="console" style="height:300px;white-space:pre-wrap">${esc(json.slice(0, 2600))}\n…</pre></div>
    <footer><button class="btn" data-act="copypack">Copy JSON</button><button class="btn primary" data-act="dlpack">${ICON.download} Download JSON</button></footer>`);
  openExport.json = json;
  audit(ME.name, 'Policy', `Auditor pack generated (chain head ${pack.chainHead})`, '');
}

/* ---------- global search ---------- */
function search(q) {
  const box = $('#searchResults'); q = q.trim().toLowerCase();
  if (q.length < 2) { box.hidden = true; return; }
  const res = [];
  S.agents.filter(a => (a.name + a.bu + a.owner).toLowerCase().includes(q)).forEach(a => res.push([pt(a.platform, 'sm'), a.name, 'Agent · ' + a.bu, '#agent-' + a.id]));
  mcpInUse().filter(m => MCP[m].name.toLowerCase().includes(q)).forEach(m => { const u = S.agents.find(a => a.tools.some(t => TOOLS[t].via === m)); res.push([pt(MCP[m].host, 'sm'), MCP[m].name, 'MCP server · used by ' + u.name, '#agent-' + u.id]); });
  Object.keys(TOOLS).filter(t => TOOLS[t].name.toLowerCase().includes(q)).forEach(t => { const u = S.agents.find(a => a.tools.includes(t)); if (u) res.push([pt(u.platform, 'sm'), TOOLS[t].name, 'Tool · ' + u.name, '#agent-' + u.id]); });
  S.incidents.filter(i => (i.id + i.title).toLowerCase().includes(q)).forEach(i => res.push(['<span class="pt sm" style="background:var(--crit)">!</span>', i.title, i.id, '#incident-' + i.id]));
  box.innerHTML = res.slice(0, 10).map(([ic, t, s, h]) => `<button data-href="${h}">${ic}<span><b style="font-weight:500;display:block">${esc(t)}</b><small class="muted">${esc(s)}</small></span></button>`).join('') || '<div class="empty" style="padding:16px">No matches</div>';
  box.hidden = false;
}

/* ---------- events ---------- */
document.addEventListener('click', e => {
  const t = e.target.closest('button, a, tr[data-href], [data-go]');
  if (!t) { if (!e.target.closest('.search')) $('#searchResults').hidden = true; return; }
  if (!t.closest('.search')) $('#searchResults').hidden = true;
  const d = t.dataset;
  if (d.href && t.tagName !== 'A') { location.hash = d.href.slice(1); $('#searchResults').hidden = true; $('#globalSearch').value = ''; return; }
  if (d.go) { if (d.filterRisk || d.filterStatus) { UI.catTab = 'agents'; UI.catRisk = d.filterRisk || ''; UI.catStatus = d.filterStatus || ''; UI.catQ = ''; UI.catPlat = ''; UI.catBU = ''; } go(d.go); return; }
  if (d.sort) { UI.towerSort = d.sort; rerender(); return; }
  if (d.regtab) { UI.regTab = d.regtab; rerender(); return; }
  if (d.cattab) { UI.catTab = d.cattab; rerender(); return; }
  if (d.catview) { UI.catView = d.catview; rerender(); return; }
  if (d.agenttab) { agentTab = d.agenttab; if (cy) { cy.destroy(); cy = null; } $$('[data-agenttab]').forEach(b => b.classList.toggle('on', b === t)); const a = agentById(location.hash.slice(7)); $('#agentTab').innerHTML = agentTabHtml(a); mountAgent(a.id); return; }
  if (d.g && cy) { if (d.g === 'fit') cy.animate({ fit: { padding: 36 } }, { duration: 300 }); if (d.g === 'reset') { const a = agentById(location.hash.slice(7)); cy.elements().remove(); cy.add(baseElements(a)); layout(); $('#inspector').innerHTML = inspectAgent(a); } if (d.g === 'expand') { const a = agentById(location.hash.slice(7)); cy.nodes().forEach(n => { if (['tool', 'skill', 'data', 'model'].includes(n.data('type'))) expandNode(n, a, true); }); cy.elements().removeClass('faded'); layout(); } return; }
  if (d.pick) {
    const k = d.pick, cs = S.connectors.filter(c => c.platform === k);
    if (!cs.length) { toast(`${PLATFORMS[k].name} connector is in the library. This demo tenant scans AWS and Google Cloud.`); return; }
    SC.platform = k; SC.conn = (cs.find(c => c.status === 'new') || cs[0]).id; SC.fromPick = true; SC.step = 2; SC.tested = false; drawScan(); return;
  }
  if (d.rev) { UI.revSel = d.rev; if (location.hash !== '#reviews') { history.replaceState(null, '', '#reviews'); } rerender(); return; }
  if (d.revf) { UI.revFilter = d.revf; UI.revSel = null; if (location.hash !== '#reviews') history.replaceState(null, '', '#reviews'); rerender(); return; }
  if (d.dec) { decide(d.dec); return; }
  if (d.audt) { UI.auditType = d.audt; rerender(); return; }
  switch (d.act) {
    case 'scan': openScan(d.conn); break;
    case 'close': closeDrawer(); if ($('#view')) rerender(); break;
    case 'back': SC.step = SC.step === 2 ? 1 : SC.step - 1; drawScan(); break;
    case 'test': SC.tested = true; drawScan(); break;
    case 'next': SC.step = 3; drawScan(); break;
    case 'start': { const c = S.connectors.find(x => x.id === SC.conn); SC.rescan = c.status !== 'new'; SC.step = 4; SC.lines = []; SC.idx = 0; SC.found = 0; SC.warn = 0; drawScan(); runScan(); break; }
    case 'register': registerScan(); break;
    case 'clearcat': UI.catQ = UI.catPlat = UI.catBU = UI.catRisk = UI.catStatus = ''; rerender(); break;
    case 'suspend': { const a = agentById(d.id); a.status = 'Suspended'; audit(ME.name, 'Registry', `${a.id} ${a.name} suspended; credentials revoked at platform`, a.id); save(); toast(`${a.name} suspended`); rerender(); break; }
    case 'reinstate': { const a = agentById(d.id); a.status = 'Approved with conditions'; audit(ME.name, 'Registry', `${a.id} ${a.name} reinstated with conditions`, a.id); save(); toast(`${a.name} reinstated`); rerender(); break; }
    case 'toreview': { const a = agentById(d.id); const id = 'R-' + (S.seqR++); const r = reviewFromAgent(id, a); r.source = 'Re-review'; r.submitter = ME.name; S.reviews.unshift(r); audit(ME.name, 'Review', `${id} opened: re-review of ${a.name}`, id); save(); UI.revFilter = 'Pending'; go('review-' + id); break; }
    case 'advance': { const i = S.incidents.find(x => x.id === d.id), [n] = NEXT_STATE[i.status]; i.status = n; i.timeline.push([nowStamp(), `Status changed to ${n.toLowerCase()} by ${ME.name}`]); if (n === 'Closed') i.closed = '2026-10-29'; audit(ME.name, 'Incident', `${i.id} ${n.toLowerCase()}`, i.id); save(); toast(`${i.id} ${n.toLowerCase()}`); rerender(); break; }
    case 'action': { const i = S.incidents.find(x => x.id === d.id), x = i.actions[+d.k]; x[1] = x[1] === 'Open' ? 'In progress' : x[1] === 'In progress' ? 'Done' : 'Open'; audit(ME.name, 'Incident', `${i.id} action "${x[0]}" → ${x[1].toLowerCase()}`, i.id); save(); rerender(); break; }
    case 'pack': audit(ME.name, 'Policy', `${d.id} added to auditor pack`, d.id); save(); toast(`${d.id} added to the auditor pack`); break;
    case 'verify': { const ok = verifyChain(); $('#verifyOut').innerHTML = ok ? `${ICON.shield.replace('<svg', '<svg width="16" height="16"')} Chain verified · ${S.audit.length} events · head ${S.audit[0].hash.slice(0, 8)}` : '<span style="color:var(--crit)">Chain broken</span>'; break; }
    case 'export': openExport(); break;
    case 'copypack': { const done = () => toast('Auditor pack copied'); try { navigator.clipboard.writeText(openExport.json).then(done, () => toast('Copy blocked here. Use Download instead.')); } catch (err) { toast('Copy blocked here. Use Download instead.'); } break; }
    case 'dlpack': { try { const b = new Blob([openExport.json], { type: 'application/json' }); const u = URL.createObjectURL(b); const l = document.createElement('a'); l.href = u; l.download = 'harbourline-auditor-pack-2026-10-29.json'; document.body.appendChild(l); l.click(); l.remove(); setTimeout(() => URL.revokeObjectURL(u), 1000); toast('Download started'); } catch (err) { toast('Downloads are blocked in this viewer. Use Copy JSON.'); } break; }
  }
});
document.addEventListener('change', e => {
  const t = e.target;
  if (t.dataset.method) { t.checked ? SC.methods.add(t.dataset.method) : SC.methods.delete(t.dataset.method); return; }
  if (t.id === 'owOnly') { UI.owOnly = t.checked; rerender(); return; }
  if (['catPlat', 'catBU', 'catRisk', 'catStatus'].includes(t.id)) { UI[t.id] = t.value; rerender(); }
});
document.addEventListener('input', e => {
  const t = e.target;
  if (t.id === 'globalSearch') search(t.value);
  if (t.id === 'catQ' || t.id === 'auditQ') { UI[t.id] = t.value; const pos = t.selectionStart; rerender(); const n = $('#' + t.id); if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch (err) {} } }
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') { if (!$('#drawer').hidden) closeDrawer(); $('#searchResults').hidden = true; } });
$('#scrim').addEventListener('click', () => { if (SC && SC.step === 4) return; closeDrawer(); });
$('#resetDemo').addEventListener('click', () => { S = fresh(); save(); agentTab = 'graph'; Object.assign(UI, { catRisk: '', catStatus: '', revSel: null }); toast('Demo reset to the starting state'); go('tower'); });

window.__nexusGraph = () => cy;
route();
})();
