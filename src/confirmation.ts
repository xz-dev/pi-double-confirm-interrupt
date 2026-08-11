export type ConfirmationAction = "interrupt" | "quit-command";

export interface ConfirmationState {
	action: ConfirmationAction | null;
	expiresAt: number;
}

export interface ConfirmationResult {
	state: ConfirmationState;
	confirmed: boolean;
}

export const emptyConfirmation = (): ConfirmationState => ({ action: null, expiresAt: 0 });

export function requestConfirmation(
	state: ConfirmationState,
	action: ConfirmationAction,
	now: number,
	windowMs: number,
): ConfirmationResult {
	if (state.action === action && now <= state.expiresAt) {
		return { state: emptyConfirmation(), confirmed: true };
	}

	return {
		state: { action, expiresAt: now + windowMs },
		confirmed: false,
	};
}

export const isQuitCommand = (text: string): boolean => text.trim() === "/quit";
