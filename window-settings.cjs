function appearance(settings){return {opacity:Math.max(.35,Math.min(1,Number.isFinite(Number(settings.opacity))?Number(settings.opacity):1)),screenProtection:settings.screenProtection!==false,hideTaskbar:settings.hideTaskbar===true};}
function applyAppearance(win,settings,platform=process.platform){const s=appearance(settings);if(platform==='win32'||platform==='darwin')win.setContentProtection(s.screenProtection);win.setOpacity(s.opacity);win.setSkipTaskbar(s.hideTaskbar);}
module.exports={appearance,applyAppearance};
