import { describe, expect, it } from "vitest";
import { isPlaceholderImage, isSafeUrl, productImageFromHtml } from "../server/images.js";

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

import { withTemperature } from "../server/recommend/local.js";
describe("withTemperature", () => {
  it("shifts every step, keeping the curve", () => {
    const p = withTemperature({ steps: [{ temperature: "83.5" }, { temperature: 83.5 }, { temperature: "67.5" }] }, 86);
    expect((p.steps as { temperature: number }[]).map((s) => s.temperature)).toEqual([86, 86, 70]);
  });
  it("leaves profiles without steps alone", () => {
    expect(withTemperature({ title: "x" }, 90)).toEqual({ title: "x" });
  });
});

describe("isPlaceholderImage", () => {
  it.each([
    "https://roaster.coffee/cdn/shop/t/4/assets/placeholder.jpg",
    "https://shop.coffee/wp-content/uploads/woocommerce-placeholder-600x600.png",
    "https://shop.coffee/img/no-image.png",
    "https://shop.coffee/img/NoImage.jpg",
    "https://shop.coffee/images/image-coming-soon.jpg",
    "https://shop.coffee/default-product.png",
  ])("flags %s", (u) => expect(isPlaceholderImage(u)).toBe(true));
  it.each([
    "https://cdn.shopify.com/s/files/1/0/files/gogogu-250g.jpg?v=1",
    "https://roaster.coffee/products/kii-aa.png",
    "not a url",
  ])("keeps %s", (u) => expect(isPlaceholderImage(u)).toBe(false));
});

describe("withTemperature on a full profile", () => {
  // Hand-written in Decaid's profile shape: limits, exits, sensors, pumps and fields
  // Crema doesn't know must all come back as they went in; only temperatures move.
  const profile = {
    version: "2", title: "Test Lever", author: "Crema tests", notes: "keep me", beverage_type: "espresso",
    target_weight: 36, target_volume: 0, tank_temperature: 0, lang: "en", legacy_profile_type: "settings_2c",
    unknown_future_field: { nested: [1, 2, 3] },
    steps: [
      { name: "fill", temperature: "88.0", sensor: "coffee", pump: "flow", transition: "fast", pressure: "0", flow: "8", seconds: "25", volume: "100",
        exit: { type: "pressure", condition: "over", value: "4" }, limiter: { value: "1", range: "0.6" } },
      { name: "hold", temperature: 90.5, sensor: "water", pump: "pressure", transition: "smooth", pressure: 8.6, seconds: 10, weight: 0 },
      { name: "decline", temperature: 86, sensor: "coffee", pump: "pressure", transition: "smooth", pressure: 6, seconds: 30,
        exit: { type: "flow", condition: "under", value: 1.5 }, limiter: { value: 2.5, range: 0.6 } },
    ],
  };
  it("shifts every step's temperature by the same amount", () => {
    const out = withTemperature(profile, 92) as typeof profile;
    expect(out.steps.map((st) => Number(st.temperature))).toEqual([92, 94.5, 90]);
  });
  it("leaves every other field, nested or unknown, exactly as it was", () => {
    const out = withTemperature(profile, 92) as typeof profile;
    const strip = (p: typeof profile) => ({ ...p, steps: p.steps.map(({ temperature, ...rest }) => rest) });
    expect(strip(out)).toEqual(strip(profile));
    expect(profile.steps[0].temperature).toBe("88.0"); // the input isn't changed
  });
  it("is a no-op at the same temperature", () => {
    expect((withTemperature(profile, 88) as typeof profile).steps.map((st) => Number(st.temperature))).toEqual([88, 90.5, 86]);
  });
});
