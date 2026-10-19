// Decomaan/Bifrost flow: Chat Completions + response_format json_schema + stream:false
// against the Codex (Responses API, forceStream) provider. Drives the REAL handleChatCore;
// only the executor's HTTP response is mocked (Codex always answers with SSE).
import { describe, it, expect, vi, beforeEach } from "vitest";

const { executeMock } = vi.hoisted(() => ({ executeMock: vi.fn() }));

vi.mock("../../open-sse/executors/index.js", () => ({
  getExecutor: () => ({ noAuth: true, execute: executeMock }),
}));
vi.mock("../../open-sse/utils/requestLogger.js", () => ({
  createRequestLogger: async () => ({
    logClientRawRequest: vi.fn(), logRawRequest: vi.fn(), logTargetRequest: vi.fn(),
    logProviderResponse: vi.fn(), logConvertedResponse: vi.fn(), logError: vi.fn(),
  }),
}));
vi.mock("../../open-sse/utils/stream.js", () => ({
  COLORS: { red: "", reset: "" },
  createPassthroughStreamWithLogger: vi.fn(() => new TransformStream()),
}));
vi.mock("uuid", () => ({ v4: () => "00000000-0000-4000-8000-000000000000" }));
vi.mock("@/lib/usageDb.js", () => ({
  trackPendingRequest: vi.fn(),
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
  saveRequestUsage: vi.fn(async () => {}),
}));
vi.mock("../../open-sse/translator/concerns/image.js", () => ({
  encodeDataUri: (m, b) => `data:${m};base64,${b}`,
  parseDataUri: () => null,
  fetchImageAsBase64: async () => null,
}));

const { handleChatCore } = await import("../../open-sse/handlers/chatCore.js");

const schema = {
  type: "object", additionalProperties: false, required: ["name"],
  properties: { name: { type: "string" } },
};
const JSON_TEXT = JSON.stringify({ name: "Ada" });

const ev = (type, data) => `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
const CODEX_SSE =
  ev("response.created", { response: { id: "resp_1", created_at: 1700000000 } }) +
  ev("response.output_item.done", {
    output_index: 0,
    item: { type: "message", role: "assistant", content: [{ type: "output_text", text: JSON_TEXT }] },
  }) +
  ev("response.completed", { response: { usage: { input_tokens: 5, output_tokens: 4, total_tokens: 9 } } });

async function call({ stream, headers = {} }) {
  executeMock.mockImplementationOnce(async () => ({
    response: new Response(CODEX_SSE, { status: 200, headers: { "content-type": "text/event-stream" } }),
    url: "https://example.invalid/responses", headers: {}, transformedBody: null,
  }));
  const body = {
    model: "cx/gpt-5.6-terra",
    messages: [{ role: "user", content: "who?" }],
    response_format: { type: "json_schema", json_schema: { name: "Person", strict: true, schema } },
    ...(stream === undefined ? {} : { stream }),
  };
  const result = await handleChatCore({
    body, modelInfo: { provider: "codex", model: "gpt-5.6-terra" },
    credentials: { accessToken: "t", providerSpecificData: {} },
    connectionId: "c", sourceFormatOverride: "openai",
    clientRawRequest: { endpoint: "/v1/chat/completions", headers },
    log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn() },
  });
  return { result, sent: executeMock.mock.calls.at(-1)[0] };
}

describe("codex + json_schema + non-streaming client", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([
    ["stream:false", { stream: false }],
    ["stream:false + Accept: */*", { stream: false, headers: { accept: "*/*" } }],
    ["stream:false + Accept: text/event-stream", { stream: false, headers: { accept: "text/event-stream" } }],
    ["stream omitted", {}],
  ])("returns one JSON chat.completion with the schema-shaped content (%s)", async (_n, opts) => {
    const { result, sent } = await call(opts);
    const wire = sent.body ?? sent.transformedBody;
    expect(wire.text?.format).toMatchObject({ type: "json_schema", name: "Person", schema });
    expect(result.success).toBe(true);
    expect(result.response.headers.get("content-type")).toMatch(/application\/json/);
    const json = await result.response.json();
    expect(json.object).toBe("chat.completion");
    expect(JSON.parse(json.choices[0].message.content)).toEqual({ name: "Ada" });
    expect(json.choices[0].message.role).toBe("assistant");
  });
});
