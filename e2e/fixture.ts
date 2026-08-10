import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

type StopReason = "pending" | "aborted";
type AssistantMessage = {
	role: "assistant";
	api: string;
	provider: string;
	model: string;
	content: { type: "text"; text: string }[];
	usage: Usage;
	stopReason: StopReason;
	timestamp: number;
};
type AssistantMessageEvent =
	| { type: "start"; partial: AssistantMessage }
	| { type: "error"; reason: "aborted"; error: AssistantMessage };
type Usage = {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	totalTokens: number;
	cost: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number };
};

class TestStream {
	private queue: AssistantMessageEvent[] = [];
	private waiting: ((event: IteratorResult<AssistantMessageEvent>) => void)[] = [];

	push(event: AssistantMessageEvent): void {
		const waiter = this.waiting.shift();
		if (waiter) waiter({ value: event, done: false });
		else this.queue.push(event);
	}

	async *[Symbol.asyncIterator](): AsyncGenerator<AssistantMessageEvent> {
		while (true) {
			if (this.queue.length > 0) yield this.queue.shift()!;
			else yield (await new Promise<IteratorResult<AssistantMessageEvent>>((resolve) => this.waiting.push(resolve))).value;
		}
	}
}

const usage: Usage = {
	input: 0,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0,
	totalTokens: 0,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

function message(stopReason: AssistantMessage["stopReason"], text = ""): AssistantMessage {
	return {
		role: "assistant",
		api: "double-confirm-e2e",
		provider: "double-confirm-e2e",
		model: "model",
		content: text ? [{ type: "text", text }] : [],
		usage,
		stopReason,
		timestamp: Date.now(),
	};
}

export default function fixture(pi: ExtensionAPI): void {
	pi.registerProvider("double-confirm-e2e", {
		baseUrl: "http://double-confirm.invalid/v1",
		apiKey: "e2e",
		api: "double-confirm-e2e",
		models: [
			{
				id: "model",
				name: "Double Confirm E2E",
				reasoning: false,
				input: ["text"],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 8192,
				maxTokens: 1024,
			},
		],
		streamSimple: (_model, _context, options) => {
			const stream = new TestStream();
			const partial = message("pending");
			stream.push({ type: "start", partial });
			options?.signal?.addEventListener(
				"abort",
				() => stream.push({ type: "error", reason: "aborted", error: message("aborted") }),
				{ once: true },
			);
			return stream as never;
		},
	});

	pi.on("agent_start", (_event, ctx) => ctx.ui.setStatus("double-confirm-e2e", "E2E RUN ACTIVE"));
	pi.on("agent_end", (_event, ctx) => ctx.ui.setStatus("double-confirm-e2e", "E2E RUN ENDED"));
}
