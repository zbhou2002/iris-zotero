// PDF selections are draft attachments, never requests. The existing selected
// context store remains authoritative for persistence, sending and history.
function createIrisReaderQuoteBridge() {
  const clients = new Set(), states = new Map();
  const identity = entry => JSON.stringify([entry.text, entry.source || 'pdf', entry.paperContext?.itemId, entry.paperContext?.contextItemId]);
  return {
    register(client) {
      for (const old of clients) if (old.root === client.root || !old.root.isConnected) clients.delete(old);
      clients.add(client);
      return () => clients.delete(client);
    },
    endSelection(selection) {
      const signature = identity({ text: selection.text, source: 'pdf', paperContext: selection.paperContext });
      for (const state of states.values()) {
        if (state.ownerDoc === selection.ownerDoc && state.seen === signature) state.seen = null;
      }
    },
    publish(selection) {
      const groups = new Map();
      for (const client of clients) {
        if (!client.root.isConnected) { clients.delete(client); continue; }
        const target = client.target();
        if (!target?.key || target.ownerDoc !== selection.ownerDoc || target.libraryID !== selection.libraryID) continue;
        if (!target.global && target.attachmentId !== selection.attachmentId && target.paperId !== selection.paperId) continue;
        if (!groups.has(target.key)) groups.set(target.key, []);
        groups.get(target.key).push(client);
      }
      for (const [key, matching] of groups) {
        const client = matching[0];
        const state = states.get(key) || {};
        const entry = { text: selection.text, source: 'pdf', paperContext: selection.paperContext };
        const signature = identity(entry);
        // Repeated popup rendering must not resurrect a removed/sent quote.
        if (!selection.text) { state.seen = null; states.set(key, state); continue; }
        if (state.seen === signature) continue;
        state.seen = signature;
        state.ownerDoc = selection.ownerDoc;
        const entries = client.read(key);
        const next = state.owned ? entries.filter(value => identity(value) !== state.owned) : [...entries];
        if (!next.some(value => identity(value) === signature) && next.length < client.limit) {
          next.push(entry);
          state.owned = signature;
          client.write(key, next);
          for (const subscriber of matching) subscriber.refresh();
        } else if (next.length !== entries.length) {
          client.write(key, next);
          state.owned = null;
          for (const subscriber of matching) subscriber.refresh();
        }
        states.delete(key); states.set(key, state);
        if (states.size > 200) states.delete(states.keys().next().value);
      }
    }
  };
}
var irisReaderQuoteBridge;
function getIrisReaderQuoteBridge() {
  return irisReaderQuoteBridge || (irisReaderQuoteBridge = createIrisReaderQuoteBridge());
}

function renderIrisQuoteCards({ list, entries, chinese }) {
  const doc = list.ownerDocument;
  const make = (tag, className, text) => {
    const node = doc.createElementNS('http://www.w3.org/1999/xhtml', tag);
    node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  list.replaceChildren();
  list.style.display = entries.length ? 'contents' : 'none';
  entries.forEach((entry, index) => {
    const card = make('div', 'llm-selected-context iris-quote-card');
    card.dataset.contextIndex = String(index);
    card.dataset.contextSource = entry.source;
    const icon = make('span', 'iris-quote-icon');
    icon.setAttribute('aria-hidden', 'true');
    const title = make('span', 'iris-quote-title',
      entry.source === 'model' ? (chinese ? '引用回答' : 'Quoted response') : (chinese ? '引用文段' : 'Quoted passage'));
    const remove = make('button', 'llm-selected-context-clear iris-quote-remove');
    remove.type = 'button'; remove.dataset.contextIndex = String(index);
    remove.title = chinese ? '移除引用' : 'Remove quote'; remove.setAttribute('aria-label', remove.title);
    const origin = entry.source === 'model' ? 'Iris' : entry.paperContext?.title || (chinese ? '当前论文' : 'Current paper');
    card.title = `${title.textContent} · ${origin}`;
    card.setAttribute('role', 'group');
    card.setAttribute('aria-label', card.title);
    // Source content belongs in the attachment store, not in the composer DOM.
    // Both PDF and assistant quotes use this exact same compact chip.
    card.append(icon, title, remove);
    list.append(card);
  });
}
