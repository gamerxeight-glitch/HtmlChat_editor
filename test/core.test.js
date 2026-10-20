'use strict';
// Run: node --test
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../core.js');

// Shape of a real Mac export package (iOS field names, ISO dates without ms).
function macPackage() {
  return {
    version: 1, exportedAt: '2026-10-20T10:00:00Z', app: 'DoRoleplay', characterName: 'Lyra', characterId: 'char_1',
    chat: {
      id: 'chat_1', characterId: 'char_1', personaId: 'persona_9', title: 'Story (Fork 2)', lastMessageSnippet: 'x', messageCount: 3,
      createdAt: '2026-10-20T09:00:00Z', updatedAt: '2026-10-20T09:05:00Z', proxyId: null, memoryBlock: null,
      bgMode: 'character', bgColor: '#16171f', bgDim: 80, bgBlur: 0, showThinking: true, autoScroll: true, estimatedTokens: 0,
      summarizedUpTo: 3, autoMemoryUpTo: 0, scriptState: '{"s":{"n":"1"}}', minP: 0.05,
      memoryGraphData: JSON.stringify({ events: [{ id: 'e1', turn: 3, title: 'Met' }], anchors: [] }),
      memoryExtractorJson: null, memoryCheckpointTurn: 3, extractorProxyId: null
    },
    messages: [
      { id: 'm1', chatId: 'chat_1', role: 'assistant', content: 'Hello', thinkingContent: null, personaName: 'Lyra', swipes: ['Hi', 'Hello'], currentSwipeIndex: 1, createdAt: '2026-10-20T09:00:01Z', updatedAt: '2026-10-20T09:00:01Z' },
      { id: 'm2', chatId: 'chat_1', role: 'user', content: 'Hey </script> <b>', thinkingContent: null, personaName: 'Kai', swipes: ['Hey </script> <b>'], currentSwipeIndex: 0, createdAt: '2026-10-20T09:00:02Z', updatedAt: '2026-10-20T09:00:02Z' },
      { id: 'm3', chatId: 'chat_1', role: 'assistant', content: 'Bye', thinkingContent: 'hmm', personaName: 'Lyra', swipes: ['Bye'], currentSwipeIndex: 0, createdAt: '2026-10-20T09:00:03Z', updatedAt: '2026-10-20T09:00:03Z' }
    ]
  };
}

test('round trip keeps every field, including unknown ones', () => {
  const pkg = macPackage();
  C.normalize(pkg);
  assert.deepEqual(C.validate(pkg), []);
  const back = C.extractPackage(C.buildHTML(pkg));
  assert.equal(back.chat.minP, 0.05);
  assert.equal(back.chat.scriptState, '{"s":{"n":"1"}}');
  assert.equal(back.chat.personaId, 'persona_9');
  assert.deepEqual(back.messages[0].swipes, ['Hi', 'Hello']);
  assert.equal(back.messages[1].content, 'Hey </script> <b>', '"</script>" in text cannot break the file');
  assert.equal(back.messages[2].thinkingContent, 'hmm');
});

test('content always follows the active swipe; bad swipe index is clamped', () => {
  const pkg = macPackage();
  pkg.messages[0].currentSwipeIndex = 7;
  pkg.messages[0].content = 'stale';
  C.normalize(pkg);
  assert.equal(pkg.messages[0].currentSwipeIndex, 1);
  assert.equal(pkg.messages[0].content, 'Hello');
  assert.deepEqual(C.validate(pkg), []);
});

test('reordered or inserted messages get strictly increasing whole-second times', () => {
  const pkg = macPackage();
  pkg.messages.reverse();
  const n = C.newMessage('user', 'new', 'chat_1'); n.createdAt = 'garbage';
  pkg.messages.splice(1, 0, n);
  C.normalize(pkg);
  const t = pkg.messages.map((m) => Date.parse(m.createdAt));
  for (let i = 1; i < t.length; i++) assert.ok(t[i] > t[i - 1]);
  pkg.messages.forEach((m) => assert.match(m.createdAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/));
  assert.deepEqual(C.validate(pkg), []);
});

test('deleting messages fixes counts and memory pointers, and warns about the graph', () => {
  const pkg = macPackage();
  pkg.messages.splice(1, 2);
  const notes = C.normalize(pkg);
  assert.equal(pkg.chat.messageCount, 1);
  assert.equal(pkg.chat.lastMessageSnippet, 'Hello');
  assert.equal(pkg.chat.summarizedUpTo, 1);
  assert.equal(pkg.chat.memoryCheckpointTurn, 1);
  assert.ok(notes.length >= 2);
  assert.equal(C.memoryWarnings(pkg).length, 1);
});

test('persona and character names apply to the right messages', () => {
  const pkg = macPackage();
  C.setPersonaName(pkg, 'Ari');
  C.setCharacterName(pkg, 'Lyra Vale');
  assert.equal(C.getPersonaName(pkg), 'Ari');
  assert.equal(pkg.messages[1].personaName, 'Ari');
  assert.equal(pkg.messages[0].personaName, 'Lyra Vale');
  assert.equal(pkg.characterName, 'Lyra Vale');
});

test('JanitorAI conversion produces a complete, valid package', () => {
  const pkg = C.fromScraped({ title: 'Night Market', characterName: 'Lyra', personaName: 'Kai', messages: [
    { role: 'assistant', content: 'Hello', thinking: 'plan' }, { role: 'user', content: 'Hi' }] });
  C.normalize(pkg);
  assert.deepEqual(C.validate(pkg), []);
  assert.equal(pkg.messages[0].thinkingContent, 'plan');
  assert.equal(pkg.messages[1].personaName, 'Kai');
  assert.equal(pkg.characterName, 'Lyra');
});

test('validate catches what the iOS decoder would reject', () => {
  const pkg = macPackage();
  C.normalize(pkg);
  delete pkg.chat.bgMode;
  pkg.messages[0].createdAt = '2026-10-20T09:00:01.123Z';
  pkg.chat.messageCount = '3';
  const errs = C.validate(pkg);
  assert.ok(errs.some((e) => e.includes('bgMode')));
  assert.ok(errs.some((e) => e.includes('createdAt')));
  assert.ok(errs.some((e) => e.includes('messageCount')));
});

test('files without a package are not mistaken for one', () => {
  assert.equal(C.extractPackage('<html><body>hi</body></html>'), null);
  assert.equal(C.extractPackage('<script id="doroleplay-chat-data" type="application/json">{bad</script>'), null);
});
