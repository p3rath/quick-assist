const {app,BrowserWindow}=require('electron');const path=require('node:path');const os=require('node:os');const assert=require('node:assert/strict');
app.setPath('userData',path.join(os.tmpdir(),'opencluely-general-smoke-'+process.pid));
require('./main.js');
const deadline=setTimeout(()=>{console.error('OpenCluely launch timed out');app.exit(1);},45000);
app.whenReady().then(async()=>{
 try{const wm=require('./src/managers/window.manager');const start=Date.now();while(!wm.isInitialized){if(Date.now()-start>30000)throw new Error('Original window manager failed to initialize');await new Promise(r=>setTimeout(r,200));}
 const main=wm.windows.get('main');assert.ok(main&&!main.isDestroyed());const info=await main.webContents.executeJavaScript('window.electronAPI.getSettings()');assert.equal(info.activeSkill,'general');assert.equal(await main.webContents.executeJavaScript('document.querySelector("#skillIndicator span").textContent'),'General');
 for(const [kind,win] of wm.windows){win.showInactive();assert.equal(win.isContentProtected(),true,kind+' must retain original capture protection');win.hide();}
 assert.ok(wm.windows.has('chat'));assert.ok(wm.windows.has('settings'));assert.ok(wm.windows.has('llmResponse'));console.log('Original OpenCluely Windows launch passed: General default, original overlay/settings/chat/answer windows, preload IPC, and capture-protection state.');clearTimeout(deadline);app.exit(0);
 }catch(e){console.error(e);clearTimeout(deadline);app.exit(1);}
});
