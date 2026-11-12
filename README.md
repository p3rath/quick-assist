# Quick Assist — Windows starter

A small always-on-top assistant for short general answers, code, voice questions, and screenshots. This is a first working source build, not a measured replacement for paid Cluely.

## Portable Windows build

Download the Windows ZIP from [Releases](https://github.com/p3rath/quick-assist/releases/latest). No Node.js installation is required for the portable build.

Extract the entire `Quick Assist-0.1.0-win.zip` archive, then double-click `Quick Assist.exe`. Keep its adjacent files and folders together. The build is unsigned and has not been run on a Windows machine.

## Run from source on Windows

Install Node.js 22 LTS, extract this folder, then open PowerShell here:

```powershell
npm ci
npm start
```

On first launch, enter your OpenAI API key in Settings. API usage requires separate provider billing; a ChatGPT subscription does not include API usage. Defaults: `gpt-4.1-mini` for text/images and `gpt-4o-mini-transcribe` for voice. Change these to models available to your account. Other OpenAI-compatible endpoints must support chat-completion streaming, vision input, and audio transcription to support all features.

Type and press Enter to ask; Shift+Enter inserts a newline. Voice records the microphone until Finish, then transcribes and asks automatically. Screen attaches a display screenshot for your next question; multiple monitors get a chooser. Explain more expands the last answer. New chat clears in-memory conversation.

- Ctrl+Shift+Space: show/hide the assistant.
- Ctrl+Shift+S: capture a display. This shortcut may conflict with other apps.
- Stop: cancels transcription or generation.

## Build a Windows installer

On Windows, run `npm run dist:win`. The installer goes into `dist/`. This project has no signing certificate, so resulting installers are unsigned.

## Data and speed

API keys use Electron safeStorage (Windows DPAPI), saved in the application's user-data directory. The renderer cannot read the key. Conversation is kept in memory and limited to five recent exchanges. Images are sent for the current turn only; later image questions require attaching the screenshot again. Microphone audio, prompts, recent conversation, and attached screenshots are sent to your configured provider. There is no automatic listening, system-audio recording, or background screen monitoring.

The UI reports request-to-first-text and request-to-completion. Voice additionally reports stop-recording-to-completion, including transcription. Voice uses stop-then-transcribe, not realtime speech streaming; this adds latency. No live provider benchmark has been run, and speed depends on model, provider, connection, and prompt. Brief answers are prompted rather than guaranteed to have an exact sentence count.

This version captures a whole display, downsized to at most 1600×1000. Region selection, formatted Markdown/code rendering, realtime transcription, and conversation export are future work. Screenshots exclude the assistant by temporarily hiding it. Platform capture exclusion/stealth is not implemented.

## Validation

`npm test` exercises stream chunk boundaries, UTF-8 handling, provider errors, and bounded screenshot context. Live provider requests require your API key. Windows microphone, global shortcuts, secure storage, and installer behavior must be checked on Windows.
