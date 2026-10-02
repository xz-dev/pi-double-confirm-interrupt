import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { KeybindingsManager } from "@earendil-works/pi-coding-agent";
import type { EditorTheme, TUI } from "@earendil-works/pi-tui";
import extension from "../index.ts";

function createEditor(isIdle: () => boolean) {
	let sessionStart: ((event: unknown, ctx: any) => void) | undefined;
	let sessionShutdown: ((event: unknown, ctx: any) => void) | undefined;
	const pi = {
		on(event: string, handler: (event: unknown, ctx: any) => void) {
			if (event === "session_start") sessionStart = handler;
			if (event === "session_shutdown") sessionShutdown = handler;
		},
	} as unknown as ExtensionAPI;
	extension(pi);

	let factory: ((tui: TUI, theme: EditorTheme, keybindings: KeybindingsManager) => any) | undefined;
	const hints: (string | undefined)[] = [];
	sessionStart?.({}, {
		isIdle,
		ui: {
			theme: { fg: (_color: string, text: string) => text },
			setEditorComponent(next: typeof factory) {
				factory = next;
			},
			setWidget(_key: string, lines: string[] | undefined) {
				hints.push(lines?.[0]);
			},
		},
	});

	const matches = (data: string, action: string) =>
		(data === "I" && action === "app.interrupt") ||
		((data === "\x03" || data === "X") && action === "app.clear") ||
		((data === "\x04" || data === "E") && action === "app.exit") ||
		(data === "\x04" && action === "tui.editor.deleteCharForward") ||
		(data === "\r" && action === "tui.input.submit");
	const keybindings = { matches, getKeys: () => [] } as unknown as KeybindingsManager;
	const tui = { requestRender() {}, terminal: { columns: 80, rows: 24 } } as unknown as TUI;
	const theme = {
		borderColor: (text: string) => text,
		selectList: {},
	} as unknown as EditorTheme;

	const editor = factory!(tui, theme, keybindings);
	return {
		editor,
		hints,
		shutdown: () =>
			sessionShutdown?.({}, { ui: { setWidget: (_key: string, lines: string[] | undefined) => hints.push(lines?.[0]) } }),
	};
}

test("custom editor opts into Pi's embedded session status", () => {
	const { editor } = createEditor(() => false);
	assert.equal(editor.embedWorkingStatus, true);
});

test("autocomplete consumes rebound interrupt without arming confirmation", () => {
	const { editor, hints } = createEditor(() => false);
	let interrupted = 0;
	editor.onEscape = () => interrupted++;
	editor.setText("/abc");
	Object.defineProperty(editor, "state", {
		configurable: true,
		writable: true,
		value: { lines: ["/abc"], cursorLine: 0, cursorCol: 2 },
	});
	const beforeText = editor.getText();
	const beforeExpandedText = editor.getExpandedText();
	const beforeCursor = editor.getCursor();
	Object.defineProperty(editor, "autocompleteState", { configurable: true, writable: true, value: "regular" });
	Object.defineProperty(editor, "autocompleteList", { configurable: true, writable: true, value: {} });

	editor.handleInput("I");
	assert.equal(interrupted, 0);
	assert.equal(editor.isShowingAutocomplete(), false);
	assert.equal(editor.getText(), beforeText);
	assert.equal(editor.getExpandedText(), beforeExpandedText);
	assert.deepEqual(editor.getCursor(), beforeCursor);
	assert.doesNotMatch(hints.at(-1) ?? "", /interrupt again/);

	editor.handleInput("I");
	assert.equal(interrupted, 0);
	assert.match(hints.at(-1) ?? "", /interrupt again/);
});

test("confirmation hint uses a dedicated widget line above the editor", () => {
	const { editor, hints } = createEditor(() => false);
	editor.handleInput("I");
	assert.equal(hints.at(-1), "Press interrupt again to stop the active run");
});

test("active interrupt and empty-editor exit require confirmation", () => {
	const { editor, hints } = createEditor(() => false);
	let interrupted = 0;
	let exited = 0;
	editor.onEscape = () => interrupted++;
	editor.onCtrlD = () => exited++;

	editor.handleInput("I");
	assert.equal(interrupted, 0);
	assert.match(hints.at(-1) ?? "", /interrupt again/);
	editor.handleInput("I");
	assert.equal(interrupted, 1);

	editor.handleInput("E");
	assert.equal(exited, 0);
	assert.match(hints.at(-1) ?? "", /exit again/);
	editor.handleInput("E");
	assert.equal(exited, 1);
});

test("Ctrl-C clears input without delegating to Pi's exit handler", () => {
	const { editor } = createEditor(() => true);
	let cleared = 0;
	editor.onAction("app.clear", () => cleared++);
	editor.setText("draft");

	editor.handleInput("\x03");
	editor.handleInput("\x03");
	editor.handleInput("\x03");
	assert.equal(editor.getText(), "");
	assert.equal(cleared, 0);
});

test("non-Ctrl-C clear bindings keep Pi's native action", () => {
	const { editor } = createEditor(() => true);
	let cleared = 0;
	editor.onAction("app.clear", () => cleared++);

	editor.handleInput("X");
	assert.equal(cleared, 1);
});

test("non-empty exit key preserves forward-delete behavior", () => {
	const { editor } = createEditor(() => true);
	editor.setText("ab");
	Object.defineProperty(editor, "state", {
		configurable: true,
		writable: true,
		value: { lines: ["ab"], cursorLine: 0, cursorCol: 1 },
	});

	editor.handleInput("\x04");
	assert.equal(editor.getText(), "a");
});

test("idle interrupt and empty-editor exit stay immediate", () => {
	const { editor } = createEditor(() => true);
	let interrupted = 0;
	let exited = 0;
	editor.onEscape = () => interrupted++;
	editor.onCtrlD = () => exited++;

	editor.handleInput("I");
	assert.equal(interrupted, 1);
	editor.handleInput("\x04");
	assert.equal(exited, 1);
});

test("unrelated input clears a pending confirmation", () => {
	const { editor, hints } = createEditor(() => false);
	let interrupted = 0;
	editor.onEscape = () => interrupted++;

	editor.handleInput("I");
	editor.handleInput("a");
	editor.handleInput("I");
	assert.equal(interrupted, 0);
	assert.match(hints.at(-1) ?? "", /interrupt again/);
});

test("shutdown cancels pending confirmation cleanup", async () => {
	const { editor, hints, shutdown } = createEditor(() => false);
	editor.handleInput("I");
	shutdown();
	const countAfterShutdown = hints.length;
	await new Promise((resolve) => setTimeout(resolve, 1600));
	assert.equal(hints.length, countAfterShutdown);
});

test("active exact /quit submission is restored until confirmed", async () => {
	const { editor, hints } = createEditor(() => false);
	const submitted: string[] = [];
	editor.onSubmit = (text: string) => submitted.push(text);
	editor.setText("/quit");

	editor.handleInput("\r");
	await Promise.resolve();
	assert.deepEqual(submitted, []);
	assert.equal(editor.getText(), "/quit");
	assert.match(hints.at(-1) ?? "", /Submit \/quit again/);

	editor.handleInput("\r");
	assert.deepEqual(submitted, ["/quit"]);
});

test("idle exact /quit submission stays immediate", () => {
	const { editor } = createEditor(() => true);
	const submitted: string[] = [];
	editor.onSubmit = (text: string) => submitted.push(text);
	editor.setText("/quit");

	editor.handleInput("\r");
	assert.deepEqual(submitted, ["/quit"]);
});
