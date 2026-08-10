# pi-double-confirm-interrupt

A small [Pi](https://github.com/earendil-works/pi) extension that prevents accidental interruption of an active agent run or accidental interactive exit.

## Behavior

- **Interrupt:** while Pi is running, the first configured `app.interrupt` key shows a warning; pressing interrupt again within 1.5 seconds stops the run.
- **Autocomplete:** if autocomplete is open, the first interrupt only closes autocomplete and does not start confirmation. Pi 0.84.1 exposes no public dismissal method, so this path uses its version-pinned internal `cancelAutocomplete()` method.
- **Ctrl-C:** still clears the main editor through its default `app.clear` binding, but repeated Ctrl-C presses never exit Pi. Non-Ctrl-C `app.clear` bindings keep Pi's native behavior.
- **Exit key:** empty-editor `app.exit` always requires two presses within 1.5 seconds, including the default Ctrl-D binding.
- **Quit command:** submitting the exact built-in `/quit` command always requires submitting it twice within 1.5 seconds.
- **Keybindings:** uses Pi's current `KeybindingsManager`; no physical Escape or Ctrl-D key is hard-coded.
- **Warning:** the confirmation hint appears on its own warning-colored line directly above the input editor.

Pi's existing idle double-interrupt action (`tree`, `fork`, or `none`) is unchanged.

This extension protects interactive editor input. Ctrl-C reaches Pi's raw-mode TUI as keyboard input rather than an OS signal. Pi 0.84.1 has no cancellable shutdown hook, so the extension cannot veto another extension calling `ctx.shutdown()`, actual process signals, terminal failure, or an external kill.

The extension replaces Pi's main editor with a `CustomEditor` subclass. Pi 0.84.1 cannot safely compose arbitrary custom editors, so do not combine it with Vim/Emacs/other editor-replacement extensions.

## Install

```bash
pi install git:github.com/xz-dev/pi-double-confirm-interrupt
```

Restart Pi or run `/reload` after installation.

## Remove

```bash
pi remove git:github.com/xz-dev/pi-double-confirm-interrupt
```

## Development

Requires Node.js 22.19 or newer.

```bash
npm install
npm run check
pi -e .
```

`npm run check` includes real Pi 0.84.1 E2E sessions driven through `tmux`. The suite uses an isolated agent directory and a local fake provider, so it needs `tmux` but no network credentials.

## License

[MIT](LICENSE)
