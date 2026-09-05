(()=>{
  const hash=new URLSearchParams(location.hash.replace(/^#/,''));
  let TOKEN=sessionStorage.getItem('gb-token')||'';
  const incoming=hash.get('token')||'';
  if(/^[a-f0-9]{64}$/.test(incoming)){TOKEN=incoming;sessionStorage.setItem('gb-token',incoming);}
  if(location.hash)history.replaceState(null,'',location.pathname+location.search);

  const I18N={
    ru:{
      connecting:'Подключение…',technicalInfo:'Техническая информация',project:'Проект',projectSettings:'Настройки проекта',conversations:'Диалоги',history:'История',settings:'Настройки',language:'Язык',geminiStatus:'Статус Gemini',newThread:'Новый диалог',pendingWork:'Неприменённые изменения',agentWorkflowHelp:'Проверь изменения перед переносом в рабочую папку.',authChecking:'Проверяем вход…',googleSignIn:'Войти через Google',copyContext:'Скопировать контекст проекта',addChatgptPanel:'Добавить панель в ChatGPT',
      modeAsk:'Спросить',modeReview:'Анализ проекта',modeEdit:'Изменить файлы',modeAskHelp:'Обычный разговор с Gemini. Файлы проекта не используются.',modeReviewHelp:'Gemini читает безопасную копию выбранной папки, но ничего в ней не изменяет.',modeEditHelp:'Gemini меняет только отдельную копию. Перед переносом в проект ты увидишь предпросмотр и сам подтвердишь применение.',
      emptyTitle:'Чем займёмся?',emptyIntro:'Можно просто задать вопрос или подключить папку проекта для безопасного анализа и изменений.',emptyAsk:'Обычный разговор с Gemini. Папка проекта не нужна.',emptyReview:'Gemini прочитает безопасную копию проекта, но ничего не изменит.',emptyEdit:'Изменения идут в отдельную копию и применяются только после предпросмотра.',
      promptPlaceholder:'Напиши Gemini…',sendHint:'Ctrl + Enter — отправить',cancel:'Отменить',send:'Отправить',settingsLead:'Папка нужна только для анализа проекта и изменения файлов.',projectName:'Название',workspace:'Папка проекта',workspaceHint:'Можно вставить «Копировать как путь» из Проводника — кавычки допустимы.',projectContext:'Контекст для Gemini',snapshotHint:'Для анализа и изменений Gemini получает только безопасную копию. Секреты, .git/.gemini, символические ссылки и типичные папки сборки/зависимостей исключаются.',save:'Сохранить',newProject:'Новый проект',newProjectLead:'Название можно изменить позже. Папку проекта можно подключить отдельно.',create:'Создать',close:'Закрыть',
      starterProjectName:'Мой проект',newThreadTitle:'Новый диалог',workspaceNotSet:'Папка не выбрана',workspaceSet:'Папка: {path}',bridgeWorking:'Gemini Bridge работает',bridgeUnavailable:'Gemini Bridge недоступен',authPresent:'Google подключён',authMissing:'Требуется вход в Google',authUnknown:'Статус входа неизвестен',
      runQueued:'Запуск…',runRunning:'Gemini отвечает…',runCompleted:'Готово',runWaitingApply:'Изменения готовы к просмотру',runRecovery:'Доступно восстановление',runApplying:'Безопасно применяем…',runApplied:'Применено',runConflict:'Обнаружены внешние изменения',runApplyRecovery:'Нужно восстановление применения',runDiscarded:'Отменено',runFailed:'Требуется действие',runCancelled:'Отменено пользователем',
      you:'ВЫ',gemini:'◆ GEMINI',geminiResumed:'◆ GEMINI · продолжение',resuming:'Продолжаем незавершённый запрос…',starting:'Запуск…',cancelling:'Отменяем…',
      failedTitle:'Не удалось получить ответ Gemini',cancelledTitle:'Запрос отменён',retry:'Повторить',technicalDetails:'Технические подробности',googleSignInHelp:'Помощь со входом Google',reconnectGoogle:'Переподключить Google',reconnectGoogleHint:'Откроется окно Antigravity и браузер Google. Заверши вход — Bridge подхватит сессию автоматически.',agentStepEdit:'Изменения',agentStepReview:'Проверка',agentStepApply:'Применение',agentStepFinish:'Готово',agentResolve:'Разрешение конфликта',previewLoaded:'Предпросмотр открыт',
      errWorkspaceBusy:'Эта папка занята другим анализом или изменением. Обычный режим «Спросить» можно использовать в другом диалоге; иначе дождись завершения операции.',errThreadBusy:'В этом диалоге уже выполняется запрос. Дождись его завершения или отмени его.',errPending:'В проекте есть неприменённые изменения агента. Сначала просмотри и примени, согласуй или отмени их.',errMaintenance:'Gemini Bridge обслуживается или завершает работу. Дождись окончания Setup/Repair и повтори.',errWorkspaceRequired:'Для анализа проекта и изменения файлов нужна локальная папка. Открой «Настройки проекта» и выбери папку.',errBusy:'Сейчас заняты все процессы Gemini. Подожди завершения одного запроса.',errPairing:'Связь Dashboard с Gemini Bridge устарела. Открой Gemini Bridge заново через локальный ярлык.',
      errAuth:'Gemini не смог использовать аккаунт Google. Повтори вход в Google для Gemini Bridge, затем повтори этот запрос.',errQuota:'Gemini временно ограничил запросы или исчерпана текущая квота. Подожди немного и повтори.',errNetwork:'Gemini Bridge не смог связаться с провайдером. Проверь интернет-соединение и повтори.',errRuntime:'Локальный Gemini runtime недоступен. Запусти Setup/Repair Gemini Bridge и повтори.',errProtocol:'Gemini вернул данные, которые Bridge не может безопасно обработать. Повтори один раз; если ошибка повторится, сохрани технические подробности.',errProvider:'Gemini не завершил запрос. Сообщение сохранено — его можно повторить или раскрыть технические подробности ниже.',errTimeout:'Локальный Host не ответил вовремя. Проверь, что Gemini Bridge запущен.',
      applyConflict:'Обнаружены внешние изменения. Конфликтующий файл не был перезаписан. Посмотри Preview и используй Reconcile после выбора нужной версии.',applyDone:'Изменения применены к рабочей папке.',reconcileDone:'Reconcile подтвердил безопасный результат — изменения применены к рабочей папке.',reconcileReady:'Reconcile проверил рабочую папку. Оставшиеся изменения можно просмотреть и применить.',discardDone:'Снимок изменений агента удалён. Уже применённые файлы в рабочей папке автоматически не откатываются.',operationDone:'Операция завершена.',
      preview:'Предпросмотр',apply:'Применить',reconcile:'Согласовать',discard:'Отменить изменения',discardConfirm:'Удалить локальную копию изменений агента? Уже применённые файлы это не откатит.',recoveryPid:'Bridge подтвердил, что предыдущий процесс Gemini (PID {pid}) всё ещё жив. Дождись его завершения; не завершай процесс только по номеру PID.',
      projectSaved:'Проект сохранён',projectCreated:'Проект создан',handoffCopied:'Контекст скопирован',handoffManual:'Контекст показан для ручного копирования',clipboardBlocked:'Браузер запретил доступ к буферу. Скопируй контекст вручную:',
      authHelpTitle:'Вход в Google',authHelpBody:'Gemini Bridge запускает официальный Antigravity CLI и открывает Google-вход напрямую.',authCodeTitle:'Завершить вход в Google',authCodeLead:'После подтверждения Google покажет одноразовый код. Вставь его сюда — Bridge передаст код ожидающему Antigravity CLI.',authCodeLabel:'Код авторизации',authCodeWaiting:'Ожидаем код из браузера Google…',authCodeVerifying:'Проверяем код…',authCodeSuccess:'Google подключён.',authCodeFailed:'Не удалось завершить вход. Запусти авторизацию ещё раз.',authCodeSubmit:'Подтвердить код',webHelpTitle:'Панель Gemini внутри ChatGPT',webHelpBody:'Chrome/Edge → Расширения → Режим разработчика → «Загрузить распакованное расширение» → выбери папку %LOCALAPPDATA%\\GeminiBridge\\web-extension. После Setup/Repair нажми «Обновить» у расширения.',
      noProjectName:'Введи название проекта.'
    },
    en:{
      connecting:'Connecting…',technicalInfo:'Technical information',project:'Project',projectSettings:'Project settings',conversations:'Conversations',history:'History',settings:'Settings',language:'Language',geminiStatus:'Gemini status',newThread:'New thread',pendingWork:'Pending Agent work',agentWorkflowHelp:'Review the changes before they reach the live workspace.',authChecking:'Checking sign-in…',googleSignIn:'Sign in with Google',copyContext:'Copy project context',addChatgptPanel:'Add panel to ChatGPT',
      modeAsk:'Ask',modeReview:'Project review',modeEdit:'Edit files',modeAskHelp:'A normal Gemini conversation. Project files are not used.',modeReviewHelp:'Gemini reads a sanitized copy of the selected folder but cannot change it.',modeEditHelp:'Gemini edits only a separate copy. You Preview the changes before anything is applied to the live project.',
      emptyTitle:'What would you like to do?',emptyIntro:'Ask a normal question, or connect a project folder for safe review and edits.',emptyAsk:'A normal Gemini conversation. No project folder is required.',emptyReview:'Gemini reads a sanitized copy of the project and cannot change it.',emptyEdit:'Edits happen in a separate copy and are applied only after Preview.',
      promptPlaceholder:'Message Gemini…',sendHint:'Ctrl + Enter — send',cancel:'Cancel',send:'Send',settingsLead:'A project folder is needed only for Project review and Edit files.',projectName:'Name',workspace:'Project folder',workspaceHint:'Windows “Copy as path” is accepted, including surrounding quotes.',projectContext:'Context for Gemini',snapshotHint:'Review and edits use a sanitized snapshot. Secrets, .git/.gemini, symlinks and common build/dependency folders are excluded.',save:'Save',newProject:'New project',newProjectLead:'You can rename it later and connect the project folder separately.',create:'Create',close:'Close',
      starterProjectName:'My project',newThreadTitle:'New Gemini thread',workspaceNotSet:'No project folder selected',workspaceSet:'Folder: {path}',bridgeWorking:'Gemini Bridge is running',bridgeUnavailable:'Gemini Bridge is unavailable',authPresent:'Google connected',authMissing:'Google sign-in required',authUnknown:'Sign-in status unknown',
      runQueued:'Starting…',runRunning:'Gemini is working…',runCompleted:'Completed',runWaitingApply:'Ready to preview and apply',runRecovery:'Recovery is available',runApplying:'Applying safely…',runApplied:'Applied',runConflict:'External change detected',runApplyRecovery:'Apply needs recovery',runDiscarded:'Discarded',runFailed:'Needs attention',runCancelled:'Cancelled',
      you:'YOU',gemini:'◆ GEMINI',geminiResumed:'◆ GEMINI · resumed',resuming:'Resuming this active Gemini run…',starting:'Starting…',cancelling:'Cancelling…',
      failedTitle:'Could not get a Gemini response',cancelledTitle:'Request cancelled',retry:'Retry',technicalDetails:'Technical details',googleSignInHelp:'Google sign-in help',reconnectGoogle:'Reconnect Google',reconnectGoogleHint:'Antigravity and your Google browser sign-in will open. Complete sign-in; Bridge will pick up the session automatically.',agentStepEdit:'Edit',agentStepReview:'Review',agentStepApply:'Apply',agentStepFinish:'Done',agentResolve:'Resolve conflict',previewLoaded:'Preview opened',
      errWorkspaceBusy:'This workspace is busy with another Review or Agent Edit. Ask still works in another Gemini thread; otherwise wait for the workspace operation to finish.',errThreadBusy:'This Gemini thread already has a run in progress. Wait for it to finish or cancel it, then try again.',errPending:'This workspace has pending Agent changes. Preview and Apply, Reconcile, or Discard them before starting another Review/Agent Edit.',errMaintenance:'Gemini Bridge is in maintenance or shutting down. Wait for Setup/Repair to finish, then try again.',errWorkspaceRequired:'Review and Agent Edit need a local workspace. Open Project settings and choose the project folder first.',errBusy:'Gemini Bridge is already using all available Gemini process slots. Wait for one run to finish.',errPairing:'Dashboard pairing is no longer valid. Open Gemini Bridge again from its local launcher.',
      errAuth:'Gemini could not use the Google account. Sign in to Google for Gemini Bridge again, then retry this message.',errQuota:'Gemini is temporarily rate-limited or the current quota is exhausted. Wait a little and retry.',errNetwork:'Gemini Bridge could not reach the provider. Check the internet connection and retry.',errRuntime:'The managed Gemini runtime is not available. Run Gemini Bridge Setup/Repair, then try again.',errProtocol:'Gemini returned data that Bridge could not safely interpret. Retry once; if it repeats, keep the technical details for diagnosis.',errProvider:'Gemini did not complete this request. The message was kept, so you can retry it or inspect the technical details below.',errTimeout:'The local Gemini Bridge Host did not respond in time. Check that Gemini Bridge is running.',
      applyConflict:'External changes were detected. The conflicting file was left unchanged; nothing was overwritten at the conflict. Review Preview and choose Reconcile after deciding which version should win.',applyDone:'Changes were applied to the live workspace.',reconcileDone:'Reconcile confirmed the safe result and the changes are applied to the live workspace.',reconcileReady:'Reconcile verified the workspace. The remaining changes are safe to Preview and Apply.',discardDone:'The Agent snapshot was discarded. Live workspace files already applied, if any, are not rolled back.',operationDone:'Operation completed.',
      preview:'Preview',apply:'Apply',reconcile:'Reconcile',discard:'Discard',discardConfirm:'Discard this local Agent snapshot? This does not roll back files already applied.',recoveryPid:'Bridge verified that its previous Gemini process (PID {pid}) is still alive. Wait for it to exit; do not terminate a process based on PID alone.',
      projectSaved:'Project saved',projectCreated:'Project created',handoffCopied:'Handoff copied',handoffManual:'Handoff shown for manual copy',clipboardBlocked:'Clipboard access was blocked. Copy the handoff manually:',
      authHelpTitle:'Google sign-in',authHelpBody:'Gemini Bridge starts the official Antigravity CLI and Google sign-in directly.',authCodeTitle:'Complete Google sign-in',authCodeLead:'After Google approval, a one-time code is shown. Paste it here and Bridge will send it to the waiting Antigravity CLI.',authCodeLabel:'Authorization code',authCodeWaiting:'Waiting for the code from Google…',authCodeVerifying:'Verifying code…',authCodeSuccess:'Google connected.',authCodeFailed:'Could not complete sign-in. Start Google sign-in again.',authCodeSubmit:'Submit code',webHelpTitle:'Gemini panel inside ChatGPT',webHelpBody:'Chrome/Edge → Extensions → Developer mode → Load unpacked → choose %LOCALAPPDATA%\\GeminiBridge\\web-extension. After Setup/Repair, press Reload on the extension.',
      noProjectName:'Enter a project name.'
    }
  };

  function storedLanguage(){try{return localStorage.getItem('gb-lang')||'';}catch{return '';}}
  const browserLanguage=String((navigator.languages&&navigator.languages[0])||navigator.language||'en').toLowerCase();
  let lang=/^(ru)(-|$)/.test(storedLanguage())?'ru':/^(en)(-|$)/.test(storedLanguage())?'en':browserLanguage.startsWith('ru')?'ru':'en';
  function t(key,vars={}){let out=I18N[lang]?.[key]??I18N.en[key]??key;for(const [k,v] of Object.entries(vars))out=out.replaceAll(`{${k}}`,String(v));return out;}

  const $=id=>document.getElementById(id);
  const project=$('project'),thread=$('thread'),pending=$('pending'),messages=$('messages'),prompt=$('prompt'),send=$('send'),cancel=$('cancel'),runState=$('runState'),health=$('health'),healthDot=$('healthDot'),authStatus=$('authStatus'),versionInfo=$('versionInfo'),workspaceState=$('workspaceState'),dialog=$('projectDialog'),threadSection=$('threadSection'),pendingSection=$('pendingSection'),emptyState=$('emptyState'),modeHelp=$('modeHelp'),language=$('language'),newProjectDialog=$('newProjectDialog'),helpDialog=$('helpDialog'),authDialog=$('authDialog'),authCode=$('authCode'),authCodeStatus=$('authCodeStatus'),submitAuthCodeButton=$('submitAuthCode'),composerMode=$('composerMode');
  let currentRun=null,timer=null,pollInFlight=false,pollGeneration=0,pendingSubmission=null,lastProjects=[];
  const FETCH_TIMEOUT_MS=10000;

  function applyStaticI18n(){
    document.documentElement.lang=lang;language.value=lang;
    document.querySelectorAll('[data-i18n]').forEach(el=>{el.textContent=t(el.dataset.i18n);});
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el=>{el.placeholder=t(el.dataset.i18nPlaceholder);});
    renderModeHelp();updateWorkspaceState();
  }
  async function setLanguage(next,{persist=true}={}){lang=next==='en'?'en':'ru';if(persist)try{localStorage.setItem('gb-lang',lang);}catch{}applyStaticI18n();if(thread.value)await loadConversation();if(project.value)await loadPending();await loadHealth();}

  function errorInfo(raw){
    const technical=String(raw?.message||raw||'Unknown error');const code=technical.split(':')[0].trim();
    const known={WORKSPACE_BUSY:'errWorkspaceBusy',THREAD_BUSY:'errThreadBusy',PENDING_AGENT_CHANGES:'errPending',HOST_MAINTENANCE:'errMaintenance',WORKSPACE_REQUIRED:'errWorkspaceRequired',GEMINI_BUSY:'errBusy',PAIRING_REQUIRED:'errPairing',BRIDGE_TIMEOUT:'errTimeout'};
    if(known[code])return {code,kind:'bridge',message:t(known[code]),technical};
    if(/(?:oauth|auth(?:entication|orization)?|sign[ -]?in|log[ -]?in|credential|unauthenticated|not logged)/i.test(technical))return {code,kind:'auth',message:t('errAuth'),technical};
    if(/(?:429|quota|rate[ _-]?limit|resource_exhausted|too many requests)/i.test(technical))return {code,kind:'quota',message:t('errQuota'),technical};
    if(/(?:ENOTFOUND|ECONN|ETIMEDOUT|ECONNRESET|network|fetch failed|socket hang up)/i.test(technical))return {code,kind:'network',message:t('errNetwork'),technical};
    if(code==='GEMINI_CLI_NOT_AVAILABLE'||code.startsWith('GEMINI_VERSION_'))return {code,kind:'runtime',message:t('errRuntime'),technical};
    if(code.startsWith('GEMINI_PROTOCOL'))return {code,kind:'protocol',message:t('errProtocol'),technical};
    if(code.startsWith('GEMINI_RESULT_ERROR')||code.startsWith('GEMINI_EXIT_'))return {code,kind:'provider',message:t('errProvider'),technical};
    return {code,kind:'unknown',message:technical,technical};
  }
  function classifyError(raw){return errorInfo(raw);}
  function friendlyError(raw){return errorInfo(raw).message;}

  function runLabel(status){const key={QUEUED:'runQueued',RUNNING:'runRunning',COMPLETED:'runCompleted',WAITING_APPLY:'runWaitingApply',RECOVERY_REQUIRED:'runRecovery',APPLYING:'runApplying',APPLIED:'runApplied',APPLY_CONFLICT:'runConflict',APPLY_RECOVERY_REQUIRED:'runApplyRecovery',DISCARDED:'runDiscarded',FAILED:'runFailed',CANCELLED:'runCancelled'}[status];return key?t(key):String(status||'');}
  function setRunStatus(value,status=''){runState.textContent=value||'';runState.dataset.state=String(status||'').toLowerCase();}
  function agentProgress(status,previewed=false){
    const conflict=['RECOVERY_REQUIRED','APPLY_CONFLICT','APPLY_RECOVERY_REQUIRED'].includes(status);
    const applying=status==='APPLYING';
    const finished=['APPLIED','DISCARDED','COMPLETED'].includes(status);
    const waiting=status==='WAITING_APPLY';
    const active=['QUEUED','RUNNING'].includes(status);
    const steps=[
      {label:t('agentStepEdit'),state:(active?'current':'done')},
      {label:t('agentStepReview'),state:(active?'todo':(waiting&&!previewed?'current':'done'))},
      {label:conflict?t('agentResolve'):t('agentStepApply'),state:(active?'todo':waiting?(previewed?'current':'todo'):(conflict||applying?'current':finished?'done':'todo'))},
      {label:t('agentStepFinish'),state:finished?'done':'todo'}
    ];
    return steps;
  }
  function renderAgentProgress(card,status,previewed=false){
    let list=card.querySelector('.agent-progress');if(!list){list=document.createElement('ol');list.className='agent-progress';list.setAttribute('aria-label',t('pendingWork'));card.append(list);}
    list.textContent='';for(const step of agentProgress(status,previewed)){const li=document.createElement('li');li.dataset.state=step.state;const dot=document.createElement('span');dot.className='agent-step-dot';dot.setAttribute('aria-hidden','true');const label=document.createElement('span');label.textContent=step.label;li.append(dot,label);list.append(li);}
  }
  function managementOutcome(action,out){const status=out?.run?.status||out?.status||'';if(status==='APPLY_CONFLICT')return t('applyConflict');if(action==='apply'&&status==='APPLIED')return t('applyDone');if(action==='reconcile'&&status==='APPLIED')return t('reconcileDone');if(action==='reconcile'&&status==='WAITING_APPLY')return t('reconcileReady');if(action==='discard'||status==='DISCARDED')return t('discardDone');return runLabel(status)||t('operationDone');}
  function mode(){return document.querySelector('input[name="mode"]:checked').value;}
  function modeDescriptions(){return {ask:{title:t('modeAsk'),description:t('modeAskHelp')},review:{title:t('modeReview'),description:t('modeReviewHelp')},edit:{title:t('modeEdit'),description:t('modeEditHelp')}};}
  function renderModeHelp(){const d=modeDescriptions()[mode()];if(d){modeHelp.textContent=`${d.title} · ${d.description}`;composerMode.textContent=d.title;composerMode.dataset.mode=mode();}}
  function setMode(value){const radio=document.querySelector(`input[name="mode"][value="${value}"]`);if(radio)radio.checked=true;renderModeHelp();}
  function updateEmptyState(){const started=messages.children.length>0||Boolean(currentRun);document.body.classList.toggle('gb-chat-started',started);emptyState.setAttribute('aria-hidden',started?'true':'false');emptyState.inert=started;}
  function resizePrompt(){prompt.style.height='auto';const h=Math.min(prompt.scrollHeight,220);prompt.style.height=`${Math.max(h,44)}px`;prompt.style.overflowY=prompt.scrollHeight>220?'auto':'hidden';}
  function updateWorkspaceState(){const p=lastProjects.find(x=>x.id===project.value);workspaceState.textContent=p?.workspace?t('workspaceSet',{path:p.workspace}):t('workspaceNotSet');workspaceState.title=p?.workspace||'';}

  async function api(path,{method='GET',body=null,timeoutMs=FETCH_TIMEOUT_MS}={}){
    if(!TOKEN)throw new Error('PAIRING_REQUIRED');const h={'X-Gemini-Bridge-Token':TOKEN};if(body!==null)h['Content-Type']='application/json';const controller=new AbortController();const tm=setTimeout(()=>controller.abort(),timeoutMs);
    try{const r=await fetch(path,{method,headers:h,body:body===null?undefined:JSON.stringify(body),cache:'no-store',signal:controller.signal});const j=await r.json().catch(()=>({error:`HTTP_${r.status}`}));if(!r.ok)throw new Error(j.error||`HTTP_${r.status}`);return j;}
    catch(e){if(e?.name==='AbortError')throw new Error('BRIDGE_TIMEOUT');throw e;}finally{clearTimeout(tm);}
  }

  async function copyOrFallback(text){try{await navigator.clipboard.writeText(text);runState.textContent=t('handoffCopied');}catch{window.prompt(t('clipboardBlocked'),text);runState.textContent=t('handoffManual');}}
  function add(who,text,user=false){const d=document.createElement('div');d.className='msg'+(user?' user':'');const h=document.createElement('div');h.className='who';h.textContent=who;const b=document.createElement('div');b.textContent=text||'';d.append(h,b);messages.append(d);messages.scrollTop=messages.scrollHeight;updateEmptyState();return b;}

  let authPollTimer=null;
  function stopAuthPoll(){if(authPollTimer){clearInterval(authPollTimer);authPollTimer=null;}}
  async function pollGoogleAuth(){
    try{const a=await api('/v1/auth/status');if(a.authenticated===true){stopAuthPoll();authStatus.textContent=t('authPresent');authStatus.className='subtle';authCodeStatus.textContent=t('authCodeSuccess');$('authHelp').disabled=false;setTimeout(()=>{if(authDialog.open)authDialog.close();},450);return;}const session=await api('/v1/auth/session');if(['failed','expired','cancelled'].includes(session.status)){stopAuthPoll();authCodeStatus.textContent=t('authCodeFailed');submitAuthCodeButton.disabled=false;$('authHelp').disabled=false;}}catch{}
  }
  async function startGoogleAuth(){
    const b=$('authHelp');b.disabled=true;authStatus.textContent=lang==='ru'?'Открываем вход Google…':'Opening Google sign-in…';authCode.value='';authCodeStatus.textContent=t('authCodeWaiting');submitAuthCodeButton.disabled=false;
    try{await api('/v1/auth/start',{method:'POST',body:{}});if(!authDialog.open)authDialog.showModal();setTimeout(()=>authCode.focus(),0);stopAuthPoll();authPollTimer=setInterval(pollGoogleAuth,2000);setTimeout(()=>{if(authPollTimer){stopAuthPoll();b.disabled=false;}},5*60*1000);}
    catch(e){b.disabled=false;authStatus.textContent=t('authMissing');addTransientError(e,()=>startGoogleAuth());}
  }
  async function submitGoogleAuthCode(){
    const code=authCode.value.trim();if(code.length<8){authCode.focus();return;}submitAuthCodeButton.disabled=true;authCodeStatus.textContent=t('authCodeVerifying');
    try{await api('/v1/auth/code',{method:'POST',body:{code}});authCode.value='';await pollGoogleAuth();}
    catch(e){authCode.value='';submitAuthCodeButton.disabled=false;authCodeStatus.textContent=friendlyError(e);authCode.focus();}
  }
  async function cancelGoogleAuth(){stopAuthPoll();try{await api('/v1/auth/cancel',{method:'POST',body:{}});}catch{}authCode.value='';$('authHelp').disabled=false;if(authDialog.open)authDialog.close();}

  async function loadHealth(){
    try{const h=await api('/v1/health');health.textContent=t('bridgeWorking');healthDot.className='status-dot ok';versionInfo.textContent=`Host ${h.version} · Antigravity ${h.gemini.version||h.gemini.error||'not ready'}`;const credentialsPresent=h.auth?.credentialsPresent;authStatus.textContent=credentialsPresent===true?t('authPresent'):credentialsPresent===false?t('authMissing'):t('authUnknown');authStatus.className='subtle'+(credentialsPresent===false?' danger-text':'');}
    catch(e){health.textContent=t('bridgeUnavailable');healthDot.className='status-dot bad';versionInfo.textContent=friendlyError(e);authStatus.textContent=t('authUnknown');}
  }
  async function loadProjects(keep=true){
    const r=await api('/v1/projects');let projects=r.projects||[];if(projects.length===0){const created=await api('/v1/projects',{method:'POST',body:{name:t('starterProjectName')}});projects=[created.project];}
    lastProjects=projects;const old=keep?project.value:null;project.textContent='';for(const p of projects){const o=document.createElement('option');o.value=p.id;o.textContent=p.name;project.append(o);}if(old&&[...project.options].some(o=>o.value===old))project.value=old;updateWorkspaceState();
    if(project.value){await loadThreads();await loadPending();}else{thread.textContent='';messages.textContent='';threadSection.hidden=true;pendingSection.hidden=true;updateEmptyState();}
  }
  async function loadThreads(preferred=null){
    if(!project.value)return;const r=await api(`/v1/projects/${encodeURIComponent(project.value)}/threads`);const old=preferred||thread.value;thread.textContent='';for(const th of r.threads||[]){const o=document.createElement('option');o.value=th.id;o.textContent=th.title;thread.append(o);}if(old&&[...thread.options].some(o=>o.value===old))thread.value=old;threadSection.hidden=thread.options.length===0;if(thread.value)await loadConversation();else{messages.textContent='';updateEmptyState();}
  }
  function addFailure(x){
    add(t('you'),x.prompt||'',true);const info=classifyError(x.error||x.status||'FAILED');const d=document.createElement('div');d.className='msg error-card';const h=document.createElement('div');h.className='who';h.textContent='GEMINI BRIDGE';const title=document.createElement('strong');title.textContent=x.status==='CANCELLED'?t('cancelledTitle'):t('failedTitle');const body=document.createElement('div');body.textContent=info.message;const actions=document.createElement('div');actions.className='row error-actions';const retry=document.createElement('button');retry.type='button';retry.textContent=t('retry');retry.onclick=()=>retryFailedRun(x);actions.append(retry);
    if(info.kind==='auth'){const auth=document.createElement('button');auth.type='button';auth.textContent=t('reconnectGoogle');auth.onclick=()=>{let note=d.querySelector('.reconnect-note');if(!note){note=document.createElement('div');note.className='reconnect-note';note.textContent=t('reconnectGoogleHint');actions.after(note);}authStatus.textContent=t('authMissing');startGoogleAuth();};actions.append(auth);authStatus.textContent=t('authMissing');}
    const details=document.createElement('details');details.className='technical-details';const summary=document.createElement('summary');summary.textContent=t('technicalDetails');const pre=document.createElement('pre');pre.textContent=info.technical;details.append(summary,pre);d.append(h,title,body,actions,details);messages.append(d);messages.scrollTop=messages.scrollHeight;updateEmptyState();
  }
  function addTransientError(raw,retry){
    const info=classifyError(raw);const d=document.createElement('div');d.className='msg error-card transient-error';const h=document.createElement('div');h.className='who';h.textContent='GEMINI BRIDGE';const title=document.createElement('strong');title.textContent=t('failedTitle');const body=document.createElement('div');body.textContent=info.message;const actions=document.createElement('div');actions.className='row error-actions';if(retry){const b=document.createElement('button');b.type='button';b.textContent=t('retry');b.onclick=()=>{d.remove();retry();};actions.append(b);}if(info.kind==='auth'){const a=document.createElement('button');a.type='button';a.textContent=t('reconnectGoogle');a.onclick=()=>{startGoogleAuth();};actions.append(a);}const details=document.createElement('details');details.className='technical-details';const summary=document.createElement('summary');summary.textContent=t('technicalDetails');const pre=document.createElement('pre');pre.textContent=info.technical;details.append(summary,pre);d.append(h,title,body,actions,details);messages.append(d);messages.scrollTop=messages.scrollHeight;updateEmptyState();return d;
  }
  async function loadConversation(){messages.textContent='';if(!thread.value){updateEmptyState();return;}const r=await api(`/v1/threads/${encodeURIComponent(thread.value)}/conversation?limit=100`);for(const item of r.items||[]){if(item.kind==='message')add(item.role==='user'?t('you'):t('gemini'),item.content,item.role==='user');else if(item.kind==='failed-run')addFailure(item);}updateEmptyState();}
  async function retryFailedRun(x){if(x.projectId&&project.value!==x.projectId){project.value=x.projectId;await loadThreads(x.threadId||null);}else if(x.threadId&&thread.value!==x.threadId){await loadThreads(x.threadId);}setMode(x.mode||'ask');prompt.value=x.prompt||'';resizePrompt();prompt.focus();await submitPrompt({promptText:x.prompt||'',selectedMode:x.mode||'ask',threadIdOverride:x.threadId||null});}

  async function openSettings(){const r=await api('/v1/projects');lastProjects=r.projects||lastProjects;const p=lastProjects.find(x=>x.id===project.value);if(!p)return;$('pname').value=p.name||'';$('workspace').value=p.workspace||'';$('context').value=p.context||'';dialog.showModal();}
  async function preflightWorkspace(selectedMode=mode()){if(selectedMode==='ask')return true;const r=await api('/v1/projects');lastProjects=r.projects||lastProjects;const p=lastProjects.find(x=>x.id===project.value);if(p?.workspace)return true;setRunStatus(friendlyError('WORKSPACE_REQUIRED'),'ERROR');await openSettings();return false;}

  async function performManagement(x,action,button=null){
    if(button)button.disabled=true;
    const pendingLabel=action==='apply'?t('runApplying'):action==='reconcile'?t('runRecovery'):t('runDiscarded');
    setRunStatus(pendingLabel,action==='apply'?'APPLYING':action==='reconcile'?'RECOVERY_REQUIRED':'DISCARDED');
    try{const out=await api(`/v1/runs/${x.id}/${action}`,{method:'POST',body:{}});const status=out?.run?.status||out?.status||'';setRunStatus(managementOutcome(action,out),status);await loadPending();await loadConversation();}
    catch(e){setRunStatus(friendlyError(e),'ERROR');if(button)button.disabled=false;}
  }
  async function loadPending(){
    if(!project.value){pendingSection.hidden=true;return;}
    const r=await api(`/v1/projects/${encodeURIComponent(project.value)}/pending`);pending.textContent='';const runs=r.runs||[];pendingSection.hidden=runs.length===0;const active=runs.find(x=>['QUEUED','RUNNING'].includes(x.status));
    for(const x of runs){
      const d=document.createElement('div');d.className='pcard';d.dataset.runStatus=String(x.status||'').toLowerCase();
      const heading=document.createElement('div');heading.className='pcard-heading';const title=document.createElement('strong');title.textContent=modeDescriptions()[x.mode]?.title||x.mode;const badge=document.createElement('span');badge.className='pcard-status';badge.textContent=runLabel(x.status);heading.append(title,badge);d.append(heading);renderAgentProgress(d,x.status,false);
      if(x.error){const er=document.createElement('div');er.className='hint';er.textContent=friendlyError(x.error);d.append(er);}if(x.recoveryPid){const note=document.createElement('div');note.className='hint';note.textContent=t('recoveryPid',{pid:x.recoveryPid});d.append(note);}if(x.result?.diffSummary){const sm=document.createElement('pre');sm.className='diffsummary';sm.textContent=x.result.diffSummary;d.append(sm);}
      const row=document.createElement('div');row.className='row agent-actions';
      if(['WAITING_APPLY','RECOVERY_REQUIRED','APPLY_CONFLICT','APPLY_RECOVERY_REQUIRED'].includes(x.status)){
        const pv=document.createElement('button');pv.type='button';pv.textContent=t('preview');pv.onclick=async()=>{pv.disabled=true;try{const out=await api(`/v1/runs/${x.id}/preview`);let pre=d.querySelector('.preview');if(!pre){pre=document.createElement('pre');pre.className='preview';d.append(pre);}pre.textContent=out.preview.items.map(i=>`### ${i.type.toUpperCase()} ${i.path} · ${i.state}\n--- BEFORE ---\n${i.before??'(missing)'}\n--- AFTER ---\n${i.after??'(deleted)'}`).join('\n\n');d.dataset.previewed='true';renderAgentProgress(d,x.status,true);pv.textContent=t('previewLoaded');}catch(e){setRunStatus(friendlyError(e),'ERROR');pv.disabled=false;}};row.append(pv);
        const action=(x.status==='WAITING_APPLY')?'apply':'reconcile';const a=document.createElement('button');a.type='button';a.className='primary-action';a.textContent=action==='apply'?t('apply'):t('reconcile');a.onclick=()=>performManagement(x,action,a);row.append(a);
        if(['WAITING_APPLY','RECOVERY_REQUIRED','APPLY_CONFLICT'].includes(x.status)){const ds=document.createElement('button');ds.type='button';ds.className='danger-action';ds.textContent=t('discard');ds.onclick=async()=>{if(!confirm(t('discardConfirm')))return;await performManagement(x,'discard',ds);};row.append(ds);}
      }
      d.append(row);pending.append(d);
    }
    if(active&&!currentRun)poll(active.id,null,true);
  }

  function poll(id,assistantBox,resume=false){
    clearInterval(timer);const generation=++pollGeneration;currentRun=id;send.disabled=true;cancel.hidden=false;let box=assistantBox;if(!box&&resume)box=add(t('geminiResumed'),t('resuming'));updateEmptyState();
    const tick=async()=>{if(pollInFlight||generation!==pollGeneration)return;pollInFlight=true;try{const r=(await api(`/v1/runs/${id}`)).run;if(generation!==pollGeneration)return;setRunStatus(runLabel(r.status),r.status);if(box)box.textContent=r.partialText||r.resultText||(r.error?friendlyError(r.error):runLabel(r.status));if(!['QUEUED','RUNNING'].includes(r.status)){clearInterval(timer);timer=null;currentRun=null;send.disabled=false;cancel.hidden=true;await loadThreads(r.threadId);await loadPending();updateEmptyState();}}catch(e){if(generation===pollGeneration)setRunStatus(friendlyError(e),'ERROR');}finally{pollInFlight=false;}};
    tick();timer=setInterval(tick,450);
  }

  async function submitPrompt({promptText=null,selectedMode=null,threadIdOverride=undefined}={}){
    const q=String(promptText===null?prompt.value:promptText).trim();if(!q||!project.value||send.disabled)return;send.disabled=true;const chosenMode=selectedMode||mode();const tid=threadIdOverride===undefined?(thread.value||null):threadIdOverride;
    try{if(!await preflightWorkspace(chosenMode)){send.disabled=false;return;}const submissionKey=JSON.stringify([project.value,tid,chosenMode,q]);if(!pendingSubmission||pendingSubmission.key!==submissionKey)pendingSubmission={key:submissionKey,requestId:crypto.randomUUID()};const requestId=pendingSubmission.requestId;const r=await api('/v1/runs',{method:'POST',body:{projectId:project.value,threadId:tid,mode:chosenMode,prompt:q,requestId}});pendingSubmission=null;prompt.value='';resizePrompt();add(t('you'),q,true);const box=add(t('gemini'),t('starting'));poll(r.run.id,box);}catch(e){setRunStatus(friendlyError(e),'ERROR');send.disabled=false;addTransientError(e,()=>{prompt.value=q;resizePrompt();submitPrompt({promptText:q,selectedMode:chosenMode,threadIdOverride:tid});});}
  }

  function showHelp(title,body){$('helpTitle').textContent=title;$('helpBody').textContent=body;helpDialog.showModal();}

  send.onclick=()=>submitPrompt();
  cancel.onclick=async()=>{if(currentRun)try{await api(`/v1/runs/${currentRun}/cancel`,{method:'POST',body:{}});setRunStatus(t('cancelling'),'RUNNING');}catch(e){runState.textContent=friendlyError(e);}};
  project.onchange=async()=>{++pollGeneration;clearInterval(timer);timer=null;currentRun=null;updateWorkspaceState();await loadThreads();await loadPending();updateEmptyState();};
  thread.onchange=loadConversation;
  $('newProject').onclick=()=>{$('newProjectName').value='';newProjectDialog.showModal();setTimeout(()=>$('newProjectName').focus(),0);};
  $('createProject').onclick=async e=>{e.preventDefault();const name=$('newProjectName').value.trim();if(!name){runState.textContent=t('noProjectName');$('newProjectName').focus();return;}try{const r=await api('/v1/projects',{method:'POST',body:{name}});newProjectDialog.close();await loadProjects(false);project.value=r.project.id;updateWorkspaceState();await loadThreads();await loadPending();runState.textContent=t('projectCreated');}catch(err){runState.textContent=friendlyError(err);}};
  $('newThread').onclick=async()=>{if(!project.value)return;const r=await api(`/v1/projects/${encodeURIComponent(project.value)}/threads`,{method:'POST',body:{title:t('newThreadTitle')}});await loadThreads(r.thread.id);};
  $('settings').onclick=()=>openSettings().catch(e=>runState.textContent=friendlyError(e));
  $('saveSettings').onclick=async e=>{e.preventDefault();try{await api(`/v1/projects/${project.value}`,{method:'PATCH',body:{name:$('pname').value,workspace:$('workspace').value,context:$('context').value}});dialog.close();await loadProjects();runState.textContent=t('projectSaved');}catch(err){runState.textContent=friendlyError(err);}};
  $('handoff').onclick=async()=>{if(!project.value)return;try{const r=await api('/v1/handoff',{method:'POST',body:{projectId:project.value,threadId:thread.value||null}});await copyOrFallback(r.text);}catch(e){runState.textContent=friendlyError(e);}};
  $('authHelp').onclick=()=>startGoogleAuth();
  submitAuthCodeButton.onclick=()=>submitGoogleAuthCode();
  $('cancelAuth').onclick=()=>cancelGoogleAuth();
  authCode.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();submitGoogleAuthCode();}});
  $('webHelp').onclick=()=>showHelp(t('webHelpTitle'),t('webHelpBody'));
  language.onchange=()=>setLanguage(language.value);
  document.querySelectorAll('input[name="mode"]').forEach(r=>r.addEventListener('change',renderModeHelp));
  document.querySelectorAll('[data-mode-pick]').forEach(b=>b.addEventListener('click',()=>{setMode(b.dataset.modePick);prompt.focus();}));
  prompt.addEventListener('input',resizePrompt);
  prompt.addEventListener('keydown',e=>{if(e.key==='Enter'&&(e.ctrlKey||e.metaKey)){e.preventDefault();send.click();}});
  resizePrompt();

  applyStaticI18n();loadHealth();loadProjects().catch(e=>{health.textContent=friendlyError(e);healthDot.className='status-dot bad';setRunStatus(friendlyError(e),'ERROR');});setInterval(loadHealth,15000);
})();
