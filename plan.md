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

#### 1. Add a small loading icon near the mouse during the API call

- [x] 1. Create a new transparent, always-on-top, frameless BrowserWindow in Electron main process
- [x] 2. Make the overlay window click-through (so it doesn’t block interaction with other apps)
- [x] 3. Render a minimal React page in the overlay window that displays the spinner
- [x] 4. Track the global mouse position using Electron’s `screen.getCursorScreenPoint()`
- [x] 5. Move the overlay window to follow the mouse cursor in real-time
- [x] 6. Synchronize spinner visibility with the main app’s loading state (IPC communication)
- [x] 7. Ensure overlay window closes/hides when not needed
- [x] 8. Document the overlay logic, limitations, and accessibility considerations in plan.md

> **Note:** Overlay spinner is robust, decoupled from mainWindow, and fully documented as of 2025-04-15.

#### 2. Implement model selection using a dropdown, with results fetched from the OpenAI API

##### 2.1 Backend fetch for OpenAI models (DONE)

- [x] Added utility to fetch models from OpenAI API in `openai.ts`.
- [x] Exposed model fetch via IPC in `ipc.ts`.
- [x] Exposed to renderer via preload bridge (`electronAPI.fetchOpenAIModels`).

##### 2.2 Implement dropdown UI in SettingsModal (NEXT)

- [x] Add a dropdown UI for model selection in the settings modal (`SettingsModal.tsx`).
- [x] Fetch available models from OpenAI API via `electronAPI.fetchOpenAIModels` on mount.
- [x] Populate dropdown options with model names (id, owner, etc).
- [x] Handle selection and store selected model in app state/settings (persist until refetch or app restart).
- [x] Use selected model for API calls.
- [x] Add error handling for fetch failures (show error in UI, allow retry).
- [x] Add refetch models button.
- [x] Ensure dropdown is accessible (aria-label, keyboard navigation, etc).

#### 3. Split modal setting options into tabs

- [x] Analyze current SettingsModal implementation and list all settings
- [x] Decide tab structure and assign settings to each tab
- [x] Implement tab navigation UI (DaisyUI/Tailwind)
- [x] Refactor modal content into tab panels:
  - [x] Tab 1: General (API key, Model)
  - [x] Tab 2: Key Bindings
  - [x] Tab 3: Prompt (custom prompt settings)
- [x] Ensure accessibility and responsive design
- [x] Test tab switching and settings functionality
- [x] Update documentation and code comments
- [x] Mark completed steps in plan.md

#### 4. Introduce a keybinding change feature

- [x] 4.1 Extract default keybindings into `src/const.ts`
  - [x] 4.1.1 Define `DEFAULT_KEY_BINDINGS` in `src/const.ts`
  - [x] 4.1.2 Refactor `store.ts` to import and use `DEFAULT_KEY_BINDINGS`
- [x] 4.2 Create `KeybindingStore` in `src/stores/keybindingStore.ts` for state management and persistence
  - [x] 4.2.1 Initialize `electron-store` in `KeybindingStore`
  - [x] 4.2.2 Implement `get`, `set`, and `reset` methods
  - [ ] 4.2.3 Write unit tests for `KeybindingStore`
- [x] 4.3 Enhance `SettingKeyBinding` UI in settings modal
  - [x] 4.3.1 Display current keybindings in a list
  - [x] 4.3.2 Build editable hotkey input component following VSCode UX
- [x] 4.4 Implement hotkey capture logic to update keybindings in `SettingKeyBinding`
  - [x] 4.4.1 Capture key combinations on focus and keydown events
  - [x] 4.4.2 Debounce input updates for improved UX
- [x] 4.5 Temporarily disable existing shortcuts during keybinding update
- [x] 4.6 Add validation in `KeybindingStore` to detect invalid combos and duplicates
- [x] 4.7 Show inline feedback for invalid or duplicate keybindings
  - [x] 4.7.1 Display contextual error/warning messages near inputs
  - [x] 4.7.2 Use color codes (red for errors, yellow for warnings)
- [x] 4.8 Persist updated keybindings in store (e.g., `electron-store`)
  - [x] 4.8.1 Invoke `KeybindingStore.setKeyBindings` on save/blur
  - [x] 4.8.2 Confirm persistence via `KeybindingStore.getKeyBindings`
