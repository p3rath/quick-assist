const {app,BrowserWindow,safeStorage,globalShortcut}=require('electron');const assert=require('node:assert/strict');const os=require('node:os');const path=require('node:path');
app.setPath('userData',path.join(os.tmpdir(),'quick-assist-smoke-'+process.pid));
require('../main.cjs');
const timeout=setTimeout(()=>{console.error('Windows smoke test timed out');app.exit(1);},35000);
app.whenReady().then(async()=>{
 try{const win=BrowserWindow.getAllWindows()[0];await new Promise((resolve,reject)=>{win.webContents.once('did-finish-load',resolve);win.webContents.once('did-fail-load',(_,code,message)=>reject(new Error(message)));});
 assert.equal(win.isContentProtected(),true,'Capture protection must be enabled before showing the window');assert.equal(safeStorage.isEncryptionAvailable(),true,'Windows credential encryption must be available');assert.equal(globalShortcut.isRegistered('CommandOrControl+Shift+Space'),true);
 const result=await win.webContents.executeJavaScript(`(async()=>{const saved=await window.assistant.saveSettings({provider:'gemini',model:'gemini-3.8-flash',apiKey:'fake-smoke-test-key',opacity:.6,screenProtection:true,hideTaskbar:false});const roundtrip=await window.assistant.settings();return {hasKey:roundtrip.hasKey,hasPlainKey:'apiKey' in roundtrip,provider:roundtrip.provider,opacity:roundtrip.opacity,protected:roundtrip.screenProtection};})()`);
 assert.equal(result.hasKey,true);assert.equal(result.hasPlainKey,false);assert.equal(result.provider,'gemini');assert.equal(result.protected,true);assert.ok(Math.abs(win.getOpacity()-.6)<.02);assert.equal(win.isContentProtected(),true);
 await win.webContents.executeJavaScript('window.assistant.appearance({screenProtection:false,opacity:1})');assert.equal(win.isContentProtected(),false);await win.webContents.executeJavaScript('window.assistant.appearance({screenProtection:true})');assert.equal(win.isContentProtected(),true);
 console.log('Windows Electron smoke passed: native capture exclusion, native opacity, secure key save, settings roundtrip, global shortcut, and renderer preload.');clearTimeout(timeout);app.exit(0);
 }catch(error){console.error(error);clearTimeout(timeout);app.exit(1);}
});
