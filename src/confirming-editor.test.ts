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
	const statuses: (string | undefined)[] = [];
	sessionStart?.({}, {
		isIdle,
		ui: {
			setEditorComponent(next: typeof factory) {
				factory = next;
			},
			setStatus(_key: string, text: string | undefined) {
				statuses.push(text);
			},
		},
	});

	const matches = (data: string, action: string) =>
		(data === "I" && action === "app.interrupt") ||
		(data === "\x04" && (action === "app.exit" || action === "tui.editor.deleteCharForward")) ||
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
		statuses,
		shutdown: () => sessionShutdown?.({}, { ui: { setStatus: (_key: string, text: string | undefined) => statuses.push(text) } }),
	};
}

test("autocomplete consumes rebound interrupt without arming confirmation", () => {
	const { editor, statuses } = createEditor(() => false);
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
	assert.doesNotMatch(statuses.at(-1) ?? "", /interrupt again/);

	editor.handleInput("I");
	assert.equal(interrupted, 0);
	assert.match(statuses.at(-1) ?? "", /interrupt again/);
});

test("active interrupt and empty-editor exit require confirmation", () => {
	const { editor, statuses } = createEditor(() => false);
	let interrupted = 0;
	let exited = 0;
	editor.onEscape = () => interrupted++;
	editor.onCtrlD = () => exited++;

	editor.handleInput("I");
	assert.equal(interrupted, 0);
	assert.match(statuses.at(-1) ?? "", /interrupt again/);
	editor.handleInput("I");
	assert.equal(interrupted, 1);

	editor.handleInput("\x04");
	assert.equal(exited, 0);
	assert.match(statuses.at(-1) ?? "", /exit again/);
	editor.handleInput("\x04");
	assert.equal(exited, 1);
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

test("idle interrupt stays immediate while exit remains guarded", () => {
	const { editor } = createEditor(() => true);
	let interrupted = 0;
	let exited = 0;
	editor.onEscape = () => interrupted++;
	editor.onCtrlD = () => exited++;

	editor.handleInput("I");
	assert.equal(interrupted, 1);
	editor.handleInput("\x04");
	assert.equal(exited, 0);
	editor.handleInput("\x04");
	assert.equal(exited, 1);
});

test("unrelated input clears a pending confirmation", () => {
	const { editor, statuses } = createEditor(() => false);
	let interrupted = 0;
	editor.onEscape = () => interrupted++;

	editor.handleInput("I");
	editor.handleInput("a");
	editor.handleInput("I");
	assert.equal(interrupted, 0);
	assert.match(statuses.at(-1) ?? "", /interrupt again/);
});

test("shutdown cancels pending confirmation cleanup", async () => {
	const { editor, statuses, shutdown } = createEditor(() => false);
	editor.handleInput("I");
	shutdown();
	const countAfterShutdown = statuses.length;
	await new Promise((resolve) => setTimeout(resolve, 1600));
	assert.equal(statuses.length, countAfterShutdown);
});

test("exact /quit submission is restored until confirmed", async () => {
	const { editor, statuses } = createEditor(() => true);
	const submitted: string[] = [];
	editor.onSubmit = (text: string) => submitted.push(text);
	editor.setText("/quit");

	editor.handleInput("\r");
	await Promise.resolve();
	assert.deepEqual(submitted, []);
	assert.equal(editor.getText(), "/quit");
	assert.match(statuses.at(-1) ?? "", /Submit \/quit again/);

	editor.handleInput("\r");
	assert.deepEqual(submitted, ["/quit"]);
});
