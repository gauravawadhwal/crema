import type { ImageInput } from "./llm/types.js";
import type { ProviderChain } from "./llm/index.js";
import { BeanInfo } from "./schema.js";

export interface IdentifyInput {
  /** Photos of the bag: front, back, the roast-date sticker. */
  images?: ImageInput[];
  /** Free text, e.g. "Square Mile Red Brick" or a barcode number. */
  query?: string;
  /**
   * The user describing the bag in their hand, typed or dictated, e.g.
   * "ONA La Fincona, roasted on the 2nd, 250 grams". May carry speech-to-text errors.
   */
  description?: string;
  /** Today's date (YYYY-MM-DD) for resolving "roasted last Tuesday". Defaults to the server's date. */
  today?: string;
  /** A roaster product page. */
  url?: string;
  /** Skip the web lookup (faster, bag-only facts). */
  offline?: boolean;
}

const SYSTEM = `You identify specialty coffees for a home espresso setup and return a structured record.

Use two kinds of evidence:
1. THE BAG (photos, if given). This is the only source for lot-specific facts: the roast date (often a handwritten or stamped sticker, and easy to confuse with a best-before date), lot or batch numbers, the bag weight, and any recipe printed on it. Mark these source="bag".
2. THE ROASTER'S OWN PRODUCT PAGE (if you can search the web). Find the exact product the bag or query refers to, preferring the roaster's own site over retailers. Use it to fill in origin, producer, variety, process, altitude, tasting notes, roast level, what the roast is for (espresso/filter/omni), and any espresso recipe they recommend. Mark these source="web" and list every URL you used in sources.

Rules:
- When the bag and the website disagree on a lot fact, trust the bag. The website may describe a newer or older lot.
- Use source="inferred" only for things you reasoned out, e.g. a roast level judged from the bean colour in a photo or from the words "omni roast". Put those field names in needsConfirmation.
- Never make up a roast date. If you can't read one, set it to null and add "roastDate" to needsConfirmation.
- Dates are ISO YYYY-MM-DD. When a printed date is ambiguous (03/04), assume the roaster's country's date format and flag it.
- processKind is a normalized bucket; process keeps the roaster's own wording (e.g. "Anaerobic natural, 72h").
- confidence reflects how sure you are that you found the right coffee, not how complete the record is.
- productUrl: the roaster's own product page for this coffee, if you found it.
- imageUrl: the direct URL of the roaster's main product photo (the packshot), only if you actually saw it on the page; otherwise null.
- summary: one or two plain sentences on how the coffee will taste as espresso.

When the user describes the bag in their own words (often dictated, so expect speech-to-text errors):
- Lot facts they say they read off the bag (roast date, bag weight, lot, a printed recipe) count as source="bag".
- Names may be misheard or spelt by sound ("on a coffee" for ONA, "square mile red brick" for Square Mile Red Brick). Match them to a real roaster and coffee that sound alike, and lower confidence if you had to guess.
- Resolve relative dates ("roasted last Tuesday", "about two weeks ago", "the 2nd") against today's date, never to a date after today. Add "roastDate" to needsConfirmation unless they gave a full date.
- Ignore filler, false starts and corrections ("no, sorry, I mean"); the last version they said wins.`;

export async function identify(llm: ProviderChain, input: IdentifyInput): Promise<BeanInfo> {
  if (!input.images?.length && !input.query && !input.description && !input.url) {
    throw new Error("provide at least one of images, query, description or url");
  }
  const parts: string[] = [];
  if (input.images?.length) parts.push(`I've attached ${input.images.length} photo(s) of a coffee bag I own.`);
  if (input.query) parts.push(`The coffee: "${input.query}".`);
  if (input.description) {
    parts.push(`Today is ${input.today ?? new Date().toISOString().slice(0, 10)}.`);
    parts.push(`How I describe the bag (may be dictated): """${input.description}"""`);
  }
  if (input.url) parts.push(`The product page: ${input.url}`);
  parts.push(
    input.offline
      ? "Don't search the web. Record only what you can see or confidently know."
      : "Look up the roaster's product page and fill in the rest.",
  );
  parts.push("Return the BeanInfo record.");

  const info = await llm.structured({
    system: SYSTEM,
    prompt: parts.join("\n"),
    schema: BeanInfo,
    schemaName: "BeanInfo",
    images: input.images,
    web: !input.offline,
  });
  return resolveGroundingLinks(info);
}

const GROUNDING_HOST = "vertexaisearch.cloud.google.com";

/**
 * Gemini's Google Search grounding cites pages through short-lived redirect
 * links on vertexaisearch.cloud.google.com rather than the pages themselves.
 * Follow each one (that host only) to the real address, so the review shows
 * the roaster's page and the links still work later. Links that don't resolve
 * are dropped.
 */
export async function resolveGroundingLinks(info: BeanInfo): Promise<BeanInfo> {
  const isGrounding = (u: string | null) => {
    try { return !!u && new URL(u).hostname === GROUNDING_HOST; } catch { return false; }
  };
  const resolve = async (u: string): Promise<string | null> => {
    try {
      const res = await fetch(u, { redirect: "manual", signal: AbortSignal.timeout(4000) });
      const to = res.headers.get("location");
      return to && /^https?:\/\//.test(to) && !isGrounding(to) ? to : null;
    } catch {
      return null;
    }
  };
  const links = [...new Set([...info.sources, info.productUrl, info.imageUrl].filter(isGrounding))] as string[];
  if (!links.length) return info;
  const real = new Map(await Promise.all(links.map(async (u) => [u, await resolve(u)] as const)));
  const fix = (u: string | null) => (isGrounding(u) ? real.get(u!) ?? null : u);
  return {
    ...info,
    sources: [...new Set(info.sources.map(fix).filter((u): u is string => !!u))],
    productUrl: fix(info.productUrl),
    imageUrl: fix(info.imageUrl),
  };
}
