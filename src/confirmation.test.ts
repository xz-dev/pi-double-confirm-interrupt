import assert from "node:assert/strict";
import test from "node:test";
import { emptyConfirmation, isQuitCommand, requestConfirmation } from "./confirmation.ts";

const WINDOW_MS = 1500;

test("requires the same action twice within the confirmation window", () => {
	const first = requestConfirmation(emptyConfirmation(), "interrupt", 1000, WINDOW_MS);
	assert.equal(first.confirmed, false);

	const second = requestConfirmation(first.state, "interrupt", 2499, WINDOW_MS);
	assert.equal(second.confirmed, true);
	assert.deepEqual(second.state, emptyConfirmation());
});

test("expiry or a different action starts a fresh confirmation", () => {
	const interrupt = requestConfirmation(emptyConfirmation(), "interrupt", 1000, WINDOW_MS);
	const quit = requestConfirmation(interrupt.state, "quit-command", 1100, WINDOW_MS);
	assert.equal(quit.confirmed, false);
	assert.equal(quit.state.action, "quit-command");

	const expired = requestConfirmation(quit.state, "quit-command", quit.state.expiresAt + 1, WINDOW_MS);
	assert.equal(expired.confirmed, false);
});

test("recognizes only Pi's exact built-in quit command", () => {
	assert.equal(isQuitCommand(" /quit "), true);
	assert.equal(isQuitCommand("/quit now"), false);
	assert.equal(isQuitCommand("/exit"), false);
});
