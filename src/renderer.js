const $ = s => document.querySelector(s);
const query = $('#query'), list = $('#results');
let mode = 'all', rows = [], selected = 0, timer, sequence = 0, cursors = {}, settingsOpen = false, scanning = true, lastFileCount = 0;
function message(text = '') { $('#message').textContent = text; }
function empty(title, detail) {
  list.replaceChildren(); const box = document.createElement('div'); box.className = 'empty';
  const icon = document.createElement('span'); icon.className = 'big'; icon.textContent = '⌕';
  const strong = document.createElement('strong'); strong.textContent = title;
  const p = document.createElement('span'); p.textContent = detail; box.append(icon,strong,p); list.append(box);
}
function select(index) {
  selected = Math.max(0, Math.min(rows.length - 1,index));
  list.querySelectorAll('.row').forEach((el,i) => { el.classList.toggle('selected',i === selected); el.setAttribute('aria-selected',String(i === selected)); });
  list.querySelectorAll('.row')[selected]?.scrollIntoView({block:'nearest'});
}
async function open(item, action) { try { await window.searcher.open(item.id,query.value,action); message(); } catch(e) { message(e.message); } }
function render() {
  list.replaceChildren();
  if (!rows.length) { empty(query.value ? 'No matches yet' : 'Your laptop, one search away', scanning ? 'Indexing in the background. Results appear as files are discovered.' : mode === 'content' ? 'Search text inside files. Type at least two characters.' : 'Try an app name, a filename, or a phrase inside a file.'); }
  rows.forEach((item,i) => {
    const row = document.createElement('div'); row.className = 'row'; row.dataset.kind = item.kind; row.setAttribute('role','option');
    const icon = document.createElement('span'); icon.className = 'icon'; icon.textContent = {app:'▦',folder:'▱',file:'≡',content:'“'}[item.kind];
    const details = document.createElement('div'); details.className = 'details';
    const name = document.createElement('div'); name.className = 'name'; name.textContent = item.name + (item.line ? ` : ${item.line}` : '');
    const path = document.createElement('div'); path.className = 'path'; path.textContent = item.path || 'Application'; path.title = item.path || item.id;
    details.append(name,path);
    if (item.snippet) { const snippet = document.createElement('div'); snippet.className = 'snippet'; snippet.textContent = item.snippet.trim(); details.append(snippet); }
    const kind = document.createElement('span'); kind.className = 'kind'; kind.textContent = item.kind;
    const actions = document.createElement('div'); actions.className = 'actions';
    for (const [label,action] of [['Copy','copy'],...(item.path ? [['Reveal','reveal']] : [])]) {
      const b = document.createElement('button'); b.textContent = label; b.addEventListener('click',e => { e.stopPropagation(); open(item,action); }); actions.append(b);
    }
    row.append(icon,details,kind,actions); row.addEventListener('click',() => select(i)); row.addEventListener('dblclick',() => open(item)); list.append(row);
  });
  if (Object.keys(cursors).length) { const more = document.createElement('button'); more.className = 'load-more'; more.textContent = 'Search more file contents'; more.onclick = () => search(true); list.append(more); }
  select(selected);
}
async function search(more = false) {
  const version = ++sequence, text = query.value;
  try {
    const r = await window.searcher.search(text,more && mode === 'all' ? 'content' : mode,more ? cursors : null);
    if (version !== sequence) return;
    rows = more ? [...new Map([...rows,...r.results].map(x => [x.id,x])).values()] : r.results;
    cursors = r.cursors; if (!more) selected = 0;
    $('#timing').textContent = `${r.ms.toFixed(1)} ms · ${rows.length} results` + (r.partial ? ' · partial' : '');
    message(r.errors.join(' · ')); render();
    // Paint app/file results first. Content scanning must never delay that first response.
    if (mode === 'all' && !more && text.trim().length >= 2) {
      const content = await window.searcher.search(text,'content');
      if (version !== sequence) return;
      rows = [...rows,...content.results.slice(0,30)]; cursors = content.cursors;
      $('#timing').textContent = `${r.ms.toFixed(1)} ms names · ${content.ms.toFixed(1)} ms content` + (content.partial ? ' · partial' : '');
      message([...r.errors,...content.errors].join(' · ')); render();
    }
  } catch(e) { if (version === sequence) { message(e.message); rows=[]; render(); } }
}
query.addEventListener('input',() => { ++sequence; clearTimeout(timer); timer = setTimeout(() => search(),55); });
function setMode(value) { mode=value; document.querySelectorAll('[data-mode]').forEach(b => b.classList.toggle('active',b.dataset.mode === mode)); query.focus(); search(); }
document.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => setMode(b.dataset.mode));
document.addEventListener('keydown',e => {
  if (e.key === 'Escape') { settingsOpen ? toggleSettings() : window.searcher.hide(); return; }
  if (e.ctrlKey && e.key === ',') { e.preventDefault(); toggleSettings(); return; }
  if (e.ctrlKey && ['1','2','3','4'].includes(e.key)) { e.preventDefault(); setMode(['all','apps','files','content'][Number(e.key)-1]); return; }
  if (settingsOpen) return;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); select(selected + (e.key === 'ArrowDown' ? 1 : -1)); }
  if (e.key === 'Enter' && rows[selected]) { e.preventDefault(); open(rows[selected],e.ctrlKey ? 'reveal' : undefined); }
});
async function updateStatus() {
  try {
    const wasScanning = scanning;
    const s = await window.searcher.status(); scanning = !s.roots || s.roots.some(r => r.isScanning);
    const files = (s.roots || []).reduce((n,r) => n + (r.scannedFilesCount || 0),0);
    $('#status').textContent = s.engineError || `${scanning ? 'Indexing' : 'Watching'} · ${files.toLocaleString()} files · ${s.apps || 0} apps`;
    if (!s.hotkey) message('F2 is in use by another app. Quit that app and restart Searcher.');
    if (s.errors?.length) message(s.errors.join(' · '));
    if (settingsOpen) renderSettings(s.config);
    if (!settingsOpen && !document.hidden && query.value && (wasScanning || scanning) && files !== lastFileCount) search();
    lastFileCount = files;
  } catch(e) { message(e.message); }
}
function renderSettings(config) {
  $('#roots').replaceChildren();
  for (const root of config.roots) {
    const row = document.createElement('div'); row.className='root';
    const label = document.createElement('span'); label.textContent = root; label.title = root;
    const b = document.createElement('button'); b.textContent = 'Remove'; b.onclick = () => changeSetting('remove',root);
    row.append(label,b); $('#roots').append(row);
  }
  $('#login').checked = config.launchAtLogin;
}
async function changeSetting(action,value) {
  try { renderSettings(await window.searcher.settings(action,value)); message(action === 'login' ? 'Startup preference saved.' : 'Indexing updated folders…'); }
  catch(e) { message(e.message); }
}
function toggleSettings() { settingsOpen=!settingsOpen; $('#settings').hidden=!settingsOpen; list.hidden=settingsOpen; $('nav').hidden=settingsOpen; updateStatus(); if (!settingsOpen) { query.focus(); search(); } }
$('#settings-toggle').onclick=toggleSettings; $('#close').onclick=() => window.searcher.hide();
$('#add-root').onclick=() => changeSetting('add'); $('#reindex').onclick=() => changeSetting('reindex'); $('#login').onchange=e => changeSetting('login',e.target.checked);
window.searcher.onFocus(() => { query.focus(); query.select(); if (!settingsOpen) search(); });
empty('Your laptop, one search away','Getting your local index ready…');
updateStatus(); search(); setInterval(updateStatus,2500);
