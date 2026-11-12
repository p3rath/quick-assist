# Quick Assist for Windows

A small floating assistant for concise answers, code, screenshots, and voice. Version 0.2 adds native Gemini support and Windows window/privacy controls.

## Download

Download **Quick-Assist-0.2.0-Windows.exe** from the [v0.2.0 release](https://github.com/p3rath/quick-assist/releases/tag/v0.2.0). Close the previous version before running the new file. It is a single portable executable: no installer or manual extraction. Its runtime unpacks to a temporary folder at launch. Settings and encrypted API keys live in your Windows user-data folder, so they persist between versions. The app is unsigned.

## Gemini setup

1. Open Settings and select **Google Gemini**.
2. Paste your Gemini API key. The native endpoint is configured automatically.
3. Click **Load models** and select a model returned for your key.
4. Click **Test connection**, then **Save settings**.

Use the exact model ID, such as `gemini-3.8-flash`, rather than a display name like `gemini 3.8 Flash`. The model picker avoids manual spelling errors. Availability depends on your account. Native Gemini handles text, images, and voice transcription; no OpenAI key is needed for Gemini. Transcription uses your selected model, so choose a model supporting audio input. Quota, billing, geographic restrictions, and model access remain provider-controlled. The app displays provider error details, with keys redacted.

Existing settings pointing at Google's OpenAI-compatible endpoint migrate to native Gemini automatically. Invalid display names prompt you to select and test a valid model. API keys are stored separately by provider and encrypted with Windows DPAPI through Electron safeStorage.

For OpenAI or compatible providers, select that provider and enter its key, HTTPS base endpoint, exact chat/vision model, and transcription model. Compatible providers must implement streaming chat completions, vision input, model listing, and audio transcription for every feature to work. Test connection sends a short real prompt, so normal provider usage charges/quota apply.

## Window controls

- **Exclude window from screen capture** is enabled by default before the window first appears. It uses Electron's Windows `SetWindowDisplayAffinity` / `WDA_EXCLUDEFROMCAPTURE` support. All settings and screen-choice dialogs stay inside the same protected window.
- **Opacity** ranges from 35% to 100% and applies live to the whole window, including dialogs. Changes persist immediately.
- **Hide from taskbar** optionally removes the taskbar entry. Use the show shortcut to recover the window.
- **Ctrl+Shift+Space:** hide/show.
- **Ctrl+Shift+I:** toggle click-through; use it again to regain interaction. Showing the window also clears click-through.
- **Ctrl+Shift+S:** attach a display screenshot.
- Drag the header to move the app. The minus button hides it; × quits.

Capture protection is an operating-system feature, not a guarantee against every capture method. On Windows 10 version 2004 or newer, supported capture APIs exclude the window; older Windows versions can show a black rectangle. Check your actual meeting/recording preview before relying on it. See [Electron's capture-protection documentation](https://www.electronjs.org/docs/latest/api/browser-window#winsetcontentprotectionenable-macos-windows). Linux has no equivalent protection through Electron.

## Asking questions

Type and press Enter to ask; Shift+Enter inserts a newline. Voice records your microphone until Finish (60-second maximum), transcribes, then asks. Screen attaches a whole display screenshot; multiple monitors get a chooser. Explain more expands the last answer. Stop cancels generation/transcription. New chat clears in-memory context.

Microphone audio, prompts, recent conversation, and attached screenshots go to your chosen provider. There is no background listening or screen monitoring. Conversation stays in memory, limited to five recent exchanges, and screenshots are attached for the current turn only. Follow-up image questions require reattaching the image. Screen captures are downsized to at most 1600×1000.

Answers stream as they arrive. The UI measures first-text and completion time; voice additionally includes transcription time. Voice uses stop-then-transcribe rather than realtime transcription. Speed is not yet benchmarked against paid Cluely.

## Run from source

Install Node.js 22, open PowerShell in the source folder, and run:

```powershell
npm ci
npm start
```

`npm test` runs stream, provider-contract, model-list, migration, and window-setting tests. On Windows, `node scripts/run-windows-smoke.cjs` launches the real Electron app with an isolated temporary profile to check capture-protection state, opacity, encrypted key persistence, preload/IPC, and shortcuts. It sends no real provider requests. The GitHub Actions workflow builds and publishes the portable EXE after these checks.

The tests do not establish exclusion in every conferencing app or validate a user's live API key. Model and browser UI tests use simulated providers; the built-in Test connection checks your real account locally.

## API references

Native Gemini follows Google's [content-generation API](https://ai.google.dev/api/generate-content) and [audio input documentation](https://ai.google.dev/gemini-api/docs/audio).
