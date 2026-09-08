// Gecko chrome documents do not open ordinary target=_blank links in the OS
// browser. Delegate on the panel so streamed and restored messages work too.
function installIrisExternalLinks({ root, launch, report }) {
  root.__irisExternalLinksDispose?.();
  const onLink = event => {
    if (event.defaultPrevented) return;
    if (event.type === 'click' && event.button !== 0) return;
    if (event.type === 'auxclick' && event.button !== 1) return;
    const target = event.target?.nodeType === 3 ? event.target.parentElement : event.target;
    const link = target?.closest?.('a[href]');
    if (!link || !root.contains(link) || !link.closest('.llm-bubble.assistant')) return;
    const href = (link.getAttribute('href') || '').trim();
    // Leave document anchors and Zotero's own navigation to their handlers.
    if (!href || href.startsWith('#') || /^zotero:/i.test(href)) return;
    event.preventDefault();
    event.stopPropagation();
    let url;
    try {
      if (/[\u0000-\u001f\u007f]/.test(href)) throw new Error('Invalid URL');
      url = new URL(href.startsWith('//') ? `https:${href}` : href);
      // Model-generated links must never launch local files or custom protocols.
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Unsupported URL');
    } catch {
      report('invalid');
      return;
    }
    try {
      Promise.resolve(launch(url.href)).catch(() => report('failed'));
    } catch {
      report('failed');
    }
  };
  root.addEventListener('click', onLink, true);
  root.addEventListener('auxclick', onLink, true);
  const dispose = () => {
    root.removeEventListener('click', onLink, true);
    root.removeEventListener('auxclick', onLink, true);
    if (root.__irisExternalLinksDispose === dispose) delete root.__irisExternalLinksDispose;
  };
  root.__irisExternalLinksDispose = dispose;
  return dispose;
}
