/*
 * DoRoleplay chat package core (no DOM). Works in the browser (window.ChatCore) and in Node (tests).
 *
 * Both apps import a chat HTML file ONLY from its embedded
 *   <script id="doroleplay-chat-data" type="application/json"> {package} </script>
 * The iOS app decodes it strictly (Swift Codable, ISO-8601 dates without fractional seconds).
 * A missing required key or a wrong type makes iOS silently fall back to scraping the page,
 * which loses swipes, thinking, memory and settings. Everything here keeps that format exact.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ChatCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const SCRIPT_OPEN = '<script id="doroleplay-chat-data" type="application/json">';

  // Required (non-optional) keys of the iOS ChatSession and ChatMessage structs, with their types.
  const CHAT_REQUIRED = {
    id: 'string', characterId: 'string', title: 'string', messageCount: 'int', createdAt: 'date', updatedAt: 'date',
    bgMode: 'string', bgColor: 'string', bgDim: 'number', bgBlur: 'number', showThinking: 'bool', autoScroll: 'bool',
    estimatedTokens: 'int', summarizedUpTo: 'int', memoryCheckpointTurn: 'int'
  };
  const MSG_REQUIRED = {
    id: 'string', chatId: 'string', role: 'string', content: 'string', swipes: 'strings', currentSwipeIndex: 'int',
    createdAt: 'date', updatedAt: 'date'
  };
  // Optional keys whose type iOS still checks when present (null is fine).
  const CHAT_OPTIONAL = {
    personaId: 'string', lastMessageSnippet: 'string', proxyId: 'string', memoryBlock: 'string', temperature: 'number',
    maxTokens: 'int', contextSize: 'int', topP: 'number', topK: 'int', frequencyPenalty: 'number', presencePenalty: 'number',
    scriptState: 'string', memoryGraphData: 'string', memoryExtractorJson: 'string', extractorProxyId: 'string'
  };
  const MSG_OPTIONAL = { thinkingContent: 'string', personaName: 'string' };
  const ISO_NO_MS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

  const isoNoMs = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const parseMs = (v) => { const t = typeof v === 'number' ? v : Date.parse(v); return Number.isFinite(t) ? t : NaN; };
  const rid = (p) => p + '_' + Math.random().toString(36).slice(2, 12);
  const clone = (o) => JSON.parse(JSON.stringify(o));

  /** Embedded package from an exported HTML string, or null. */
  function extractPackage(html) {
    const s = html.indexOf(SCRIPT_OPEN);
    if (s < 0) return null;
    const from = s + SCRIPT_OPEN.length;
    const e = html.indexOf('</script>', from);
    if (e < 0) return null;
    try {
      const pkg = JSON.parse(html.slice(from, e)); // "<\/" is valid JSON for "</"
      return pkg && pkg.chat && Array.isArray(pkg.messages) ? pkg : null;
    } catch (err) { return null; }
  }

  /** New message with every required key. */
  function newMessage(role, content, chatId) {
    const now = isoNoMs(Date.now());
    return { id: rid('msg'), chatId: chatId || '', role, content: content || '', thinkingContent: null,
      personaName: null, swipes: [content || ''], currentSwipeIndex: 0, createdAt: now, updatedAt: now };
  }

  /** Builds a full package (same shape as the apps export) from a scraped JanitorAI chat. */
  function fromScraped({ title, characterName, personaName, messages }) {
    const chatId = rid('chat');
    const now = Date.now();
    const t0 = now - messages.length * 1000;
    const msgs = messages.map((m, i) => {
      const msg = newMessage(m.role === 'user' ? 'user' : 'assistant', m.content, chatId);
      msg.thinkingContent = m.thinking || null;
      msg.createdAt = msg.updatedAt = isoNoMs(t0 + i * 1000);
      return msg;
    });
    const pkg = {
      version: 1, exportedAt: isoNoMs(now), app: 'DoRoleplay', characterName: characterName || '', characterId: '',
      chat: {
        id: chatId, characterId: '', personaId: null, title: title || (characterName ? `Chat with ${characterName}` : 'Imported chat'),
        lastMessageSnippet: null, messageCount: msgs.length, createdAt: isoNoMs(t0), updatedAt: isoNoMs(now),
        proxyId: null, memoryBlock: null, bgMode: 'character', bgColor: '#16171f', bgDim: 80, bgBlur: 0,
        showThinking: true, autoScroll: true, estimatedTokens: 0, summarizedUpTo: 0, autoMemoryUpTo: 0,
        scriptState: null, memoryGraphData: null, memoryExtractorJson: null, memoryCheckpointTurn: 0, extractorProxyId: null
      },
      messages: msgs
    };
    setPersonaName(pkg, personaName || '');
    setCharacterName(pkg, characterName || '');
    return pkg;
  }

  /** Persona name shown on every user message (the apps pre-select a persona by this name). */
  function setPersonaName(pkg, name) {
    pkg.messages.forEach((m) => { if (m.role === 'user') m.personaName = name || null; });
  }
  function getPersonaName(pkg) {
    const u = pkg.messages.find((m) => m.role === 'user' && m.personaName);
    return u ? u.personaName : '';
  }
  /** Character name (the apps pre-select a character by this name). */
  function setCharacterName(pkg, name) {
    pkg.characterName = name || '';
    pkg.messages.forEach((m) => { if (m.role === 'assistant') m.personaName = name || null; });
  }

  /**
   * Makes the package consistent after edits. Returns notes about what was fixed.
   * - content always equals the active swipe (iOS displays swipes[currentSwipeIndex])
   * - currentSwipeIndex points at an existing swipe
   * - createdAt strictly increasing in list order, whole seconds (export drops milliseconds)
   * - ids unique, chatId set, counts and snippet recalculated, dates in the strict format
   */
  function normalize(pkg) {
    const notes = [];
    const chat = pkg.chat;
    const seen = new Set();
    let prev = -Infinity;
    const n = pkg.messages.length;
    pkg.messages.forEach((m, i) => {
      if (m.role !== 'user' && m.role !== 'assistant') { m.role = 'assistant'; notes.push(`Message ${i + 1}: unknown role set to assistant.`); }
      if (!m.id || seen.has(m.id)) m.id = rid('msg');
      seen.add(m.id);
      m.chatId = chat.id;
      if (!Array.isArray(m.swipes) || !m.swipes.length) m.swipes = [m.content || ''];
      m.swipes = m.swipes.map((s) => (typeof s === 'string' ? s : String(s == null ? '' : s)));
      if (!Number.isInteger(m.currentSwipeIndex) || m.currentSwipeIndex < 0 || m.currentSwipeIndex >= m.swipes.length) {
        m.currentSwipeIndex = Math.min(Math.max(0, m.currentSwipeIndex | 0), m.swipes.length - 1);
      }
      m.content = m.swipes[m.currentSwipeIndex];
      if (m.thinkingContent === '') m.thinkingContent = null;
      let t = Math.floor(parseMs(m.createdAt) / 1000) * 1000;
      if (!Number.isFinite(t)) t = prev === -Infinity ? Date.now() - (n - i) * 1000 : prev + 1000;
      if (t <= prev) t = prev + 1000;
      prev = t;
      m.createdAt = isoNoMs(t);
      const u = parseMs(m.updatedAt);
      m.updatedAt = isoNoMs(Number.isFinite(u) && u >= t ? Math.floor(u / 1000) * 1000 : t);
    });
    chat.messageCount = n;
    const last = pkg.messages[n - 1];
    chat.lastMessageSnippet = last ? last.content.slice(0, 120) : null;
    if (chat.summarizedUpTo > n) { chat.summarizedUpTo = n; notes.push('Memory Block summary point moved to the new last message.'); }
    if (chat.memoryCheckpointTurn > n) { chat.memoryCheckpointTurn = n; notes.push('Memory Graph checkpoint moved to the new last message.'); }
    const c = parseMs(chat.createdAt), first = pkg.messages[0] ? parseMs(pkg.messages[0].createdAt) : NaN;
    chat.createdAt = isoNoMs(Number.isFinite(c) ? Math.min(Math.floor(c / 1000) * 1000, Number.isFinite(first) ? first : c) : (Number.isFinite(first) ? first : Date.now()));
    chat.updatedAt = isoNoMs(Math.max(Date.now() - (Date.now() % 1000), prev === -Infinity ? 0 : prev));
    pkg.exportedAt = isoNoMs(Date.now() - (Date.now() % 1000));
    if (typeof pkg.version !== 'number') pkg.version = 1;
    if (typeof pkg.app !== 'string') pkg.app = 'DoRoleplay';
    if (typeof pkg.characterId !== 'string') pkg.characterId = '';
    if (typeof pkg.characterName !== 'string') pkg.characterName = '';
    return notes;
  }

  /** Memory Graph entries that point past the last message (e.g. after deleting messages). */
  function memoryWarnings(pkg) {
    if (!pkg.chat.memoryGraphData) return [];
    let g; try { g = JSON.parse(pkg.chat.memoryGraphData); } catch (e) { return ['Memory Graph data is not valid JSON; it is kept unchanged.']; }
    const n = pkg.messages.length;
    const late = ['events', 'anchors'].reduce((acc, k) => acc + ((g && g[k]) || []).filter((x) => typeof x.turn === 'number' && x.turn > n).length, 0);
    return late ? [`${late} Memory Graph event(s)/anchor(s) refer to turns after the last message. They are kept; review them in the app.`] : [];
  }

  function typeOk(v, t) {
    switch (t) {
      case 'string': return typeof v === 'string';
      case 'number': return typeof v === 'number' && Number.isFinite(v);
      case 'int': return Number.isInteger(v);
      case 'bool': return typeof v === 'boolean';
      case 'date': return typeof v === 'string' && ISO_NO_MS.test(v);
      case 'strings': return Array.isArray(v) && v.every((s) => typeof s === 'string');
      default: return false;
    }
  }

  /** Errors that would make the iOS importer reject the package. Empty = safe. */
  function validate(pkg) {
    const errs = [];
    if (!pkg || typeof pkg !== 'object') return ['Not a chat package.'];
    if (!Number.isInteger(pkg.version)) errs.push('version must be an integer');
    if (!typeOk(pkg.exportedAt, 'date')) errs.push('exportedAt must be an ISO date without milliseconds');
    ['app', 'characterName', 'characterId'].forEach((k) => { if (typeof pkg[k] !== 'string') errs.push(`${k} must be text`); });
    const chat = pkg.chat || {};
    Object.entries(CHAT_REQUIRED).forEach(([k, t]) => { if (!typeOk(chat[k], t)) errs.push(`chat.${k} is missing or has the wrong type`); });
    Object.entries(CHAT_OPTIONAL).forEach(([k, t]) => { if (chat[k] != null && !typeOk(chat[k], t)) errs.push(`chat.${k} has the wrong type`); });
    if (!Array.isArray(pkg.messages)) return errs.concat('messages must be a list');
    pkg.messages.forEach((m, i) => {
      Object.entries(MSG_REQUIRED).forEach(([k, t]) => { if (!typeOk(m[k], t)) errs.push(`message ${i + 1}: ${k} is missing or has the wrong type`); });
      Object.entries(MSG_OPTIONAL).forEach(([k, t]) => { if (m[k] != null && !typeOk(m[k], t)) errs.push(`message ${i + 1}: ${k} has the wrong type`); });
      if (Array.isArray(m.swipes) && m.swipes[m.currentSwipeIndex] !== m.content) errs.push(`message ${i + 1}: text differs from its active swipe`);
      if (i > 0 && !(Date.parse(m.createdAt) > Date.parse(pkg.messages[i - 1].createdAt))) errs.push(`message ${i + 1}: timestamps are out of order`);
    });
    return errs;
  }

  const esc = (t) => String(t == null ? '' : t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const paras = (t) => esc(t).split(/\n{2,}/).map((p) => `<p>${p.replace(/\n/g, '<br>')}</p>`).join('');

  /** Full export HTML: readable page + the embedded package (same tag and escaping as the apps). */
  function buildHTML(pkg) {
    const charName = pkg.characterName || 'Character';
    const persona = getPersonaName(pkg) || 'You';
    const rows = pkg.messages.map((m) => {
      const who = m.role === 'user' ? (m.personaName || persona) : charName;
      const think = m.thinkingContent ? `<details class="thinking"><summary>Thinking</summary><pre>${esc(m.thinkingContent)}</pre></details>` : '';
      return `<div class="message-row ${m.role}" data-id="${esc(m.id)}"><div class="bubble-container"><div class="sender">${esc(who)}</div>${think}<div class="bubble">${paras(m.content)}</div><div class="timestamp">${esc(m.createdAt)}</div></div></div>`;
    }).join('\n');
    const json = JSON.stringify(pkg, null, 2).replace(/<\//g, '<\\/');
    return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(charName)} - ${esc(pkg.chat.title)}</title>
<style>body{margin:0;background:#0e1017;color:#dfe7f5;font:15px/1.55 -apple-system,system-ui,sans-serif}.chat-wrapper{max-width:820px;margin:0 auto;padding:24px 16px}.chat-header h1{font-size:18px;margin:0}.chat-header p{margin:2px 0 16px;color:#8a8fa3;font-size:12px}.message-row{display:flex;margin:10px 0}.message-row.user{justify-content:flex-end}.bubble-container{max-width:80%}.sender{font-size:12px;color:#8a8fa3;margin:0 2px 3px}.bubble{background:#1a1c28;border:1px solid #232533;border-radius:12px;padding:10px 14px}.message-row.user .bubble{background:#12261c;border-color:#2ed57355}.bubble p{margin:.4em 0}.timestamp{font-size:10px;color:#6b7080;margin-top:4px}.thinking{font-size:12px;color:#8a8fa3}.thinking pre{white-space:pre-wrap}</style></head>
<body><div class="chat-wrapper"><header class="chat-header"><h1>${esc(charName)} - ${esc(pkg.chat.title)}</h1><p>${pkg.messages.length} messages • Edited with DoRoleplay Chat Editor</p></header>
<main class="messages-list">${rows}</main></div>
<!-- Lossless DoRoleplay Roundtrip Payload -->
${SCRIPT_OPEN}
${json}
</script></body></html>`;
  }

  return { extractPackage, fromScraped, newMessage, normalize, validate, buildHTML, memoryWarnings,
    setPersonaName, getPersonaName, setCharacterName, isoNoMs, clone, rid };
});
