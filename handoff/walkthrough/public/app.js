// The Demo Commander page. It only ever starts a step when the person presses a button (or Next): no auto-advance.
(() => {
  const $ = (id) => document.getElementById(id);
  let content = null;
  let st = null;
  let health = null;
  let selected = 'prepare';
  let view = 'muster';
  // 'live' | 'stopping' | 'stopped' (PLAN.md 14.2 item 4); `modules` = the launcher's modules, from the stopping event.
  let phase = 'live';
  let modules = [];
  let es = null;

  const label = { ok: 'done', failed: 'failed', running: 'running', 'not yet drivable': 'not yet drivable' };
  const cls = { ok: 'ok', failed: 'failed', running: 'running', 'not yet drivable': 'nyd' };

  // Activity: captions and step results stand out; the modules' own log lines are dimmed.
  function feed(line, kind = 'dim') {
    const f = $('feed');
    const div = document.createElement('div');
    div.className = kind;
    div.textContent = line;
    f.appendChild(div);
    while (f.childElementCount > 300) f.removeChild(f.firstChild);
    f.scrollTop = f.scrollHeight;
  }

  /** The module window a step drives ("sim" uses the Muster window); none for Prepare. */
  function windowOfStep(id) {
    if (id === 'prepare') return null;
    const m = stepById(id).module;
    return m === 'sim' ? 'muster' : m;
  }

  function stepById(id) {
    return content.steps.find((s) => s.id === id);
  }

  function statusOf(id) {
    if (st && st.running === id) return 'running';
    const r = st && st.steps[id];
    return r ? r.status : null;
  }

  function canRun(id) {
    if (!health || !st || st.running || st.stopping || phase !== 'live') return false;
    const need = health.steps && health.steps[id];
    if (need ? !need.ready : !health.green) return false;
    if (id !== 'prepare' && !st.prepared) return false;
    return true;
  }

  function waitsOf(id) {
    const need = health && health.steps && health.steps[id];
    return need && !need.ready ? need.waitsOn || [] : [];
  }

  function nextId() {
    if (!st) return 'prepare';
    for (const id of st.order) {
      const s = statusOf(id);
      if (s !== 'ok' && s !== 'not yet drivable') return id;
    }
    return null;
  }

  function renderRail() {
    const rail = $('rail');
    rail.textContent = '';
    // Plan order, with a module heading each time the flow moves to another module.
    const runs = [];
    for (const id of st.order) {
      const mod = stepById(id).module;
      if (!runs.length || runs[runs.length - 1].module !== mod) runs.push({ module: mod, ids: [] });
      runs[runs.length - 1].ids.push(id);
    }
    for (const r of runs) {
      const m = content.modules.find((x) => x.id === r.module);
      const ids = r.ids;
      const g = document.createElement('div');
      g.className = 'group';
      const h = document.createElement('h3');
      h.textContent = m.name;
      h.title = m.blurb;
      g.appendChild(h);
      const ol = document.createElement('ol');
      for (const id of ids) {
        const s = stepById(id);
        const li = document.createElement('li');
        li.className = `step${selected === id ? ' sel' : ''}`;
        const n = document.createElement('span');
        n.className = 'n';
        n.textContent = String(st.order.indexOf(id));
        const t = document.createElement('span');
        t.className = 't';
        t.textContent = s.title;
        const stat = statusOf(id);
        if (stat) {
          const b = document.createElement('span');
          b.className = `badge ${cls[stat] ?? ''}`;
          b.textContent = label[stat] ?? stat;
          t.appendChild(document.createTextNode(' '));
          t.appendChild(b);
        }
        const btn = document.createElement('button');
        btn.textContent = id === 'prepare' ? 'Prepare' : 'Run';
        btn.dataset.step = id;
        btn.disabled = !canRun(id);
        btn.setAttribute('aria-label', `Run step ${st.order.indexOf(id)}: ${s.title}`);
        btn.addEventListener('click', (e) => { e.stopPropagation(); run(id); });
        li.addEventListener('click', () => { selected = id; render(); });
        li.append(n, t, btn);
        const w = waitsOf(id);
        if (w.length && !(st.steps[id] && ['ok', 'not yet drivable'].includes(st.steps[id].status))) {
          const ws = document.createElement('span');
          ws.className = 'waits';
          const values = w.filter((x) => !/^step \d+ first/.test(x));
          ws.textContent = values.length ? `Waits on: ${values.map((x) => x.split(':')[0]).join('; ')}` : `Waits on ${w[w.length - 1]}`;
          li.appendChild(ws);
        }
        ol.appendChild(li);
      }
      g.appendChild(ol);
      rail.appendChild(g);
    }
  }

  function renderText() {
    const s = stepById(selected);
    const idx = st.order.indexOf(selected);
    $('stepTitle').textContent = `${idx}. ${s.title}`;
    const mod = content.modules.find((m) => m.id === s.module);
    const w = windowOfStep(selected);
    $('stepMeta').textContent = `${mod ? mod.name : s.module} · expected time ${s.minutes}${w ? ` · runs in the ${(st.windows.find((x) => x.id === w) || { label: w }).label} window` : ''}`;
    $('purpose').textContent = s.purpose;
    $('what').textContent = s.what;
    $('why').textContent = s.why;
    $('value').textContent = s.value ?? '';
    $('expectBox').hidden = !s.expect;
    $('expect').textContent = s.expect ?? '';
    $('outputsText').textContent = s.outputs;
    const links = $('links');
    links.textContent = '';
    const r = st.steps[selected];
    if (r && r.artifacts) {
      for (const a of r.artifacts) {
        const li = document.createElement('li');
        const link = document.createElement('a');
        link.href = a.url;
        link.target = '_blank';
        link.rel = 'noopener';
        link.textContent = decodeURIComponent(a.url.split('/').pop());
        li.appendChild(link);
        links.appendChild(li);
      }
    }
    const fbox = $('findingsBox');
    const fl = $('findings');
    fl.textContent = '';
    const findings = (r && r.findings) || [];
    fbox.hidden = findings.length === 0;
    for (const f of findings) {
      const li = document.createElement('li');
      li.textContent = `${f.task}: ${f.reason}`;
      fl.appendChild(li);
    }
    const wl = $('waits');
    wl.textContent = '';
    const wt = r && ['ok', 'not yet drivable'].includes(r.status) ? [] : waitsOf(selected);
    $('waitsBox').hidden = wt.length === 0;
    for (const x of wt) {
      const li = document.createElement('li');
      li.textContent = x;
      wl.appendChild(li);
    }
    const nyd = r && r.status === 'not yet drivable';
    $('manualBox').hidden = !(nyd || (r && r.status === 'failed'));
    $('manual').textContent = s.manual;
    const err = $('err');
    err.hidden = !(r && r.error);
    err.textContent = r && r.error ? `${nyd ? 'Not yet drivable' : 'Did not finish'}: ${r.error}` : '';
  }

  function renderHealth() {
    const ul = $('hList');
    ul.textContent = '';
    if (!health) return;
    for (const c of health.checks) {
      const li = document.createElement('li');
      const dot = document.createElement('span');
      dot.className = `dot ${c.status}`;
      const t = document.createElement('span');
      t.textContent = c.label;
      const d = document.createElement('span');
      d.className = 'd';
      d.textContent = c.detail;
      li.append(dot, t, d);
      ul.appendChild(li);
    }
  }

  function renderSetup() {
    const box = $('setup');
    const fields = (health && health.setup) || [];
    const missing = fields.filter((f) => !f.set);
    box.hidden = !(health && health.shape === 'remote' && missing.length > 0);
    if (box.hidden) return;
    const form = $('setupForm');
    if (form.dataset.built === missing.map((f) => f.id).join(',')) return;
    form.dataset.built = missing.map((f) => f.id).join(',');
    form.textContent = '';
    for (const f of fields) {
      const label = document.createElement('label');
      const b = document.createElement('b');
      b.textContent = f.label;
      const stt = document.createElement('span');
      stt.className = `state ${f.set ? 'set' : 'need'}`;
      stt.textContent = f.set ? 'set' : 'needed';
      const input = document.createElement('input');
      input.type = 'password';
      input.name = f.id;
      input.autocomplete = 'off';
      input.placeholder = f.set ? 'set (type to replace)' : 'paste the value';
      const small = document.createElement('small');
      small.textContent = f.owner;
      label.append(b, stt, input, small);
      form.appendChild(label);
    }
    const save = document.createElement('button');
    save.type = 'submit';
    save.className = 'primary';
    save.textContent = 'Save on this machine';
    form.appendChild(save);
  }

  async function submitSetup(e) {
    e.preventDefault();
    const body = {};
    for (const input of $('setupForm').querySelectorAll('input')) {
      if (input.value.trim()) body[input.name] = input.value.trim();
      input.value = '';
    }
    if (!Object.keys(body).length) return;
    const r = await fetch('/setup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const res = await r.json().catch(() => ({}));
    $('setupMsg').textContent = r.ok ? `Saved ${res.saved.length} value(s) in config.local.json on this machine. Health is checked again.` : `Not saved: ${res.error || r.status}`;
    $('setupForm').dataset.built = '';
    await checkHealth();
  }

  function render() {
    if (!content || !st) return;
    if (phase === 'stopped') return;
    $('slug').textContent = st.tenantSlug;
    $('runId').textContent = st.runId;
    $('target').textContent = st.target;
    $('shape').textContent = st.shape === 'remote' ? 'remote addresses' : 'kit ports on this machine';
    renderSetup();
    renderRail();
    renderText();
    renderHealth();
    const done = st.order.filter((id) => ['ok', 'not yet drivable'].includes(statusOf(id))).length;
    $('bar').style.width = `${Math.round((100 * done) / st.order.length)}%`;
    const n = nextId();
    $('nextBtn').disabled = !n || !canRun(n);
    $('nextBtn').textContent = n ? `Next: ${stepById(n).title}` : 'All steps done';
    $('stopBtn').textContent = st.launcher === 'mine' ? 'Stop modules' : 'Close windows, new run';
    $('stopBtn').disabled = Boolean(st.running) || st.stopping || phase !== 'live';
    if (st.stopping || phase === 'stopping') { $('summary').textContent = 'Stopping...'; return; }
    $('summary').textContent = !health ? 'Checking health...' : st.running ? `Running: ${stepById(st.running).title}` : health.green ? 'Ready' : health.shape === 'remote' ? 'Some steps wait on Setup or Health (see each step)' : 'Health is red: fix the items marked red';
  }

  async function refresh() {
    st = await (await fetch('/state')).json();
    render();
  }

  async function checkHealth() {
    if (phase !== 'live') return;
    $('summary').textContent = 'Checking health...';
    health = await (await fetch('/health')).json();
    render();
  }

  async function run(id) {
    if (!canRun(id)) return;
    selected = id;
    const r = await fetch(id === 'prepare' ? '/prepare' : `/step/${encodeURIComponent(id)}`, { method: 'POST' });
    const body = await r.json().catch(() => ({}));
    if (r.status !== 202) feed(`could not start ${id}: ${body.error ?? r.status}${body.red ? `\n  ${body.red.join('\n  ')}` : ''}`, 'res bad');
    await refresh();
  }

  /** The Stop button (PLAN.md 14.2 item 1): one confirm, then POST /stop. */
  async function stopModules() {
    if (!st || st.running || st.stopping || phase !== 'live') return;
    const text = st.launcher === 'mine'
      ? 'Close the four module windows and stop the modules this launcher started? The page goes offline until Start-Mine runs again. Modules the launcher did not start (attached ones) stay up.'
      : 'Close the four module windows and start a new run? The modules keep running: this page did not start them.';
    if (!window.confirm(text)) return;
    const r = await fetch('/stop', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    const body = await r.json().catch(() => ({}));
    if (r.status !== 202 && r.status !== 200) feed(`could not stop: ${body.error ?? r.status}`, 'res bad');
  }

  function hideMirror(text) {
    const img = $('mirror');
    img.hidden = true;
    img.removeAttribute('src');
    $('ph').hidden = false;
    $('ph').textContent = text;
  }

  function enterStopping(list) {
    if (phase !== 'live') return;
    phase = 'stopping';
    if (list && list.length) modules = list;
    hideMirror('Stopping: closing the module windows...');
    if (st) st.stopping = true;
    render();
    $('summary').textContent = 'Stopping...';
  }

  function enterStopped(at) {
    if (phase === 'stopped') return;
    phase = 'stopped';
    if (es) es.close();
    const t = new Date(at || Date.now());
    const hhmm = `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`;
    hideMirror(`Stopped at ${hhmm}: windows closed, modules stopped: ${modules.length ? modules.join(', ') : 'none'}. For a new run: Start-Mine.ps1 (fresh data) or Start-Mine.ps1 -Keep (keep the data).`);
    $('summary').textContent = 'Stopped';
    for (const b of document.querySelectorAll('button')) b.disabled = true;
    $('nextBtn').textContent = 'Stopped';
    // The Health card's dots were measured before the stop; say so instead of showing stale green.
    const ul = $('hList');
    ul.textContent = '';
    const li = document.createElement('li');
    const dot = document.createElement('span');
    dot.className = 'dot unknown';
    const note = document.createElement('span');
    note.textContent = modules.length ? 'Not checked since the stop: the modules listed in the live view are down.' : 'Not checked since the stop.';
    li.append(dot, note);
    ul.appendChild(li);
    feed(`stopped at ${hhmm}`, 'res');
  }

  // Live view: one tab per module window, following the running step's window.
  function renderTabs() {
    const box = $('viewTabs');
    if (box.childElementCount) return;
    for (const w of st.windows) {
      const b = document.createElement('button');
      b.id = `tab-${w.id}`;
      b.textContent = w.label;
      b.setAttribute('aria-pressed', String(w.id === view));
      b.addEventListener('click', () => setView(w.id));
      box.appendChild(b);
    }
  }

  function setView(which) {
    if (!which || which === view) return;
    view = which;
    for (const b of $('viewTabs').querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.id === `tab-${which}`));
    startMirror();
  }

  function startMirror() {
    if (!st || !st.prepared) return;
    const img = $('mirror');
    img.hidden = false;
    $('ph').hidden = true;
    img.src = `/mirror/${view}?t=${Date.now()}`;
  }

  function listen() {
    es = new EventSource('/events');
    // An event stream that breaks while stopping means the server has gone: the stop finished (PLAN.md 14.2 item 4).
    es.onerror = () => { if (phase === 'stopping') enterStopped(); };
    es.onmessage = async (m) => {
      const e = JSON.parse(m.data);
      if (phase === 'stopped') return;
      if (e.type === 'hello') {
        if (e.stopping) enterStopping([]);
      } else if (e.type === 'stopping') {
        feed(e.launcher === 'mine' ? 'stopping: the module windows, then the modules this launcher started' : 'stopping: the module windows (the modules keep running)', 'res');
        enterStopping(e.modules);
      } else if (e.type === 'stopped') {
        if (e.modules) modules = e.modules;
        enterStopped(e.at);
      } else if (e.type === 'reset') {
        phase = 'live';
        hideMirror('The live view starts after Prepare.');
        $('caption').textContent = '';
        feed(`new run ${e.runId}`, 'res');
        await refresh();
        await checkHealth();
      } else if (e.type === 'caption') {
        $('caption').textContent = e.text;
        feed(`» ${e.text}`, 'cap');
      } else if (e.type === 'log') {
        if (/^stop: /.test(e.line)) feed(e.line, 'res');
        else if (!/^step [\w-]+: /.test(e.line)) feed(e.line, 'dim');
      } else if (e.type === 'step') {
        const wasPrepared = st && st.prepared;
        await refresh();
        if (e.status === 'running' && e.window) setView(e.window);
        if (e.status && e.status !== 'running') {
          const t = stepById(e.id);
          feed(`${st.order.indexOf(e.id)}. ${t ? t.title : e.id}: ${label[e.status] ?? e.status} in ${((e.ms || 0) / 1000).toFixed(0)} s${e.error ? ` (${String(e.error).split('\n')[0].slice(0, 200)})` : ''}`, `res ${e.status === 'ok' ? '' : e.status === 'not yet drivable' ? 'nyd' : 'bad'}`);
        }
        if (!wasPrepared && st.prepared) startMirror();
        if (e.status && e.status !== 'running') await checkHealth();
      }
    };
  }

  async function init() {
    content = await (await fetch('/content/steps.json')).json();
    $('foot').innerHTML = '';
    const ul = document.createElement('ul');
    for (const t of content.outOfScope) {
      const li = document.createElement('li');
      li.textContent = t;
      ul.appendChild(li);
    }
    const p = document.createElement('p');
    p.textContent = content.about;
    const folder = document.createElement('p');
    folder.textContent = 'Folder: C:\\ces-nb\\walkthrough';
    $('foot').append(p, ul, folder);
    const terms = $('terms');
    for (const t of content.terms || []) {
      const row = document.createElement('div');
      const dt = document.createElement('dt');
      dt.textContent = t.term;
      const dd = document.createElement('dd');
      dd.textContent = t.meaning;
      row.append(dt, dd);
      terms.appendChild(row);
    }
    $('nextBtn').addEventListener('click', () => { const n = nextId(); if (n) run(n); });
    $('stopBtn').addEventListener('click', () => void stopModules());
    $('recheck').addEventListener('click', () => void checkHealth());
    $('setupForm').addEventListener('submit', (e) => void submitSetup(e));
    await refresh();
    renderTabs();
    await checkHealth();
    if (st.prepared) startMirror();
    listen();
  }

  void init();
})();
