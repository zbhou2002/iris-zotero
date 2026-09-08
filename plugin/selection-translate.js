  async function translateSelectedTextForReader(params) {
    const prefs = getSelectionTranslatePrefs();
    if (!prefs.enabled) throw new Error('Selection translation is disabled');
    const selectedText = normalizeSelectedTextForTranslation(params.selectedText);
    if (!selectedText) throw new Error('No selected text to translate');
    const modelConfig = resolveSelectionTranslateModel();
    if (!modelConfig) throw new Error('No available model for selection translation');
    // Metadata is already local. Never extract the PDF or call a model to
    // prepare a cache before translating a selection.
    const metadata = getDocumentMetadata(params.item, { title: '' });
    const contextText = [metadata.title, metadata.abstractNote].filter(Boolean).join('\n').slice(0, 1800);
    const key = JSON.stringify([params.item.id, selectedText, prefs.sourceLang, prefs.targetLang,
      modelConfig.model, modelConfig.apiBase, modelConfig.providerId, contextText]);
    const results = translateSelectedTextForReader.results ||= new Map();
    const pending = translateSelectedTextForReader.pending ||= new Map();
    params.callbacks?.onStage?.('translate');
    if (results.has(key)) {
      const result = results.get(key);
      results.delete(key);
      results.set(key, result);
      params.callbacks?.onDelta?.(result.translation);
      return result;
    }
    const listener = params.callbacks?.onDelta;
    let task = pending.get(key);
    if (task) {
      if (listener) { if (task.text) listener(task.text); task.listeners.add(listener); }
      try { return await task.promise; }
      finally { task.listeners.delete(listener); }
    }
    task = { text: '', listeners: new Set(listener ? [listener] : []) };
    task.promise = (async () => {
      const raw = await callLLMStream({
        prompt: buildSelectionTranslatePrompt({ selectedText, cacheText: contextText,
          contextMode: 'retrieved-document', sourceLang: prefs.sourceLang, targetLang: prefs.targetLang }),
        model: modelConfig.model, apiBase: modelConfig.apiBase, apiKey: modelConfig.apiKey,
        temperature: 0.2, maxTokens: Math.min(8000, Math.max(1200, selectedText.length * 2))
      }, delta => {
        if (!delta) return;
        task.text += delta;
        for (const callback of task.listeners) { try { callback(delta); } catch {} }
      });
      const translation = String(raw || '').trim();
      if (!translation) throw new Error('Selection translation returned empty content');
      const result = { translation, model: modelConfig.model,
        provider: modelConfig.providerId || modelConfig.providerLabel };
      results.set(key, result);
      while (results.size > 100) results.delete(results.keys().next().value);
      return result;
    })();
    pending.set(key, task);
    try { return await task.promise; }
    finally { pending.delete(key); task.listeners.clear(); }
  }
