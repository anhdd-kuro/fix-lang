# 📌 Project Plan: Fixkey Clone (Local macOS App with OpenAI)

## 📁 Project Structure

```plaintext
├── fix-lang/
│   ├── package.json
│   ├── tsconfig.json
│   ├── plan.md
│   ├── src/
│   │   ├── main.ts                # Main process (Electron entry point)
│   │   ├── preload.ts             # For secure communication between renderer and main
│   │   ├── renderer/              # UI part (optional for preview or setting)
│   │   │   ├── index.html
│   │   │   ├── index.tsx
│   │   └── style.css
│   ├── utils/
│   │   └── openai.ts          # API call to OpenAI
│   └── hotkey.ts              # Global shortcut logic
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
// utils/openai.ts
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
// hotkey.ts
import { globalShortcut, clipboard } from 'electron'
import { fixGrammar } from './utils/openai'

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
- [x] Install Electron and configure entry point
- [x] Create basic folder structure
- [ ] Add preload script for secure context bridging

### 🚀 Phase 2: Clipboard and Global Shortcut

- [ ] Install clipboardy (read/write clipboard)
- [ ] Use Electron `globalShortcut` to register custom keybinding
- [ ] Test reading selected text from clipboard

### 🧠 Phase 3: OpenAI API Integration

- [ ] Create util to call OpenAI with prompt: "Fix grammar and style"
- [ ] Read clipboard → send to OpenAI → write result back to clipboard
- [ ] Add logs for debugging

### 🖥️ Phase 4: Optional UI Preview

- [ ] Setup React + Tailwind using Vite
- [ ] Create UI to preview original vs fixed text
- [ ] Add Ctrl+Shift+F auto fix
- [ ] Add Ctrl+Shift+Z to undo
- [ ] Add Ctrl+Shift+A to retry
- [ ] Add settings UI
  - [ ] Add change API key instead of `.env`
  - [ ] Add change key binding

### ⚙️ Phase 5: Packaging and Usage

- [ ] Setup electron-builder or similar
- [ ] Ensure app only runs locally with user’s API key
- [ ] Add .env support for API key
- [ ] Test on macOS (hotkey + OpenAI + clipboard)

### 🧪 Phase 6: Polish & Enhancements

- [ ] Add multiple prompt modes: grammar only / tone / shorten
- [ ] Support multi-language input
- [ ] Auto detect language
