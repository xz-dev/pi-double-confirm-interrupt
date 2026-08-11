import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sessions: string[] = [];
const tempDirs: string[] = [];

function run(command: string, args: string[], cwd = root) {
	return spawnSync(command, args, { cwd, encoding: "utf8" });
}

function mustRun(command: string, args: string[], cwd = root): void {
	const result = run(command, args, cwd);
	assert.equal(result.status, 0, `${command} ${args.join(" ")}\n${result.stdout}\n${result.stderr}`);
}

function capture(session: string): string {
	return run("tmux", ["capture-pane", "-t", session, "-p", "-S", "-2000"]).stdout;
}

function alive(session: string): boolean {
	return run("tmux", ["has-session", "-t", session]).status === 0;
}

function waitFor(session: string, predicate: (output: string) => boolean, label: string): string {
	const deadline = Date.now() + 15_000;
	let output = "";
	while (Date.now() < deadline) {
		if (!alive(session)) {
			if (predicate(output) || label === "Pi exit" || label === "Pi quit") return output;
			assert.fail(`Pi exited while waiting for ${label}\n${output}`);
		}
		output = capture(session);
		if (predicate(output)) return output;
		Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
	}
	assert.fail(`timed out waiting for ${label}\n${output}`);
}

function start(name: string, keybindings?: Record<string, string>): string {
	assert.equal(run("tmux", ["-V"]).status, 0, "tmux is required for the real Pi E2E tests");
	const agentDir = mkdtempSync(join(tmpdir(), "pi-double-confirm-e2e-"));
	tempDirs.push(agentDir);
	mkdirSync(agentDir, { recursive: true });
	if (keybindings) writeFileSync(join(agentDir, "keybindings.json"), JSON.stringify(keybindings));

	const session = `pi-double-confirm-${name}-${process.pid}-${Date.now()}`;
	sessions.push(session);
	const args = [
		"--no-extensions",
		"-e",
		join(root, "index.ts"),
		"-e",
		join(root, "e2e/fixture.ts"),
		"--no-skills",
		"--no-prompt-templates",
		"--no-context-files",
		"--no-themes",
		"--no-session",
		"--offline",
		"--no-approve",
		"--provider",
		"double-confirm-e2e",
		"--model",
		"model",
	];
	const command = `PI_CODING_AGENT_DIR=${JSON.stringify(agentDir)} ${JSON.stringify(join(root, "node_modules/.bin/pi"))} ${args.map((arg) => JSON.stringify(arg)).join(" ")}`;
	mustRun("tmux", ["new-session", "-d", "-s", session, "-x", "100", "-y", "32", command]);
	waitFor(session, (output) => output.includes("pi v0.84.1") && output.includes("[Extensions]"), "Pi startup");
	return session;
}

function assertHintAboveEditor(output: string, hint: string): void {
	const lines = output.split("\n");
	const hintLine = lines.findIndex((line) => line.includes(hint));
	const editorBorderLine = lines.findIndex((line, index) => index > hintLine && line.includes("─"));
	assert.ok(hintLine >= 0 && editorBorderLine === hintLine + 1, `expected hint directly above editor\n${output}`);
}

function send(session: string, ...keys: string[]): void {
	mustRun("tmux", ["send-keys", "-t", session, ...keys]);
}

function type(session: string, text: string): void {
	mustRun("tmux", ["send-keys", "-t", session, "-l", text]);
}

function cleanup(): void {
	for (const session of sessions.splice(0)) run("tmux", ["kill-session", "-t", session]);
	for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
}

process.on("exit", cleanup);

test("real Pi requires two rebound interrupts before aborting an active run", { timeout: 30_000 }, () => {
	const session = start("interrupt", { "app.interrupt": "ctrl+x", "tui.select.cancel": "escape" });
	try {
		send(session, "hello", "Enter");
		waitFor(session, (output) => output.includes("E2E RUN ACTIVE"), "active agent run");
		send(session, "C-x");
		const armed = waitFor(session, (output) => output.includes("Press interrupt again"), "interrupt confirmation");
		assertHintAboveEditor(armed, "Press interrupt again");
		assert.doesNotMatch(armed, /E2E RUN ENDED|aborted/i);
		send(session, "C-x");
		waitFor(session, (output) => output.includes("E2E RUN ENDED"), "aborted agent run");
	} finally {
		cleanup();
	}
});

test("real Pi rebound interrupt only closes autocomplete before arming", { timeout: 30_000 }, () => {
	const session = start("autocomplete", { "app.interrupt": "ctrl+x", "tui.select.cancel": "escape" });
	try {
		type(session, "/");
		Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200);
		type(session, "q");
		waitFor(session, (output) => output.includes("quit") && output.includes("Quit pi"), "autocomplete list");
		send(session, "C-x");
		const dismissed = waitFor(session, (output) => !output.includes("Quit pi"), "autocomplete dismissal");
		assert.match(dismissed, /\/q/);
		assert.doesNotMatch(dismissed, /Press interrupt again/);
		send(session, "C-c");
		type(session, "hello");
		send(session, "Enter");
		waitFor(session, (output) => output.includes("E2E RUN ACTIVE"), "active run after autocomplete");
		send(session, "C-x");
		const armed = waitFor(session, (output) => output.includes("Press interrupt again"), "fresh interrupt confirmation");
		assert.doesNotMatch(armed, /E2E RUN ENDED/);
	} finally {
		cleanup();
	}
});

test("real Pi Ctrl-C clears the editor but repeated Ctrl-C never exits", { timeout: 30_000 }, () => {
	const session = start("ctrl-c");
	try {
		const draft = "UNSENT CTRL-C DRAFT";
		type(session, draft);
		waitFor(session, (output) => output.includes(draft), "draft input");

		send(session, "C-c");
		waitFor(session, (output) => !output.includes(draft), "Ctrl-C editor clear");
		send(session, "C-c", "C-c");
		Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 750);
		assert.equal(alive(session), true);

		type(session, "hello");
		send(session, "Enter");
		waitFor(session, (output) => output.includes("E2E RUN ACTIVE"), "usable Pi after repeated Ctrl-C");
	} finally {
		cleanup();
	}
});

test("real Pi exits on the first empty-editor Ctrl-D key press", { timeout: 30_000 }, () => {
	const session = start("ctrl-d");
	try {
		send(session, "C-d");
		waitFor(session, () => !alive(session), "Pi exit");
	} finally {
		cleanup();
	}
});

test("real Pi restores exact /quit once and exits on the second submission", { timeout: 30_000 }, () => {
	const session = start("quit");
	try {
		send(session, "/quit", "Enter");
		const armed = waitFor(session, (output) => output.includes("Submit /quit again"), "quit confirmation");
		assertHintAboveEditor(armed, "Submit /quit again");
		assert.match(armed, /\/quit/);
		assert.equal(alive(session), true);
		send(session, "Enter");
		waitFor(session, () => !alive(session), "Pi quit");
	} finally {
		cleanup();
	}
});
