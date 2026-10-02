import { CustomEditor, type ExtensionAPI, type KeybindingsManager } from "@earendil-works/pi-coding-agent";
import { matchesKey, type EditorOptions, type EditorTheme, type TUI } from "@earendil-works/pi-tui";
import {
	emptyConfirmation,
	isQuitCommand,
	requestConfirmation,
	type ConfirmationAction,
	type ConfirmationState,
} from "./src/confirmation.ts";

const CONFIRM_WINDOW_MS = 1500;
const WIDGET_KEY = "double-confirm-interrupt";

class ConfirmingEditor extends CustomEditor {
	public readonly embedWorkingStatus = true;
	private confirmation: ConfirmationState = emptyConfirmation();
	private guardedSubmitHandler: ((text: string) => void) | undefined;
	private restoringQuit = false;
	private timer: ReturnType<typeof setTimeout> | undefined;
	private disposed = false;
	private readonly isIdle: () => boolean;
	private readonly appKeybindings: KeybindingsManager;
	private readonly setHint: (text?: string) => void;

	constructor(
		tui: TUI,
		theme: EditorTheme,
		keybindings: KeybindingsManager,
		isIdle: () => boolean,
		setHint: (text?: string) => void,
		options?: EditorOptions,
	) {
		super(tui, theme, keybindings, options);
		this.isIdle = isIdle;
		this.appKeybindings = keybindings;
		this.setHint = setHint;

		Object.defineProperty(this, "onSubmit", {
			configurable: true,
			get: () => this.guardedSubmitHandler,
			set: (handler: ((text: string) => void) | undefined) => {
				this.guardedSubmitHandler = handler
					? (text) => {
							if (!isQuitCommand(text) || this.restoringQuit || this.isIdle()) {
								this.restoringQuit = false;
								handler(text);
								return;
							}
							if (this.confirm("quit-command", "Submit /quit again to stop the active run and quit Pi")) {
								handler(text);
								return;
							}
							this.restoringQuit = true;
							queueMicrotask(() => this.setText(text));
						}
					: undefined;
			},
		});
	}

	private clearTimer(): void {
		if (this.timer) clearTimeout(this.timer);
		this.timer = undefined;
	}

	private clearHint(): void {
		this.clearTimer();
		this.setHint();
	}

	private resetConfirmation(): void {
		this.clearHint();
		this.confirmation = emptyConfirmation();
	}

	private dismissAutocomplete(): void {
		const editor = this as unknown as { cancelAutocomplete(): void };
		editor.cancelAutocomplete();
	}

	dispose(): void {
		this.disposed = true;
		this.restoringQuit = false;
		this.resetConfirmation();
	}

	private confirm(action: ConfirmationAction, hint: string): boolean {
		const result = requestConfirmation(this.confirmation, action, Date.now(), CONFIRM_WINDOW_MS);
		this.confirmation = result.state;
		if (result.confirmed) {
			this.clearHint();
			return true;
		}

		if (this.timer) clearTimeout(this.timer);
		this.setHint(hint);
		this.timer = setTimeout(() => {
			if (!this.disposed) this.resetConfirmation();
		}, CONFIRM_WINDOW_MS);
		return false;
	}

	handleInput(data: string): void {
		if (this.restoringQuit && this.appKeybindings.matches(data, "tui.input.submit")) {
			this.restoringQuit = false;
			super.handleInput(data);
			return;
		}

		if (this.appKeybindings.matches(data, "app.interrupt")) {
			if (this.isShowingAutocomplete()) {
				this.resetConfirmation();
				this.dismissAutocomplete();
				return;
			}
			if (this.isIdle()) {
				this.resetConfirmation();
				super.handleInput(data);
				return;
			}
			if (this.confirm("interrupt", "Press interrupt again to stop the active run")) super.handleInput(data);
			return;
		}

		if (matchesKey(data, "ctrl+c") && this.appKeybindings.matches(data, "app.clear")) {
			this.resetConfirmation();
			this.setText("");
			return;
		}

		if (this.appKeybindings.matches(data, "app.exit") && this.getText().length === 0 && !this.isIdle()) {
			if (this.confirm("exit-key", "Press exit again to stop the active run and quit Pi")) super.handleInput(data);
			return;
		}

		this.resetConfirmation();
		super.handleInput(data);
	}
}

export default function doubleConfirmInterrupt(pi: ExtensionAPI): void {
	let editor: ConfirmingEditor | undefined;

	pi.on("session_start", (_event, ctx) => {
		ctx.ui.setEditorComponent((tui, theme, keybindings) => {
			editor = new ConfirmingEditor(
				tui,
				theme,
				keybindings,
				() => ctx.isIdle(),
				(text) => ctx.ui.setWidget(WIDGET_KEY, text ? [ctx.ui.theme.fg("warning", text)] : undefined),
			);
			return editor;
		});
	});

	pi.on("session_shutdown", (_event, ctx) => {
		editor?.dispose();
		editor = undefined;
		ctx.ui.setWidget(WIDGET_KEY, undefined);
	});
}
