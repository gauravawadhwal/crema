import { describe, expect, it } from "vitest";
import { isSafeUrl, productImageFromHtml } from "../server/images.js";

const page = "https://roaster.coffee/products/kii-aa";

describe("productImageFromHtml", () => {
  it("reads Open Graph images, resolving relative URLs", () => {
    const html = `<head><meta property="og:image" content="//cdn.shop.coffee/files/kii.jpg?v=1&amp;w=1200"></head>`;
    expect(productImageFromHtml(html, page)).toBe("https://cdn.shop.coffee/files/kii.jpg?v=1&w=1200");
  });

  it("handles content-before-property attribute order and twitter cards", () => {
    expect(productImageFromHtml(`<meta content="https://a.coffee/x.png" name="twitter:image">`, page)).toBe("https://a.coffee/x.png");
  });

  it("prefers the JSON-LD Product image over a generic share image", () => {
    const html = `<meta property="og:image" content="https://a.coffee/logo.png">
      <script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"Product","name":"Kii","image":[{"url":"https://a.coffee/kii-bag.jpg"}]}]}</script>`;
    expect(productImageFromHtml(html, page)).toBe("https://a.coffee/kii-bag.jpg");
  });

  it("returns null when there is no image", () => {
    expect(productImageFromHtml("<html><body>hi</body></html>", page)).toBeNull();
  });
});

describe("isSafeUrl", () => {
  it("allows public https", () => expect(isSafeUrl("https://cdn.shopify.com/a.jpg")).toBe(true));
  it.each(["http://localhost/x", "http://192.168.1.4/x", "http://10.0.0.2/x", "file:///etc/passwd", "http://tablet.local/x", "https://roaster.example/x", "http://[::1]/x"])(
    "blocks %s",
    (u) => expect(isSafeUrl(u)).toBe(false),
  );
});

import { withTemperature } from "../server/app.js";
describe("withTemperature", () => {
  it("shifts every step, keeping the curve", () => {
    const p = withTemperature({ steps: [{ temperature: "83.5" }, { temperature: 83.5 }, { temperature: "67.5" }] }, 86);
    expect((p.steps as { temperature: number }[]).map((s) => s.temperature)).toEqual([86, 86, 70]);
  });
  it("leaves profiles without steps alone", () => {
    expect(withTemperature({ title: "x" }, 90)).toEqual({ title: "x" });
  });
});
