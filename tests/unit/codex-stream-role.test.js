// LangChain / the openai SDK stream accumulator build the assistant message from the first
// chunk's delta.role; a Codex (Responses API) stream translated to Chat must carry it.
import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/usageDb.js", () => ({
  trackPendingRequest: vi.fn(),
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
  saveRequestUsage: vi.fn(async () => {}),
}));

const { createSSETransformStreamWithLogger } = await import("../../open-sse/utils/stream.js");
const { FORMATS } = await import("../../open-sse/translator/formats.js");

const e = (t, d) => `event: ${t}\ndata: ${JSON.stringify({ type: t, ...d })}\n\n`;

async function chunksFor(raw) {
  const ts = createSSETransformStreamWithLogger(FORMATS.OPENAI_RESPONSES, FORMATS.OPENAI, "codex", null, null, "m", "c", { stream: true });
  const text = await new Response(new Response(raw).body.pipeThrough(ts)).text();
  return text.split("\n\n").filter((l) => l.startsWith("data: {")).map((l) => JSON.parse(l.slice(6)));
}

describe("codex stream -> chat.completion.chunk role", () => {
  it("first chunk announces delta.role=assistant, later chunks do not repeat it", async () => {
    const chunks = await chunksFor(
      e("response.created", { response: { id: "resp_1", created_at: 1 } }) +
      e("response.output_item.added", { output_index: 0, item: { id: "msg_1", type: "message", role: "assistant", content: [] } }) +
      e("response.output_text.delta", { output_index: 0, delta: '{"name":' }) +
      e("response.output_text.delta", { output_index: 0, delta: '"Ada"}' }) +
      e("response.completed", { response: { usage: { input_tokens: 5, output_tokens: 4, total_tokens: 9 } } }),
    );
    expect(chunks[0].choices[0].delta.role).toBe("assistant");
    expect(chunks.slice(1).every((c) => c.choices[0].delta.role === undefined)).toBe(true);
    expect(chunks.map((c) => c.choices[0].delta.content ?? "").join("")).toBe('{"name":"Ada"}');
  });

  it("a tool-call-first stream also gets the role on its first chunk", async () => {
    const chunks = await chunksFor(
      e("response.created", { response: { id: "resp_2", created_at: 1 } }) +
      e("response.output_item.added", { output_index: 0, item: { id: "fc_1", type: "function_call", call_id: "call_1", name: "lookup", arguments: "" } }) +
      e("response.completed", { response: { usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } } }),
    );
    expect(chunks[0].choices[0].delta.role).toBe("assistant");
    expect(chunks[0].choices[0].delta.tool_calls[0].function.name).toBe("lookup");
  });
});
