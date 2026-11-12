const {app,BrowserWindow}=require('electron');const path=require('node:path');const os=require('node:os');const assert=require('node:assert/strict');const {spawnSync}=require('node:child_process');
app.setPath('userData',path.join(os.tmpdir(),'opencluely-general-smoke-'+process.pid));
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
 assert.ok(wm.windows.has('chat'));assert.ok(wm.windows.has('settings'));assert.ok(wm.windows.has('llmResponse'));console.log('Original OpenCluely Windows launch passed: General default, original overlay/settings/chat/answer windows, preload IPC, and capture-protection state.');clearTimeout(deadline);app.exit(0);
 }catch(e){console.error(e);clearTimeout(deadline);app.exit(1);}
});
