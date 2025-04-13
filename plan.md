# 📌 Project Plan: FixLang (Local macOS App with OpenAI)

## 📁 Project Structure

```plaintext
├── fix-lang/
│   ├── package.json
│   ├── tsconfig.json
│   ├── electron-vite.config.ts
│   ├── src/
│   │   ├── main/                # Main process (Electron entry point)
│   │   │   ├── main.ts
│   │   ├── preload/
│   │   │   ├── preload.ts  # For secure communication between renderer and main
│   │   ├── renderer/            # UI part (optional for preview or setting)
│   │   │   ├── index.html
│   │   │   ├── index.tsx
│   │   │   └── main.css
│   │   ├── setup/
│   │   │   ├── openai.ts             # API call to OpenAI
│   │   │   └── hotkey.ts             # Global shortcut logic

```

## Technical Stack

- Electron
- TypeScript
- React
- OpenAI API
- Tailwind CSS
- Vite
- Bun

## 🛠️ Implementation Examples

```ts
// src/setup/openai.ts
import { OpenAI } from 'openai'
import 'dotenv/config'

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! })

export async function fixGrammar(text: string): Promise<string> {
  const prompt = `Fix grammar and improve the writing style of the following text:\n"""\n${text}\n"""`
  const res = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      { role: 'system', content: 'You are a helpful English editor.' },
      { role: 'user', content: prompt }
    ],
    temperature: 0.2
  })
  return res.choices[0].message.content || ''
}
```

```ts
// src/setup/hotkey.ts
import { globalShortcut, clipboard } from 'electron'
import { fixGrammar } from './openai'

export function registerHotkey(win: Electron.BrowserWindow) {
  globalShortcut.register('Control+F', async () => {
    const text = clipboard.readText()
    if (!text.trim()) return
    const fixed = await fixGrammar(text)
    clipboard.writeText(fixed)
    console.log('✅ Text corrected and copied to clipboard!')
  })
}
```

## Phase Implementation

### ✅ Phase 1: Setup Project Structure

- [x] Initialize project with `npm init`
- [x] Setup TypeScript with `tsconfig.json`
- [x] Add .env support for API key
- [x] Install Electron and configure entry point
- [x] Create basic folder structure
- [x] Add preload script for secure context bridging

### 🚀 Phase 2: Clipboard and Global Shortcut

- [x] Install clipboardy (read/write clipboard) (Already in package.json)
- [x] Use Electron `globalShortcut` to register custom keybinding
- [x] Test reading selected text from clipboard (Implemented in hotkey handler)

### 🧠 Phase 3: OpenAI API Integration

- [x] Create util to call OpenAI with prompt: "Fix grammar and style"
- [x] Read clipboard → send to OpenAI → write result back to clipboard (Integrated in hotkey handler)
- [x] Add logs for debugging

### 🖥️ Phase 4: Optional UI Preview

- [x] Setup React + Tailwind using Vite
- [x] Create UI to preview original vs fixed text
- [x] Change primary fix key to Ctrl+Shift+F
- [x] Add Ctrl+Shift+Z to undo
- [x] Add Ctrl+Shift+A to retry
- [x] Add settings UI
  - [x] Add change API key instead of `.env`
  - [x] Add change key binding

### 🔮 Phase 5: Advanced Features

- [x] Implement custom prompts (foundation laid in openai.ts)
- [x] Add Ctrl+Shift+Z to undo
- [x] Add Ctrl+Shift+A to retry

### ✅ Phase 6: Packaging and Usage

- [x] Packaging app as `.dmg` (using electron-builder)
- [x] Ensure app only runs locally with user's API key (implemented in openai.ts)
- [x] Test on macOS (hotkey + OpenAI + clipboard)
- [x] Create build script for easy packaging
- [x] Add proper app icon
- [x] Configure DMG window appearance

### 🧪 Phase 7: Polish & Enhancements

- [ ] Add a small loading icon near the mouse during the API call.
- [ ] Add the ability to save up to 20 versions of the original text and the corrected text.
- [ ] Add a copy button at the top right of the original text and the corrected text.
- [ ] Add multiple prompt modes: grammar only, tone, shorten.
- [ ] Support multilingual input.
- [ ] Auto-detect language
