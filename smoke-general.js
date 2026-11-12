const {app,BrowserWindow,nativeImage}=require('electron');const path=require('node:path');const os=require('node:os');const assert=require('node:assert/strict');const {spawnSync}=require('node:child_process');
app.setPath('userData',path.join(os.tmpdir(),'opencluely-general-smoke-'+process.pid));
// Exercise the configured capture workflow, without a first-run wizard racing test shutdown.
require('./src/core/first-run').prototype.needsOnboarding=()=>false;
require('./main.js');
const deadline=setTimeout(()=>{console.error('OpenCluely launch timed out');app.exit(1);},45000);
app.whenReady().then(async()=>{
 try{const wm=require('./src/managers/window.manager');const start=Date.now();while(!wm.isInitialized){if(Date.now()-start>30000)throw new Error('Original window manager failed to initialize');await new Promise(r=>setTimeout(r,200));}
 const main=wm.windows.get('main');assert.ok(main&&!main.isDestroyed());const info=await main.webContents.executeJavaScript('window.electronAPI.getSettings()');assert.equal(info.activeSkill,'general');assert.equal(await main.webContents.executeJavaScript('document.querySelector("#skillIndicator span").textContent'),'General');
 const handles=[];
 for(const [kind,win] of wm.windows){win.showInactive();const buffer=win.getNativeWindowHandle();handles.push({kind,id:(buffer.length===8?buffer.readBigUInt64LE():BigInt(buffer.readUInt32LE())).toString()});}
 // Upstream Electron 29 has no isContentProtected getter; query the actual Windows affinity flags.
 const script=`Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class QAWindowAffinity { [DllImport("user32.dll", SetLastError=true)] public static extern bool GetWindowDisplayAffinity(IntPtr hWnd, out uint affinity); }'; foreach ($qaHandle in @(${handles.map(h=>h.id).join(',')})) { [uint32]$qaAffinity=0; if (-not [QAWindowAffinity]::GetWindowDisplayAffinity([IntPtr]::new([long]$qaHandle), [ref]$qaAffinity)) { throw "Could not read Windows capture affinity" }; Write-Output $qaAffinity }`;
 const query=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{encoding:'utf8',timeout:20000});assert.equal(query.status,0,query.stderr);const flags=query.stdout.trim().split(/\s+/).map(Number);assert.equal(flags.length,handles.length);for(let i=0;i<flags.length;i++)assert.equal(flags[i],0x11,handles[i].kind+' must have WDA_EXCLUDEFROMCAPTURE');for(const win of wm.windows.values())win.hide();
 // Keep the toolbar's chosen lower position through resize and pointer tracking.
 const {screen}=require('electron');const area=screen.getPrimaryDisplay().workArea;
 main.setPosition(area.x+30,area.y+area.height-100);const chosen=main.getPosition();
 const oldSize=main.getContentSize();main.setContentSize(oldSize[0],80);main.setContentSize(...oldSize);wm.trackActiveScreen();assert.deepEqual(main.getPosition(),chosen);
 assert.equal(await main.webContents.executeJavaScript('getComputedStyle(document.querySelector(".drag-handle")).getPropertyValue("-webkit-app-region")'),'drag');
 wm.hideAllWindows();wm.toggleVisibility();assert.equal(wm.windows.get('settings').isVisible(),false);assert.equal(wm.windows.get('onboarding')?.isVisible()||false,false);assert.equal(wm.windows.get('chat').getSize()[1],350);wm.toggleVisibility();wm.toggleVisibility();assert.equal(wm.windows.get('settings').isVisible(),false);
 // Compare encodings on the same desktop; this is an upload-size measurement, not a live Gemini benchmark.
 const captureService=require('./src/services/capture.service');const originalCapture=captureService.captureScreenshot.bind(captureService);
 captureService.captureScreenshot=async options=>{const result=await originalCapture(options);const png=result.image.toPNG();const jpeg=result.image.toJPEG(88);console.log('Desktop capture encoding bytes: '+JSON.stringify({png:png.length,jpeg:jpeg.length}));return result;};
 // Exercise actual screenshot IPC, native desktop capture, and chat rendering without a live AI request.
 const llm=require('./src/services/llm.service');let imageSeen=false;
 const http=require('node:http');const fs=require('node:fs');
 const server=http.createServer((req,res)=>{let body='';req.on('data',chunk=>body+=chunk);req.on('end',()=>{try{
   assert.equal(req.headers.authorization,'Bearer fake-smoke-token');
   if(req.method==='GET'){res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({data:[{id:'fixture-vision'}]}));return;}
   const data=JSON.parse(body);assert.equal(data.model,'fixture-vision');const contents=data.messages.flatMap(m=>Array.isArray(m.content)?m.content:[]);const image=contents.find(p=>p.type==='image_url');
   if(contents.some(p=>p.text?.includes('Read this screenshot'))){assert.ok(image);const match=/^data:([^;]+);base64,(.*)$/.exec(image.image_url.url);const dimensions=nativeImage.createFromBuffer(Buffer.from(match[2],'base64')).getSize();const display=screen.getDisplayNearestPoint(screen.getCursorScreenPoint());assert.equal(dimensions.width,Math.round(display.size.width*display.scaleFactor));assert.equal(dimensions.height,Math.round(display.size.height*display.scaleFactor));imageSeen=true;}
   const text=imageSeen?'Native capture test answer.':'OK';const event=JSON.stringify({choices:[{delta:{content:text}}]},null,2).split('\n').map(line=>'data: '+line).join('\n')+'\n\n';res.writeHead(200,{'Content-Type':'text/event-stream'});res.write(event.slice(0,20));setImmediate(()=>res.end(event.slice(20)+'data: [DONE]\n\n'));
 }catch(error){res.writeHead(500,{'Content-Type':'application/json'});res.end(JSON.stringify({error:{message:error.message}}));}});});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const connection={aiProvider:'openai',aiEndpoint:'http://127.0.0.1:'+server.address().port+'/v1',aiModel:'fixture-vision',aiKey:'fake-smoke-token'};
 const save=await main.webContents.executeJavaScript('window.electronAPI.saveSettings('+JSON.stringify(connection)+')');assert.equal(save.success,true,save.error);
 const state=await main.webContents.executeJavaScript('window.electronAPI.getSettings()');assert.equal(state.aiProvider,'openai');assert.equal(state.aiHasKey,true);assert.equal(state.aiKey,undefined);assert.equal(state.geminiKey,'');assert.ok(!fs.readFileSync(llm._profiles.file,'utf8').includes('fake-smoke-token'));
 const draft={provider:'openai',endpoint:connection.aiEndpoint,model:'fixture-vision'};
 const models=await main.webContents.executeJavaScript('window.electronAPI.listAIModels('+JSON.stringify(draft)+')');assert.equal(models[0].id,'fixture-vision');
 for(const withImage of [false,true]){const result=await main.webContents.executeJavaScript('window.electronAPI.testAIConnection('+JSON.stringify(draft)+','+withImage+')');assert.equal(result.success,true);assert.equal(result.imageAccepted,withImage);}
 await main.webContents.executeJavaScript('window.electronAPI.takeScreenshot()');assert.equal(imageSeen,true);assert.equal(wm.windows.get('llmResponse').isVisible(),false);const chat=wm.windows.get('chat');assert.equal(chat.isVisible(),true);
 let answers=0;for(let i=0;i<30;i++){answers=await chat.webContents.executeJavaScript('Array.from(document.querySelectorAll(".message.assistant")).filter(e=>e.textContent.includes("Native capture test answer.")).length');if(answers===1)break;await new Promise(r=>setTimeout(r,100));}assert.equal(answers,1);server.closeAllConnections();server.close();
 assert.ok(wm.windows.has('chat'));assert.ok(wm.windows.has('settings'));assert.ok(wm.windows.has('llmResponse'));console.log('Original OpenCluely Windows launch passed: General default, original overlay/settings/chat/answer windows, preload IPC, capture-protection state, free toolbar positioning, full native-resolution capture, one chat-only answer, encrypted provider profiles, text/image connection tests, and real Chromium networking to a local API fixture.');clearTimeout(deadline);app.exit(0);
 }catch(e){console.error(e);clearTimeout(deadline);app.exit(1);}
});
