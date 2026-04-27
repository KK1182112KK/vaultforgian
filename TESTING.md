# Friend Testing Guide

This repo is distributed as a public beta.

Product name is **Codex Noteforge**. The Obsidian plugin id and installed folder remain `obsidian-codex-study` for beta compatibility, so existing manual installs and update paths continue to work.

## Before You Install

You need all of the following:

1. Obsidian Desktop `1.5.0+`
2. The Codex CLI installed on your machine
3. A completed `codex login`
4. Desktop OS only: macOS, Windows, or Linux

If `codex --version` or `codex login` does not work in your terminal, fix that before testing the plugin.

## Install Options

### Recommended: BRAT

1. Install the **BRAT** community plugin in Obsidian.
2. In BRAT, choose **Add Beta Plugin**.
3. Paste `https://github.com/KK1182112KK/codex-noteforge`.
4. Enable **Codex Noteforge** in Community Plugins.

### Manual Release Install

1. Download `obsidian-codex-study-v<version>.zip` from the latest GitHub Release.
2. Extract `obsidian-codex-study/` into:
   `<your-vault>/.obsidian/plugins/`
3. Restart Obsidian and enable **Codex Noteforge**.

## First Checks

After install, please verify:

1. The plugin enables without crashing.
2. `Open Codex Noteforge workspace` opens the workspace view.
3. The settings tab opens and shows the new layout.
4. You can create a chat tab and type in the composer.
5. If you shrink the Obsidian window, the header/actions and chat hub still remain usable.

## What To Report

When sending feedback, include:

- Your OS (`Windows`, `macOS`, or `Linux`)
- Obsidian version
- Whether you used BRAT or manual install
- Whether `codex --version` works
- What you clicked
- What you expected
- What actually happened
- A screenshot if the issue is visual

## Known Beta Limits

- Desktop only
- Requires a local Codex CLI install and login
- The plugin is still in early beta, so visual polish and workflow edge cases are still being tightened
