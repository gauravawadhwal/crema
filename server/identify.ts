import type { ImageInput } from "./llm/types.js";
import type { ProviderChain } from "./llm/index.js";
import { BeanInfo } from "./schema.js";

export interface IdentifyInput {
  /** Photos of the bag: front, back, the roast-date sticker. */
  images?: ImageInput[];
  /** Free text, e.g. "Square Mile Red Brick" or a barcode number. */
  query?: string;
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
- summary: one or two plain sentences on how the coffee will taste as espresso.`;

export async function identify(llm: ProviderChain, input: IdentifyInput): Promise<BeanInfo> {
  if (!input.images?.length && !input.query && !input.url) {
    throw new Error("provide at least one of images, query or url");
  }
  const parts: string[] = [];
  if (input.images?.length) parts.push(`I've attached ${input.images.length} photo(s) of a coffee bag I own.`);
  if (input.query) parts.push(`The coffee: "${input.query}".`);
  if (input.url) parts.push(`The product page: ${input.url}`);
  parts.push(
    input.offline
      ? "Don't search the web. Record only what you can see or confidently know."
      : "Look up the roaster's product page and fill in the rest.",
  );
  parts.push("Return the BeanInfo record.");

  return llm.structured({
    system: SYSTEM,
    prompt: parts.join("\n"),
    schema: BeanInfo,
    schemaName: "BeanInfo",
    images: input.images,
    web: !input.offline,
  });
}
