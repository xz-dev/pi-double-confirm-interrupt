import { CustomEditor, type ExtensionAPI, type KeybindingsManager } from "@earendil-works/pi-coding-agent";
import type { EditorOptions, EditorTheme, TUI } from "@earendil-works/pi-tui";
import {
	emptyConfirmation,
	isQuitCommand,
	requestConfirmation,
	type ConfirmationAction,
	type ConfirmationState,
} from "./src/confirmation.ts";

const CONFIRM_WINDOW_MS = 1500;
const STATUS_KEY = "double-confirm-interrupt";

class ConfirmingEditor extends CustomEditor {
	private confirmation: ConfirmationState = emptyConfirmation();
	private guardedSubmitHandler: ((text: string) => void) | undefined;
	private restoringQuit = false;
	private timer: ReturnType<typeof setTimeout> | undefined;
	private disposed = false;
	private readonly isIdle: () => boolean;
	private readonly appKeybindings: KeybindingsManager;
	private readonly setStatus: (text?: string) => void;

	constructor(
		tui: TUI,
		theme: EditorTheme,
		keybindings: KeybindingsManager,
		isIdle: () => boolean,
		setStatus: (text?: string) => void,
		options?: EditorOptions,
	) {
		super(tui, theme, keybindings, options);
		this.isIdle = isIdle;
		this.appKeybindings = keybindings;
		this.setStatus = setStatus;

		Object.defineProperty(this, "onSubmit", {
			configurable: true,
			get: () => this.guardedSubmitHandler,
			set: (handler: ((text: string) => void) | undefined) => {
				this.guardedSubmitHandler = handler
					? (text) => {
							if (!isQuitCommand(text) || this.restoringQuit) {
								this.restoringQuit = false;
								handler(text);
								return;
							}
							if (this.confirm("quit-command", "Submit /quit again to quit Pi")) {
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

	private clearStatus(): void {
		this.clearTimer();
		this.setStatus();
	}

	private resetConfirmation(): void {
		this.clearStatus();
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
			this.clearStatus();
			return true;
		}

		if (this.timer) clearTimeout(this.timer);
		this.setStatus(hint);
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

		if (this.appKeybindings.matches(data, "app.exit") && this.getText().length === 0) {
			if (this.confirm("exit-key", "Press exit again to quit Pi")) super.handleInput(data);
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
				(text) => ctx.ui.setStatus(STATUS_KEY, text),
			);
			return editor;
		});
	});

	pi.on("session_shutdown", (_event, ctx) => {
		editor?.dispose();
		editor = undefined;
		ctx.ui.setStatus(STATUS_KEY, undefined);
	});
}
