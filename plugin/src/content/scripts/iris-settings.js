/* Settings-only presentation. Reuse live controls and their existing handlers. */
function enhanceIrisSettings({ doc, root, chinese, connectionModeBox, connectionModeTitle,
  connectionModeBody, selectionTranslateGroup, selectionTranslateTitle, selectionTranslateBody,
  oauthTabBtn, customTabBtn, oauthPanel, customPanel, authCards }) {
  if (root.classList.contains('iris-settings')) return;
  root.classList.add('iris-settings');
  const say = (zh,en) => chinese() ? zh : en;
  const el = (tag, cls, text) => {
    const n=doc.createElementNS('http://www.w3.org/1999/xhtml',tag);
    n.className=cls; if(text) n.textContent=text; return n;
  };
  const intro=el('div','iris-settings-intro');
  intro.append(el('h2','',say('设置','Settings')),el('p','',say('连接模型，调整阅读习惯。','Connect your models. Make reading your own.')));
  const stylesheet=el('link','');stylesheet.rel='stylesheet';stylesheet.href='chrome://aidea/content/iris-settings.css';
  root.prepend(stylesheet,intro);
  const observers=[];
  function section(card,title,body,name,description,id) {
    card.classList.add('iris-settings-section');
    title.textContent=name;
    title.classList.add('iris-settings-heading');
    title.setAttribute('role','button'); title.tabIndex=0;
    body.id ||= `iris-settings-${id}`;
    title.setAttribute('aria-controls',body.id);
    const sync=()=>title.setAttribute('aria-expanded',String(title.dataset.collapsed!=='true'));
    sync();
    const observer=new doc.defaultView.MutationObserver(sync);
    observer.observe(title,{attributes:true,attributeFilter:['data-collapsed']}); observers.push(observer);
    title.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();title.click();}});
    const hint=el('p','iris-settings-description',description);
    title.after(hint);
  }
  section(connectionModeBox,connectionModeTitle,connectionModeBody,say('模型连接','Models & connection'),say('选择账号连接，或使用自己的 API 服务。','Use an account or your own API service.'),'connection');
  section(selectionTranslateGroup,selectionTranslateTitle,selectionTranslateBody,say('划词翻译','Selection translation'),say('选中文字后，点击“翻译”才会开始。','Select text, then click Translate to begin.'),'translation');
  oauthTabBtn.textContent=say('账号连接','Account');
  customTabBtn.textContent=say('API 服务','API service');
  const modeBar=oauthTabBtn.parentElement;
  modeBar.setAttribute('role','tablist'); modeBar.setAttribute('aria-label',say('连接方式','Connection method'));
  [oauthTabBtn,customTabBtn].forEach((button,i)=>{
    const panel=i ? customPanel : oauthPanel;
    button.id ||= `iris-connection-tab-${i}`; panel.id ||= `iris-connection-panel-${i}`;
    button.setAttribute('role','tab');button.setAttribute('aria-controls',panel.id);
    panel.setAttribute('role','tabpanel');panel.setAttribute('aria-labelledby',button.id);
    const sync=()=>{const active=button.classList.contains('active');button.setAttribute('aria-selected',String(active));button.tabIndex=active?0:-1;};
    sync();const observer=new doc.defaultView.MutationObserver(sync);
    observer.observe(button,{attributes:true,attributeFilter:['class']});observers.push(observer);
    button.addEventListener('keydown',event=>{
      if(['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) {
        event.preventDefault();const next=event.key==='Home'?oauthTabBtn:event.key==='End'?customTabBtn:i?oauthTabBtn:customTabBtn;
        next.click();next.focus();
      }
    });
  });
  authCards.classList.add('iris-provider-list');
  for(const card of authCards.children) {
    const title=card.querySelector('.llm-set-provider-title');
    const row=card.querySelector('.llm-set-row');
    if(!title || !row) continue;
    card.classList.add('iris-provider');
    const setup=row.querySelector('.llm-provider-setup-btn');
    const login=row.querySelector('.llm-set-btn--secondary');
    const remove=row.querySelector('.llm-set-btn--ghost');
    const status=row.querySelector('.llm-set-status');
    if(!login) continue;
    const original=title.textContent;
    title.title=original;
    title.textContent=original.includes('ChatGPT')?'ChatGPT · Codex':original.includes('Gemini')?'Gemini':original;
    login.textContent=say('登录','Sign in');login.classList.add('iris-provider-login');
    const head=el('div','iris-provider-head');head.append(title,login);
    const more=el('details','iris-provider-more');
    const summary=el('summary','',say('管理连接','Manage connection'));
    const actions=el('div','iris-provider-maintenance');
    if(setup) {setup.textContent=say('安装 / 更新环境','Install / update');actions.append(setup);}
    if(remove) {remove.textContent=say('移除授权','Remove authorization');actions.append(remove);}
    more.append(summary,actions);
    card.replaceChildren(head,more);
    if(status) {status.setAttribute('role','status');card.append(status);}
  }
  const essence=root.querySelector('.iris-essence-settings');
  if(essence) {
    essence.classList.add('iris-settings-section');
    const summary=essence.querySelector('summary');
    summary.classList.add('iris-settings-heading');
    const name=el('span','',say('精华标记','Highlight essence'));
    const description=el('span','iris-settings-description',say('自定义“什么值得高亮”的筛选标准。','Choose what makes a passage worth highlighting.'));
    summary.replaceChildren(name,description);
    const body=el('div','iris-prompt-editor');
    for(const child of [...essence.children]) if(child!==summary) body.append(child);
    const input=body.querySelector('textarea'); input.rows=10;
    input.style.removeProperty('min-height'); input.style.removeProperty('margin');
    const controls=body.querySelectorAll('button');
    controls[0]?.classList.add('iris-settings-save');
    const hint=body.querySelector('p');if(hint)hint.textContent=say('保存后，下次标记使用新标准；不改动已有高亮。','Changes apply to the next run. Existing highlights stay unchanged.');
    const footer=controls[0]?.parentElement;
    if(footer)footer.classList.add('iris-prompt-actions');
    const status=footer?.querySelector('[role="status"]');if(status)status.classList.add('iris-settings-feedback');
    essence.append(body);
  }
  // Description already states the activation behavior; avoid repeating a paragraph.
  const enableHint=selectionTranslateBody.querySelector('[id$="selection-translate-enable-hint"]');
  if(enableHint)enableHint.hidden=true;
  const modelHint=selectionTranslateBody.querySelector('[id$="selection-translate-model-hint"]');
  if(modelHint)modelHint.textContent=say('与对话面板共用模型列表。','Uses the same model list as chat.');
  doc.defaultView.addEventListener('unload',()=>observers.forEach(o=>o.disconnect()),{once:true});
}
