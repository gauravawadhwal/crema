/**
 * Whether an error's own text is fit to show. Browsers, Decaid and the Crema server
 * put status codes, URLs, file paths, exception names, JSON and provider ids into
 * `error.message`. Those are for the console, not for someone at the machine. Pure;
 * the app (skin/app.js `failText`) picks the fallback sentence for the action.
 */

const PATTERNS: RegExp[] = [
  // HTTP: a verb with a path, the word HTTP, "status 500", or a bare code leading the message.
  /\b(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+[/h]/,
  /\bHTTP\b/i,
  /\bstatus(?:\s+code)?[\s:=]+[1-5]\d\d\b/i,
  /^\s*[1-5]\d\d\b/,
  /\b[1-5]\d\d\s*(?::|-|\(|error\b|bad\b|not\b|internal\b|service\b|unauthorized\b|forbidden\b|gateway\b)/i,
  // URLs and addresses.
  /\b(?:https?|wss?):\/\//i,
  /\blocalhost\b/i,
  /\b\d{1,3}(?:\.\d{1,3}){3}\b/,
  // File paths, including an API route.
  /(?:^|[\s"'(=:])(?:\.{1,2}\/|~\/|\/)[A-Za-z0-9_.@-]+(?:\/[A-Za-z0-9_.@-]*)*(?=$|[\s"'),:;?])/,
  /\b[A-Za-z]:\\/,
  /\bnode_modules\b|\.(?:ts|js|mjs|cjs|json)(?::\d+)+\b/,
  // Exceptions and stack fragments.
  /\b[A-Za-z]*(?:Error|Exception)\s*[:(]/,
  /\b(?:TypeError|SyntaxError|RangeError|ReferenceError|AbortError|ZodError|DOMException|NetworkError|TimeoutError|ECONN[A-Z]*|ENOTFOUND|ETIMEDOUT)\b/,
  /^\s*at\s+\S+.*[(:]/m,
  /\bUnexpected (?:token|end of)\b|\bis not a function\b|\bis not defined\b|\bCannot read propert|\bof undefined\b|\bof null\b|\[object \w+\]/i,
  // JSON.
  /^\s*[{[]/,
  /[{[]\s*"[^"]*"\s*:/,
  // Provider ids.
  /\b(?:claude-cli|codex-cli|gemini-api|anthropic-api)\b/i,
  /\bmock\b/i,
];

/** Messages longer than this are never a one-line sentence for the screen. */
const MAX_PLAIN = 220;

/** The message if it reads as a plain sentence, else `fallback`. */
export function plainError(message: unknown, fallback: string): string {
  const m = String(message ?? "").trim();
  if (!m || m.length > MAX_PLAIN) return fallback;
  return PATTERNS.some((re) => re.test(m)) ? fallback : m;
}
