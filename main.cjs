const {app,BrowserWindow,ipcMain,globalShortcut,desktopCapturer,safeStorage,session}=require('electron');
const fs=require('node:fs'); const path=require('node:path'); const {messages,deltas}=require('./core.cjs');
let win, settings={}, history=[], active;
const configPath=()=>path.join(app.getPath('userData'),'settings.json');
function publicSettings(){const {encryptedKey,...rest}=settings;return {...rest,hasKey:!!encryptedKey};}
function key(){if(!settings.encryptedKey)throw new Error('Open Settings and add your API key first.');return safeStorage.decryptString(Buffer.from(settings.encryptedKey,'base64'));}
function endpoint(suffix){const base=settings.baseURL||'https://api.openai.com/v1';const u=new URL(base);if(u.protocol!=='https:' && !(['localhost','127.0.0.1'].includes(u.hostname)&&u.protocol==='http:'))throw new Error('Use HTTPS, or HTTP on localhost.');return base.replace(/\/$/,'')+suffix;}
function emit(name,data){if(win&&!win.isDestroyed())win.webContents.send(name,data);}
async function checked(response){if(!response.ok)throw new Error(`Provider returned ${response.status}. Check your key, model, billing, and endpoint.`);return response;}
app.whenReady().then(()=>{
  try{settings=JSON.parse(fs.readFileSync(configPath(),'utf8'));}catch{}
  win=new BrowserWindow({width:510,height:710,minWidth:400,minHeight:500,alwaysOnTop:true,backgroundColor:'#10131a',autoHideMenuBar:true,webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
  win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  win.webContents.on('will-navigate',event=>event.preventDefault());
  session.defaultSession.setPermissionRequestHandler((contents,permission,callback)=>callback(contents===win.webContents&&permission==='media'));
  win.loadFile('index.html');
  globalShortcut.register('CommandOrControl+Shift+Space',()=>{if(win.isVisible())win.hide();else {win.show();win.focus();}});
  globalShortcut.register('CommandOrControl+Shift+S',()=>{win.show();emit('capture-shortcut');});
});
app.on('will-quit',()=>globalShortcut.unregisterAll());app.on('window-all-closed',()=>app.quit());
ipcMain.handle('settings:get',()=>publicSettings());
ipcMain.handle('settings:save',(_,data)=>{
  if(active)throw new Error('Stop the current request before changing settings.');
  const next={baseURL:String(data.baseURL||'https://api.openai.com/v1'),model:String(data.model||'gpt-4.1-mini'),speechModel:String(data.speechModel||'gpt-4o-mini-transcribe'),encryptedKey:settings.encryptedKey};
  const u=new URL(next.baseURL);if(u.protocol!=='https:'&&!(['localhost','127.0.0.1'].includes(u.hostname)&&u.protocol==='http:'))throw new Error('Endpoint must use HTTPS.');
  if(data.apiKey){if(!safeStorage.isEncryptionAvailable())throw new Error('Secure credential storage is unavailable.');next.encryptedKey=safeStorage.encryptString(data.apiKey.trim()).toString('base64');}
  fs.writeFileSync(configPath(),JSON.stringify(next),{mode:0o600}); settings=next;return publicSettings();
});
ipcMain.handle('capture',async()=>{
  win.hide();try {await new Promise(r=>setTimeout(r,180));const screens=await desktopCapturer.getSources({types:['screen'],thumbnailSize:{width:1600,height:1000}});return screens.map(s=>({name:s.name,image:s.thumbnail.toDataURL()}));}finally{win.show();}
});
ipcMain.handle('clear',()=>{if(active)throw new Error('Stop the answer first.');history=[];});
ipcMain.handle('stop',()=>active?.abort());
ipcMain.handle('ask',async(_,payload)=>{
  if(active)throw new Error('An answer is already running.');
  const started=performance.now();const controller=new AbortController();active=controller;const timer=setTimeout(()=>controller.abort(),90000);let answer='',first;
  try {
    const requestMessages=messages(history,payload.text,payload.image,payload.detailed);
    const response=await checked(await fetch(endpoint('/chat/completions'),{method:'POST',headers:{Authorization:`Bearer ${key()}`,'Content-Type':'application/json'},signal:controller.signal,body:JSON.stringify({model:settings.model||'gpt-4.1-mini',messages:requestMessages,stream:true,max_tokens:payload.detailed?1800:650})}));
    for await(const delta of deltas(response.body)){if(first===undefined)first=Math.round(performance.now()-started);answer+=delta;emit('delta',{delta,first});}
    if(!answer)throw new Error('The model returned no text. Try another model.');
    history.push({role:'user',content:payload.text||'Explain the attached screenshot.'},{role:'assistant',content:answer});history=history.slice(-10);
    return {first,total:Math.round(performance.now()-started)};
  }finally{clearTimeout(timer);active=undefined;}
});
ipcMain.handle('transcribe',async(_,buffer)=>{
  if(active)throw new Error('Wait for the current request to finish.');const controller=new AbortController();active=controller;const timer=setTimeout(()=>controller.abort(),60000);
  try{if(buffer.byteLength>20*1024*1024)throw new Error('Recording too large. Try a shorter question.');const form=new FormData();form.append('file',new Blob([buffer],{type:'audio/webm'}),'question.webm');form.append('model',settings.speechModel||'gpt-4o-mini-transcribe');const res=await checked(await fetch(endpoint('/audio/transcriptions'),{method:'POST',headers:{Authorization:`Bearer ${key()}`},body:form,signal:controller.signal}));return (await res.json()).text;}finally{clearTimeout(timer);active=undefined;}
});
