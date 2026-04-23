# Codex Noteforge

A desktop-only Obsidian plugin that wires the official [Codex CLI](https://github.com/openai/codex) into your vault as a study-and-editing assistant. It gives you persistent chat tabs backed by real Codex threads, a **Plan / Chat** toggle for the same conversation, a reviewable patch queue for note edits, and session-aware ingest flows for papers and lecture material.

> Status: early release. Desktop-only. Targets macOS, Windows, and Linux on Obsidian Desktop, with Windows-native Codex installs preferred and WSL kept as an optional fallback.

---

## What you get

- **Persistent chat tabs** — each tab is a resumable Codex CLI thread, not a one-shot API call. Fork, resume, or compact a thread from the header.
- **Plan mode** — toggle a specification-interview mode where Codex asks one clarifying question at a time until the plan is ready to implement, without touching any files.
- **Reviewable note patches** — when Codex wants to edit a note, it emits a fenced `obsidian-patch` block that the plugin renders as an approval panel. You see the exact diff before anything is written to disk. Patches can be auto-applied, approval-gated, or preview-only depending on the permission mode you choose per turn.
- **Three permission modes per turn**:
  - **Read only** — Codex can analyze the vault but cannot write anything.
  - **Edit with approval** — Codex proposes patches, you approve each one.
  - **Edit automatically** — Codex proposes patches and the plugin applies them unless a review is required.
- **Stop button** — interrupt a running turn mid-stream.
- **Workflow-aware context** — paper-study, lecture-read, and homework workflows attach the right source material automatically instead of asking Codex to re-acquire it via shell tools every turn.
- **Bilingual UI** — English and Japanese.

---

## Requirements

Before installing the plugin, you need:

1. **Obsidian 1.5.0 or later**, desktop.
2. **The Codex CLI** installed and on your `PATH`. Install via the instructions at <https://github.com/openai/codex>.
3. **You must be logged in to Codex.** Run `codex login` once from your terminal and complete the ChatGPT login flow. The plugin uses your CLI session — it never reads API keys from the plugin settings and never stores credentials in the vault.
4. **Windows users should prefer a native Codex install first** (`codex`, `codex.cmd`, or `codex.exe`). WSL is supported as an optional fallback for WSL-native source paths and Windows sandbox recovery.

> The plugin does **not** bundle the Codex CLI. If `codex --version` doesn't work from your shell, the plugin won't work either — fix that first.

### Desktop support matrix

| Platform | Status | Notes |
| --- | --- | --- |
| macOS | Supported | Native `codex` install expected. |
| Windows | Supported | Native `codex` / `codex.cmd` / `codex.exe` preferred. WSL is optional fallback. |
| Linux | Supported | Native `codex` install expected. |
| iOS / Android | Not supported | The plugin shells out to the Codex CLI and remains desktop-only. |

---

## Install

### Via BRAT (recommended during beta)

1. Install the **BRAT** (Beta Reviewers Auto-update Tool) community plugin in Obsidian.
2. Open BRAT settings → *Add Beta Plugin* → paste `https://github.com/KK1182112KK/codex-noteforge`.
3. Enable **Codex Noteforge** under *Community plugins*.

### Manual

1. Download `obsidian-codex-study-v<version>.zip` from the latest [release](https://github.com/KK1182112KK/codex-noteforge/releases).
2. Extract the folder `obsidian-codex-study/` into `<your-vault>/.obsidian/plugins/`.
3. Restart Obsidian, open *Settings → Community plugins*, enable **Codex Noteforge**.

The release also ships standalone `manifest.json`, `main.js`, and `styles.css` assets if you prefer a manual copy instead of the zip.

### From source

```bash
git clone https://github.com/KK1182112KK/codex-noteforge.git
cd codex-noteforge
npm install
npm run build
CODEX_NOTEFORGE_PLUGIN_DIR="<your-vault>/.obsidian/plugins/obsidian-codex-study" npm run deploy
```

`npm run build` now produces the production bundle only. Set `CODEX_NOTEFORGE_PLUGIN_DIR` explicitly before `npm run deploy`; the deploy script no longer guesses a local vault path. The plugin folder itself remains `.obsidian/plugins/obsidian-codex-study/` for install compatibility.

For friend testing and beta feedback, see [TESTING.md](./TESTING.md).

---

## Quick start

1. Run `codex login` in your terminal if you haven't already. Verify with `codex --version`.
2. Open the plugin's workspace view (**Command palette → "Open Study workspace"**).
3. Type a request — e.g. "Summarize the key equations in this paper."
4. If the request implies editing a note ("clean up the formatting", "convert all math to LaTeX", "add a section on X"), Codex will emit a patch block that appears as an **approval panel**. Review the diff and click **Apply**.
5. Use the **Plan / Chat** toggle in the composer to switch modes. In plan mode, Codex asks clarifying questions instead of editing.
6. Use the **header buttons** to **Fork**, **Resume**, or **Compact** the current conversation.
7. When a turn is running, the **Send** button becomes a red stop control so you can interrupt it immediately.

---

## Settings

Open *Settings → Codex Noteforge*:

- **Codex runtime** — choose whether the plugin launches Codex from the native desktop environment or from WSL.
- **Codex executable path** — the `codex` executable to launch for the selected runtime. Leave this as `codex` to auto-detect a standard install. Absolute executable paths are supported too, including Windows-native `codex.cmd` / `codex.exe`.
- **Default model / reasoning effort** — forwarded to the CLI when starting a new thread.
- **Default permission mode** — which of the three modes a new turn starts in.
- **Language** — UI language (English or Japanese).

Package checks also verify the avatar source/generated pair by hashing `assets/chat-avatar-source.png` against the committed marker in `src/generated/chatAvatar.ts`. If you change the source image, run `npm run build:avatar` before committing.

---

## Troubleshooting

**"Codex CLI not found"** — Run `which codex` on macOS/Linux, or `where codex` on Windows. If Windows-native Codex is not available, you can also verify the fallback path with `wsl which codex`. If none of those resolve, install Codex first.

**"Not logged in"** — Run `codex login` in your terminal. The plugin cannot do this for you; the CLI owns the auth flow.

**Patch approval panel never appears after a request to edit a note** — Check the permission mode for the turn. "Read only" intentionally does not apply patches; switch to "Edit with approval" or "Edit automatically". If the mode is correct, the plugin now automatically re-prompts Codex when it promises a patch in prose but forgets to emit the actual block. If that retry also fails, rephrase the request more concretely (e.g. "replace the Core Equations section with LaTeX notation").

**Windows: "sandbox bootstrap failed"** — The plugin prefers a native Windows Codex install first. With the default launcher settings, it will automatically fall back to WSL for retryable sandbox/bootstrap failures and WSL-native source paths. If fallback still cannot resolve `codex`, fix the WSL PATH or set **Codex executable path** to the correct native or WSL executable for the runtime you selected.

**Session file missing / usage metrics not syncing** — Non-fatal. The plugin falls back to per-turn estimates. Check the developer console for warnings if you want details.

---

## Known limitations

- **Desktop only.** The plugin shells out to the Codex CLI and cannot run on Obsidian mobile.
- **English and Japanese UI only.** Other locales fall back to English.
- **One active Codex thread per tab.** Parallel turns on the same tab are not supported — use Fork to branch.
- **No merge UI.** If two patches target the same region, the second one fails to apply and you'll need to re-request.
- **Bundled CLI is not shipped.** You must install and log in to Codex yourself.

---

## Development

```bash
npm install
npm run dev        # watch build
npm run test       # vitest
npm run typecheck  # tsc --noEmit
npm run lint
npm run build:avatar  # regenerate tracked avatar module (requires Python 3 + Pillow)
npm run build      # production bundle only
npm run release:bundle
npm run deploy     # requires CODEX_NOTEFORGE_PLUGIN_DIR to be set explicitly
```

The plugin entry is `src/main.ts`. Service logic lives in `src/app/`, UI in `src/views/`, shared utilities in `src/util/`. Tests live alongside sources in `src/tests/`.

GitHub Actions is configured to run cross-platform CI on macOS, Windows, and Linux with `typecheck`, `test`, and `build`, and Ubuntu also runs `npm run check`.

If you update the source avatar image under `assets/`, regenerate the tracked avatar module explicitly with:

```bash
npm run build:avatar
```

The launcher tries `python3`, `python`, then `py -3`. It only falls through when an interpreter is missing or that interpreter's environment cannot import Pillow; missing source files, bad arguments, and image-processing failures stop immediately.

---

## License

[MIT](LICENSE) © KK1182112KK

---

## Acknowledgements

Built on top of the official [Codex CLI](https://github.com/openai/codex) by OpenAI. This plugin is not affiliated with or endorsed by OpenAI or Obsidian.