- [x] 4.9 Add "Reset to defaults" button in UI and logic to restore default mappings
  - [x] 4.9.1 Add reset button to `SettingKeyBinding` UI
  - [x] 4.9.2 Implement `KeybindingStore.reset` to restore `DEFAULT_KEY_BINDINGS`

#### 5. Enable saving up to 20 versions of both the original and corrected texts

- [ ] Implement a version history data structure (in-memory or persistent)
- [ ] Update logic to save each correction (original + fixed)
- [ ] Limit history to 20 items (FIFO)
- [ ] Add UI to view and restore previous versions
- [ ] Add delete/clear history option

#### 6. Add a copy button at the top right of both the original and corrected texts

- [x] Add copy button UI to both text panels
- [x] Implement clipboard copy logic
- [x] Show visual feedback (e.g., tooltip or toast) on copy

#### 7. Include multiple prompt modes in SettingsPrompt

- [x] Add UI for custom prompt
  - [x] Add input for custom "system prompt"
  - [x] Add input for custom "user prompt"
  - [x] Add checkboxes for "Grammar", "Shorten" (default: only Grammar be checked which equal to current logic)
  - [x] Add input for custom "Tone" (default: empty)
- [x] Implement UI logic
  - [x] Save user settings in apiStore
  - [x] When shortening is enabled, update API call logic to include shorten prompt in `src/prompts/index.ts`
  - [x] For Tone
    - [x] Add makeTonePrompt function in `src/prompts/index.ts`. Function will have one parameter: tone. Return string like `Rewrite the following text in ${tone} tone` but feel free improve it.
    - [x] Update API call logic to use makeTonePrompt which will use saved tone in store

#### 8. Implement macOS toolbar icon & menu

- [x] Add app icon to macOS toolbar
- [ ] Add functionality to menu items, UI can be simple for now
  - [ ] Quit
  - [ ] Change models
  - [ ] Change keybindings
  - [ ] Reset settings
- [ ] Make UI look more modern
- [ ] Update menu dynamically as settings change

#### 9. Add token count returned from OpenAI

- [x] Add token count display in UI inside both text panels ( inside the text area )
  - [x] promptTokens
  - [x] completionTokens
- [x] Update token count display when API call is done

**Implementation summary:**

- The OpenAI API response token count is now extracted and sent to the renderer.
- Both text panels display the token count inside the text area, styled for accessibility and clarity.
- Type definitions, IPC, and UI all updated for seamless token count updates.
- All code follows project, accessibility, and SOLID/DRY best practices.

**Implementation notes:**

- Electron Tray and Menu are used to create a native macOS toolbar icon and menu.
- The menu options send IPC events to the renderer for settings, review, and quick settings.
- Menu updates dynamically when settings change (listens for `settings-updated` IPC).
- SVG icon is used for now; update to PNG in the future for best appearance.

### 🧪 Phase 8: Additional Features

#### 0. Core Refactors and Infrastructure

- [x] Refactor global spinner overlay: now controlled by main process, decoupled from mainWindow, robust for all shortcut operations (2025-04-15)

#### 1. Add a reply feature

- [ ] Design UI with three areas: original (left), reply context (top right), generated reply (bottom right)
- [ ] Implement input fields for both original and reply context
- [ ] Add button to trigger reply generation via API
- [ ] Handle API call and display generated reply
- [ ] Add copy button for generated reply
- [ ] Add error and loading states

#### 2. Add a translation feature

- [ ] Design UI for side-by-side original and translated text
- [ ] Add input for original text and language selection dropdown
- [ ] Add button to trigger translation via API
- [ ] Implement shortcut for translation
- [ ] Add keybinding change button in settings
- [ ] Display translated text
- [ ] Add copy button for translated text
- [ ] Handle loading and error states

#### 3. Add support for other API providers

- [ ] Research and select alternative API providers
- [ ] Abstract API call logic to support multiple providers
- [ ] Add provider selection UI in settings
- [ ] Implement provider-specific configuration (API key, endpoint)
- [ ] Update logic to use selected provider for requests
- [ ] Add error handling and fallback logic
