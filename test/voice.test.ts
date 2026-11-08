import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../server/app.js";
import { GeminiApiProvider } from "../server/llm/gemini-api.js";
import { ProviderChain } from "../server/llm/index.js";
import { MOCK_TRANSCRIPT } from "../server/llm/mock.js";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

/** A WAV header plus `bytes` of silence-shaped data; the mock treats < 1 KB as silence. */
const wav = (bytes: number, type = "audio/wav") => new File([new Uint8Array(44 + bytes)], "voice.wav", { type });
const send = (app: ReturnType<typeof createApp>, file?: File) => {
  const form = new FormData();
  if (file) form.set("audio", file);
  return app.request("/api/transcribe", { method: "POST", body: form });
};

describe("voice notes (/api/transcribe)", () => {
  const app = createApp({ llm: new ProviderChain(["mock"]), decaidUrl: null });

  it("says in /api/config which provider transcribes", async () => {
    expect((await (await app.request("/api/config")).json()).voice).toBe("mock");
  });

  it("turns a recording into text", async () => {
    const res = await send(app, wav(32_000));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ text: MOCK_TRANSCRIPT, provider: "mock" });
  });

  it("returns empty text for silence", async () => {
    expect((await (await send(app, wav(100))).json()).text).toBe("");
  });

  it("rejects a missing, unsupported or oversized recording", async () => {
    expect((await send(app)).status).toBe(400);
    expect((await send(app, wav(32_000, "audio/webm"))).status).toBe(400);
    expect((await send(app, wav(5 * 1024 * 1024))).status).toBe(413);
  });

  it("is off, and says why, without a provider that hears audio", async () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    const noVoice = createApp({ llm: new ProviderChain(["claude-cli"]), decaidUrl: null });
    expect((await (await noVoice.request("/api/config")).json()).voice).toBeNull();
    const res = await send(noVoice, wav(32_000));
    expect(res.status).toBe(501);
    expect((await res.json()).error).toMatch(/GEMINI_API_KEY/);
  });

  it("adds Gemini for voice alone when a key is set, whatever LLM_PROVIDERS says", () => {
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    expect(new ProviderChain(["claude-cli", "codex-cli"]).transcribers.map((p) => p.id)).toEqual(["gemini-api"]);
  });
});

describe("Gemini transcription", () => {
  const reply = (body: unknown, status = 200) =>
    vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));
  const audio = { data: Buffer.from("RIFF-test-audio"), mediaType: "audio/wav" as const };

  it("sends the audio inline with a fixed JSON reply shape, and reads the text back", async () => {
    const fetch = reply({ candidates: [{ content: { parts: [{ text: '{"text":"  ONA La Fincona, roasted the 2nd  "}' }] } }] });
    vi.stubGlobal("fetch", fetch);
    const gemini = new GeminiApiProvider("k", "gemini-2.5-flash", "gemini-voice-test");
    expect(await gemini.transcribe({ audio, context: "About a coffee bag." })).toBe("ONA La Fincona, roasted the 2nd");

    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-voice-test:generateContent");
    expect((init.headers as Record<string, string>)["x-goog-api-key"]).toBe("k");
    const body = JSON.parse(String(init.body));
    expect(body.contents[0].parts[0].inline_data).toEqual({ mime_type: "audio/wav", data: audio.data.toString("base64") });
    expect(body.generationConfig.responseMimeType).toBe("application/json");
    expect(body.generationConfig.responseSchema.required).toEqual(["text"]);
    expect(body.systemInstruction.parts[0].text).toContain("About a coffee bag.");
    expect(body.tools).toBeUndefined();
  });

  it("reports HTTP errors and unreadable replies", async () => {
    vi.stubGlobal("fetch", reply({ error: "quota" }, 429));
    await expect(new GeminiApiProvider("k").transcribe({ audio, context: "" })).rejects.toThrow(/HTTP 429/);
    vi.stubGlobal("fetch", reply({ candidates: [{ content: { parts: [{ text: "not json" }] } }] }));
    await expect(new GeminiApiProvider("k").transcribe({ audio, context: "" })).rejects.toThrow(/could not parse transcript/);
  });

  it("needs a key", async () => {
    await expect(new GeminiApiProvider("").transcribe({ audio, context: "" })).rejects.toThrow(/GEMINI_API_KEY/);
  });
});
