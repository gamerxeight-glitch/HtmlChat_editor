/* DoRoleplay Chat Editor UI. All package rules live in core.js. */
(function () {
  'use strict';
  const C = window.ChatCore;
  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

  let pkg = null;          // the package being edited
  let fileName = 'chat';
  let sourceLabel = '';
  const undoStack = [];
  const selected = new Set(); // message ids
  let dragFrom = -1;

  // ---------- Undo ----------
  function snapshot() {
    undoStack.push(JSON.stringify(pkg));
    if (undoStack.length > 100) undoStack.shift();
    $('undo').disabled = false;
  }
  function undo() {
    if (!undoStack.length) return;
    pkg = JSON.parse(undoStack.pop());
    $('undo').disabled = !undoStack.length;
    render();
  }

  // ---------- Opening files ----------
  /** JanitorAI Chat Downloader HTML -> plain messages (same reading as the Mac app's importer). */
  function scrapeJanitor(doc) {
    const nodes = Array.from(doc.querySelectorAll('.message'));
    if (!nodes.length) return null;
    const h1 = doc.querySelector('.chat-header h1');
    const cn = doc.querySelector('.chat-header .character-name');
    let characterName = cn ? cn.textContent.replace(/^\s*with\s+/i, '').trim() : '';
    let personaName = '';
    const messages = [];
    nodes.forEach((node) => {
      const isUser = node.classList.contains('user-message');
      const a = node.querySelector('.author');
      const author = a ? a.textContent.trim() : '';
      if (isUser && author && !personaName) personaName = author;
      if (!isUser && author && !characterName) characterName = author;
      const body = node.querySelector('.message-content');
      if (!body) return;
      const copy = body.cloneNode(true);
      let thinking = '';
      // Think containers (class contains "think") and raw <think>/<thinking> tags left in the text.
      const THINK = '[class*="think" i], think, thinking';
      copy.querySelectorAll(THINK).forEach((t) => {
        if (t.parentElement && t.parentElement.closest(THINK)) return;
        thinking += (thinking ? '\n\n' : '') + t.textContent.trim();
        t.remove();
      });
      let content = toText(copy).replace(/\n{3,}/g, '\n\n').trim();
      if (thinking) content = content.replace(/ {2,}/g, ' '); // gap left where a <think> was cut out
      if (!content && !thinking) return;
      messages.push({ role: isUser ? 'user' : 'assistant', content, thinking: thinking || null });
    });
    if (!messages.length) return null;
    return { title: h1 ? h1.textContent.trim() : '', characterName, personaName: personaName === 'You' ? '' : personaName, messages };
  }
  /** Message HTML -> the apps' plain text with *italic* / **bold** markers and paragraph breaks. */
  function toText(node) {
    let out = '';
    node.childNodes.forEach((n) => {
      if (n.nodeType === 3) { out += n.textContent; return; }
      if (n.nodeType !== 1) return;
      const tag = n.tagName.toLowerCase();
      const inner = toText(n);
      if (tag === 'br') out += '\n';
      else if (tag === 'p' || tag === 'div' || tag === 'blockquote' || tag === 'pre' || /^h\d$/.test(tag)) out += inner.trim() + '\n\n';
      else if (tag === 'li') out += '- ' + inner.trim() + '\n';
      else if (tag === 'em' || tag === 'i') out += inner.trim() ? `*${inner.trim()}*` : '';
      else if (tag === 'strong' || tag === 'b') out += inner.trim() ? `**${inner.trim()}**` : '';
      else out += inner;
    });
    return out;
  }

  async function openFile(file) {
    let text;
    try { text = await file.text(); } catch (e) { return alert('Could not read that file.'); }
    let next = C.extractPackage(text);
    if (next) sourceLabel = `DoRoleplay export (${next.app || 'DoRoleplay'}) · ${next.messages.length} messages`;
    else {
      const doc = new DOMParser().parseFromString(text, 'text/html'); // inert document
      const scraped = scrapeJanitor(doc);
      if (!scraped) return alert('This file has no DoRoleplay chat data and does not look like a JanitorAI Chat Downloader HTML export.');
      next = C.fromScraped(scraped);
      sourceLabel = `JanitorAI export converted · ${next.messages.length} messages · saving produces a full DoRoleplay chat file`;
    }
    pkg = next;
    C.normalize(pkg);
    fileName = file.name.replace(/\.html?$/i, '');
    undoStack.length = 0; $('undo').disabled = true;
    selected.clear();
    $('empty').hidden = true; $('editor').hidden = false; $('save').disabled = false;
    render();
  }

  // ---------- Saving ----------
  function save() {
    if (!pkg) return;
    const notes = C.normalize(pkg);
    const errs = C.validate(pkg);
    if (errs.length) { showIssues(errs, true); return alert('Not saved: the file would not import safely. See the problems listed above the messages.'); }
    if (!pkg.messages.length) return alert('Not saved: the chat has no messages.');
    const blob = new Blob([C.buildHTML(pkg)], { type: 'text/html' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = fileName.replace(/-edited$/, '') + '-edited.html';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    render(notes);
  }

  // ---------- Rendering ----------
  function showIssues(list, isError) {
    const box = $('issues');
    box.hidden = !list.length;
    box.className = 'issues' + (isError ? ' err' : '');
    box.innerHTML = '';
    if (!list.length) return;
    box.appendChild(el('strong', null, isError ? 'Problems (fix before saving):' : 'Notes:'));
    const ul = el('ul'); list.forEach((t) => ul.appendChild(el('li', null, t))); box.appendChild(ul);
  }

  function render(extraNotes) {
    $('source').textContent = sourceLabel;
    $('title').value = pkg.chat.title || '';
    $('charName').value = pkg.characterName || '';
    $('personaName').value = C.getPersonaName(pkg);
    const list = $('list');
    list.innerHTML = '';
    pkg.messages.forEach((m, i) => list.appendChild(renderMessage(m, i)));
    $('count').textContent = `${pkg.messages.length} messages` + (selected.size ? ` · ${selected.size} selected` : '');
    $('deleteSel').disabled = !selected.size;
    showIssues([...(extraNotes || []), ...C.memoryWarnings(pkg)], false);
    updateFindCount();
  }

  function renderMessage(m, i) {
    const li = el('li', 'msg ' + m.role + (selected.has(m.id) ? ' selected' : ''));
    li.draggable = false;
    const head = el('div', 'msg-head');

    const sel = el('input'); sel.type = 'checkbox'; sel.checked = selected.has(m.id); sel.setAttribute('aria-label', `Select message ${i + 1}`);
    sel.onchange = () => { sel.checked ? selected.add(m.id) : selected.delete(m.id); render(); };
    const grip = el('span', 'grip', '⠿'); grip.title = 'Drag to reorder'; grip.setAttribute('aria-hidden', 'true');
    grip.onmousedown = () => { li.draggable = true; };
    li.ondragstart = (e) => { dragFrom = i; e.dataTransfer.effectAllowed = 'move'; };
    li.ondragend = () => { li.draggable = false; };
    li.ondragover = (e) => { if (dragFrom >= 0) { e.preventDefault(); li.classList.add('dragover'); } };
    li.ondragleave = () => li.classList.remove('dragover');
    li.ondrop = (e) => { e.preventDefault(); li.classList.remove('dragover'); if (dragFrom >= 0 && dragFrom !== i) move(dragFrom, i); dragFrom = -1; };

    const role = el('select'); role.setAttribute('aria-label', `Role of message ${i + 1}`);
    [['assistant', pkg.characterName || 'Character'], ['user', C.getPersonaName(pkg) || 'You (user)']].forEach(([v, label]) => {
      const o = el('option', null, label); o.value = v; role.appendChild(o);
    });
    role.value = m.role;
    role.onchange = () => {
      snapshot(); m.role = role.value;
      m.personaName = m.role === 'user' ? (C.getPersonaName(pkg) || null) : (pkg.characterName || null);
      render();
    };

    head.append(sel, grip, el('span', 'num', '#' + (i + 1)), role);

    // Swipes
    const sw = el('span', 'swipes');
    if (m.swipes.length > 1) {
      const prev = btn('‹', `Previous swipe of message ${i + 1}`, () => setSwipe(m, m.currentSwipeIndex - 1));
      const next = btn('›', `Next swipe of message ${i + 1}`, () => setSwipe(m, m.currentSwipeIndex + 1));
      prev.disabled = m.currentSwipeIndex === 0; next.disabled = m.currentSwipeIndex === m.swipes.length - 1;
      sw.append(prev, el('span', null, `swipe ${m.currentSwipeIndex + 1}/${m.swipes.length}`), next,
        btn('Delete swipe', 'Delete this swipe', () => { snapshot(); m.swipes.splice(m.currentSwipeIndex, 1); m.currentSwipeIndex = Math.min(m.currentSwipeIndex, m.swipes.length - 1); C.normalize(pkg); render(); }));
    }
    if (m.role === 'assistant') sw.append(btn('+ Swipe', 'Add an alternative reply', () => { snapshot(); m.swipes.push(''); m.currentSwipeIndex = m.swipes.length - 1; C.normalize(pkg); render(); }));
    head.append(sw, el('span', 'spacer'));

    head.append(
      btn('↑', 'Move up', () => move(i, i - 1), i === 0),
      btn('↓', 'Move down', () => move(i, i + 1), i === pkg.messages.length - 1),
      btn('Split', 'Split at the cursor into two messages', () => split(i, ta)),
      btn('Merge ↓', 'Merge with the next message', () => merge(i), i === pkg.messages.length - 1),
      btn('+ Below', 'Insert a new message below', () => insert(i + 1)),
      btn('Delete', 'Delete this message', () => { snapshot(); selected.delete(m.id); pkg.messages.splice(i, 1); C.normalize(pkg); render(); }, false, 'danger')
    );

    const ta = el('textarea'); ta.value = m.content; ta.setAttribute('aria-label', `Text of message ${i + 1}`);
    ta.rows = Math.min(14, Math.max(3, Math.ceil(m.content.length / 90) + (m.content.match(/\n/g) || []).length));
    let editing = false;
    ta.oninput = () => {
      if (!editing) { snapshot(); editing = true; }
      m.swipes[m.currentSwipeIndex] = ta.value; m.content = ta.value; m.updatedAt = C.isoNoMs(Date.now() - (Date.now() % 1000));
    };
    ta.onblur = () => { editing = false; updateFindCount(); };

    const think = el('details', 'think');
    think.appendChild(el('summary', null, m.thinkingContent ? 'Thinking' : 'Add thinking'));
    const tt = el('textarea'); tt.value = m.thinkingContent || ''; tt.setAttribute('aria-label', `Thinking of message ${i + 1}`);
    let tEditing = false;
    tt.oninput = () => { if (!tEditing) { snapshot(); tEditing = true; } m.thinkingContent = tt.value || null; };
    tt.onblur = () => { tEditing = false; };
    think.appendChild(tt);

    li.append(head, ta, think);
    return li;
  }

  function btn(label, title, fn, disabled, cls) {
    const b = el('button', 'btn small' + (cls ? ' ' + cls : ''), label);
    b.type = 'button'; b.title = title; b.setAttribute('aria-label', title); b.disabled = !!disabled; b.onclick = fn;
    return b;
  }

  // ---------- Edits ----------
  function setSwipe(m, idx) { snapshot(); m.currentSwipeIndex = idx; C.normalize(pkg); render(); }

  /** Reorder: times are re-stamped in list order so the apps show the same order. */
  function move(from, to) {
    if (to < 0 || to >= pkg.messages.length) return;
    snapshot();
    const [m] = pkg.messages.splice(from, 1);
    pkg.messages.splice(to, 0, m);
    restampInOrder();
    render();
  }
  function restampInOrder() {
    const times = pkg.messages.map((m) => Date.parse(m.createdAt)).filter(Number.isFinite).sort((a, b) => a - b);
    pkg.messages.forEach((m, i) => { if (times[i] != null) m.createdAt = C.isoNoMs(times[i]); });
    C.normalize(pkg);
  }

  function insert(at) {
    snapshot();
    const prev = pkg.messages[at - 1];
    const m = C.newMessage(prev && prev.role === 'assistant' ? 'user' : 'assistant', '', pkg.chat.id);
    m.personaName = m.role === 'user' ? (C.getPersonaName(pkg) || null) : (pkg.characterName || null);
    const pt = prev ? Date.parse(prev.createdAt) : NaN;
    if (Number.isFinite(pt)) m.createdAt = m.updatedAt = C.isoNoMs(pt + 1000);
    pkg.messages.splice(at, 0, m);
    C.normalize(pkg);
    render();
    const ta = $('list').children[at] && $('list').children[at].querySelector('textarea');
    if (ta) ta.focus();
  }

  function split(i, ta) {
    const m = pkg.messages[i];
    const pos = ta.selectionStart;
    const a = ta.value.slice(0, pos).trimEnd(), b = ta.value.slice(pos).trimStart();
    if (!a || !b) return alert('Place the cursor where the message should be split.');
    snapshot();
    m.swipes = [a]; m.currentSwipeIndex = 0; m.content = a;
    const n = C.newMessage(m.role, b, pkg.chat.id);
    n.personaName = m.personaName;
    n.createdAt = n.updatedAt = C.isoNoMs(Date.parse(m.createdAt) + 1000);
    pkg.messages.splice(i + 1, 0, n);
    C.normalize(pkg);
    render();
  }

  function merge(i) {
    const a = pkg.messages[i], b = pkg.messages[i + 1];
    if (!b) return;
    if (a.role !== b.role && !confirm('These messages have different roles. Merge anyway (keeps the first one\'s role)?')) return;
    snapshot();
    const text = [a.content, b.content].filter(Boolean).join('\n\n');
    a.swipes = [text]; a.currentSwipeIndex = 0; a.content = text;
    a.thinkingContent = [a.thinkingContent, b.thinkingContent].filter(Boolean).join('\n\n') || null;
    selected.delete(b.id);
    pkg.messages.splice(i + 1, 1);
    C.normalize(pkg);
    render();
  }

  // ---------- Find / replace / tidy ----------
  function findRegex() {
    const q = $('find').value;
    if (!q) return null;
    return new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $('matchCase').checked ? 'g' : 'gi');
  }
  function updateFindCount() {
    const re = findRegex();
    if (!re || !pkg) { $('findCount').textContent = ''; return; }
    let n = 0, msgs = 0;
    pkg.messages.forEach((m) => { const k = (m.content.match(re) || []).length; n += k; if (k) msgs++; });
    $('findCount').textContent = `${n} match${n === 1 ? '' : 'es'} in ${msgs} message${msgs === 1 ? '' : 's'} (active swipes)`;
  }
  function replaceAll() {
    const re = findRegex();
    if (!re) return;
    const rep = $('replace').value;
    let n = 0;
    pkg.messages.forEach((m) => { n += (m.content.match(re) || []).length; });
    if (!n) return alert('No matches.');
    if (!confirm(`Replace ${n} match${n === 1 ? '' : 'es'} in the active swipes?`)) return;
    snapshot();
    pkg.messages.forEach((m) => { m.swipes[m.currentSwipeIndex] = m.content.replace(re, () => rep); });
    C.normalize(pkg);
    render();
  }
  function tidy() {
    snapshot();
    let changed = 0;
    pkg.messages.forEach((m) => {
      m.swipes = m.swipes.map((s) => {
        const t = s.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
        if (t !== s) changed++;
        return t;
      });
    });
    C.normalize(pkg);
    render([`Tidied ${changed} swipe(s): trailing spaces, extra blank lines, leading/trailing whitespace.`]);
  }

  // ---------- Wiring ----------
  $('file').onchange = (e) => { const f = e.target.files[0]; if (f) openFile(f); e.target.value = ''; };
  $('save').onclick = save;
  $('undo').onclick = undo;
  $('replaceAll').onclick = replaceAll;
  $('find').oninput = updateFindCount;
  $('matchCase').onchange = updateFindCount;
  $('trim').onclick = tidy;
  $('addEnd').onclick = () => insert(pkg.messages.length);
  $('selectAll').onclick = () => { pkg.messages.forEach((m) => selected.add(m.id)); render(); };
  $('selectNone').onclick = () => { selected.clear(); render(); };
  $('deleteSel').onclick = () => {
    if (!selected.size || !confirm(`Delete ${selected.size} message(s)?`)) return;
    snapshot();
    pkg.messages = pkg.messages.filter((m) => !selected.has(m.id));
    selected.clear(); C.normalize(pkg); render();
  };
  const field = (id, apply) => {
    let editing = false;
    $(id).oninput = () => { if (!editing) { snapshot(); editing = true; } apply($(id).value); };
    $(id).onblur = () => { editing = false; render(); };
  };
  field('title', (v) => { pkg.chat.title = v; });
  field('charName', (v) => C.setCharacterName(pkg, v.trim()));
  field('personaName', (v) => C.setPersonaName(pkg, v.trim()));
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !e.shiftKey && !/^(TEXTAREA|INPUT)$/.test(document.activeElement.tagName)) { e.preventDefault(); undo(); }
    if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); save(); }
  });
  window.addEventListener('beforeunload', (e) => { if (undoStack.length) { e.preventDefault(); e.returnValue = ''; } });
  // Drop a file anywhere.
  document.addEventListener('dragover', (e) => { if (e.dataTransfer.types.includes('Files')) e.preventDefault(); });
  document.addEventListener('drop', (e) => { const f = e.dataTransfer.files[0]; if (f) { e.preventDefault(); openFile(f); } });
})();
