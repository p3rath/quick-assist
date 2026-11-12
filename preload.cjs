const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('assistant',{
 settings:()=>ipcRenderer.invoke('settings:get'),saveSettings:data=>ipcRenderer.invoke('settings:save',data),capture:()=>ipcRenderer.invoke('capture'),ask:data=>ipcRenderer.invoke('ask',data),stop:()=>ipcRenderer.invoke('stop'),clear:()=>ipcRenderer.invoke('clear'),transcribe:data=>ipcRenderer.invoke('transcribe',data),onDelta:fn=>ipcRenderer.on('delta',(_,data)=>fn(data)),onCapture:fn=>ipcRenderer.on('capture-shortcut',()=>fn())
});
