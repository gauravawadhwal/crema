import { describe, expect, it } from "vitest";
import { plainError } from "../server/control/index.js";

const FB = "Decaid couldn't do that. Try again.";

describe("plainError", () => {
  it.each([
    ["an HTTP verb and path", "PUT /api/v1/workflow failed"],
    ["the word HTTP", "HTTP error while saving"],
    ["a status code", "request failed with status 503"],
    ["a leading code", "500 Internal Server Error"],
    ["a code with a colon", "Decaid said 404: not found"],
    ["a URL", "Could not reach https://example.test/v1/beans"],
    ["an IP address", "connect to 192.168.1.20 refused"],
    ["localhost", "localhost refused the connection"],
    ["a route", "/workflow rejected the body"],
    ["a file path", "ENOENT: no such file /srv/crema/data.json"],
    ["a relative path", "failed to read ./skin/app.js"],
    ["a source location", "app.js:2041 went wrong"],
    ["an exception name", "TypeError: x is not a function"],
    ["an exception with prefix", "ZodError: expected number"],
    ["a stack fragment", "boom\n    at loadNow (app.js:10:5)"],
    ["a JS runtime message", "Cannot read properties of undefined (reading 'id')"],
    ["a JSON blob", '{"error":"bad","code":12}'],
    ["a JSON array", '[{"path":["a"],"message":"bad"}]'],
    ["a JSON fragment mid-text", 'Decaid answered {"message":"no"}'],
    ["claude-cli", "claude-cli exited with code 1"],
    ["codex-cli", "codex-cli timed out"],
    ["gemini-api", "gemini-api returned nothing"],
    ["anthropic-api", "anthropic-api overloaded"],
    ["mock", "mock provider has no answer"],
    ["an empty message", ""],
    ["a very long message", "word ".repeat(80)],
  ])("falls back for %s", (_n, msg) => {
    expect(plainError(msg, FB)).toBe(FB);
  });

  it("falls back for nothing at all", () => {
    expect(plainError(undefined, FB)).toBe(FB);
    expect(plainError(null, FB)).toBe(FB);
  });

  it.each([
    "Decaid didn't answer",
    "Enter at least the roaster and the coffee's name",
    "The machine isn't connected",
    "Stop the machine before leaving Crema",
    "That favourite's coffee is no longer on the shelf",
    "Set a dose between 5 and 30 g",
    "Try 1/2 a turn finer, and/or a lower dose",
    "boom",
  ])("passes %s through", (msg) => {
    expect(plainError(msg, FB)).toBe(msg);
  });

  it("trims what it passes through", () => {
    expect(plainError("  Too slow  ", FB)).toBe("Too slow");
  });
});
