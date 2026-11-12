const {app,BrowserWindow,ipcMain,globalShortcut,desktopCapturer,safeStorage,session}=require('electron');
const fs=require('node:fs');const path=require('node:path');const providers=require('./providers.cjs');const {appearance,applyAppearance}=require('./window-settings.cjs');
let win,settings={},history=[],active,clickThrough=false;
const configPath=()=>path.join(app.getPath('userData'),'settings.json');
function persist(){fs.writeFileSync(configPath(),JSON.stringify(settings),{mode:0o600});}
function publicSettings(){const {encryptedKeys,encryptedKey,...rest}=settings;return {...rest,...appearance(settings),hasKey:!!encryptedKeys?.[settings.provider],protected:process.platform==='win32'||process.platform==='darwin',version:app.getVersion()};}
function config(data={}){const provider=data.provider||settings.provider||'gemini';if(!['gemini','openai'].includes(provider))throw new Error('Choose Gemini or OpenAI.');const merged={...settings,...data,provider};providers.modelId(merged.model);providers.baseURL(merged);return merged;}
function getKey(cfg){if(cfg.apiKey?.trim())return cfg.apiKey.trim();const encrypted=settings.encryptedKeys?.[cfg.provider];if(!encrypted)throw new Error(`Add your ${cfg.provider==='gemini'?'Gemini':'OpenAI / compatible provider'} API key in Settings.`);return safeStorage.decryptString(Buffer.from(encrypted,'base64'));}
function emit(name,data){if(win&&!win.isDestroyed())win.webContents.send(name,data);}
function show(){clickThrough=false;win.setIgnoreMouseEvents(false);win.show();win.focus();emit('interaction',false);}
async function operation(fn,ms=90000){if(active)throw new Error('Stop the current request first.');const controller=new AbortController();active=controller;const timer=setTimeout(()=>controller.abort(),ms);try{return await fn(controller.signal);}catch(error){if(error.name==='AbortError')throw new Error('Request stopped or timed out.');throw new Error(providers.redact(error.message,''));}finally{clearTimeout(timer);active=undefined;}}
app.whenReady().then(()=>{
  try{settings=JSON.parse(fs.readFileSync(configPath(),'utf8'));}catch{}
  const oldProvider=providers.providerOf(settings);if(settings.encryptedKey){settings.encryptedKeys={...settings.encryptedKeys,[oldProvider]:settings.encryptedKey};delete settings.encryptedKey;}
  settings=providers.normalize(Object.keys(settings).length?settings:{provider:'gemini',model:'gemini-3.8-flash'});
  win=new BrowserWindow({width:510,height:710,minWidth:400,minHeight:500,show:false,opacity:0,frame:false,alwaysOnTop:true,backgroundColor:'#10131a',autoHideMenuBar:true,webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
  // Windows initializes its screenshot state when the native window is shown.
  // Show an empty, zero-opacity window first; protect it before loading content.
  win.show();
  applyAppearance(win,settings,process.platform);
  win.on('show',()=>applyAppearance(win,settings,process.platform));
  win.webContents.setWindowOpenHandler(()=>({action:'deny'}));win.webContents.on('will-navigate',event=>event.preventDefault());
  session.defaultSession.setPermissionRequestHandler((contents,permission,callback)=>callback(contents===win.webContents&&permission==='media'));
  win.loadFile(path.join(__dirname,'index.html'));
  globalShortcut.register('CommandOrControl+Shift+Space',()=>win.isVisible()?win.hide():show());
  globalShortcut.register('CommandOrControl+Shift+S',()=>{show();emit('capture-shortcut');});
  globalShortcut.register('CommandOrControl+Shift+I',()=>{clickThrough=!clickThrough;win.setIgnoreMouseEvents(clickThrough,{forward:true});if(!clickThrough)show();emit('interaction',clickThrough);});
});
app.on('will-quit',()=>globalShortcut.unregisterAll());app.on('window-all-closed',()=>app.quit());
ipcMain.handle('settings:get',()=>publicSettings());
ipcMain.handle('settings:save',(_,data)=>{
  if(active)throw new Error('Stop the current request before changing providers.');const next=config(data);const apiKey=getKey(next);if(!safeStorage.isEncryptionAvailable())throw new Error('Secure credential storage is unavailable.');
  settings={provider:next.provider,baseURL:providers.baseURL(next),model:providers.modelId(next.model),speechModel:next.speechModel||'gpt-4o-mini-transcribe',...appearance(next),encryptedKeys:{...settings.encryptedKeys,[next.provider]:safeStorage.encryptString(apiKey).toString('base64')}};
  persist();history=[];applyAppearance(win,settings,process.platform);return publicSettings();
});
ipcMain.handle('appearance',(_,data)=>{settings={...settings,...appearance({...settings,...data})};applyAppearance(win,settings,process.platform);persist();return publicSettings();});
ipcMain.handle('models',(_,data)=>operation(signal=>{const cfg=config(data);return providers.models(cfg,getKey(cfg),signal);},30000));
ipcMain.handle('test-connection',(_,data)=>operation(async signal=>{const cfg=config(data);const started=performance.now();let reply='';for await(const chunk of providers.generate(cfg,getKey(cfg),[],{text:'Reply with exactly: Connected',detailed:false},signal))reply+=chunk;if(!reply.trim())throw new Error('Provider returned no text. Select another model.');return {reply,ms:Math.round(performance.now()-started)};},30000));
ipcMain.handle('window',(_,action)=>{if(action==='hide')win.hide();if(action==='minimize')win.minimize();if(action==='close')app.quit();});
ipcMain.handle('capture',async()=>{win.hide();try{await new Promise(r=>setTimeout(r,180));const screens=await desktopCapturer.getSources({types:['screen'],thumbnailSize:{width:1600,height:1000}});return screens.map(s=>({name:s.name,image:s.thumbnail.toDataURL()}));}finally{show();}});
ipcMain.handle('clear',()=>{if(active)throw new Error('Stop the answer first.');history=[];});ipcMain.handle('stop',()=>active?.abort());
ipcMain.handle('ask',(_,payload)=>operation(async signal=>{const started=performance.now();let answer='',first;for await(const delta of providers.generate(settings,getKey(settings),history,payload,signal)){if(first===undefined)first=Math.round(performance.now()-started);answer+=delta;emit('delta',{delta,first});}if(!answer)throw new Error('The model returned no text. Try another model.');history.push({role:'user',content:payload.text||'Explain the attached screenshot.'},{role:'assistant',content:answer});history=history.slice(-10);return {first,total:Math.round(performance.now()-started)};}));
ipcMain.handle('transcribe',(_,buffer)=>operation(signal=>providers.transcribe(settings,getKey(settings),buffer,signal),60000));
