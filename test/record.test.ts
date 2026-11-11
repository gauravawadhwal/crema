import { describe, expect, it } from "vitest";
import { mergeRecord, recommendPatch, saveBeanPatch } from "../server/control/index.js";

describe("shared record merges", () => {
  it("mergeRecord changes only the patch's fields and ignores undefined", () => {
    const fresh = { bestShotId: "s1", recipe: { dose: 18 }, finished: false };
    expect(mergeRecord(fresh, { finished: true, recipe: undefined })).toEqual({ bestShotId: "s1", recipe: { dose: 18 }, finished: true });
    expect(mergeRecord(null, { a: 1 })).toEqual({ a: 1 });
  });

  it("recommendPatch writes recipe and source; info only if the record has none; the bag only if the record still names the one it started from", () => {
    const info = { name: { value: "Ona" } };
    const same = recommendPatch({ info, batchId: "b1", bestShotId: "s1" }, { recipe: { p: 1 }, source: "rules", info, batchId: "b1" }, { info, batchId: "b1" });
    expect(Object.keys(same).sort()).toEqual(["recipe", "recipeSource"]);
    // info edited elsewhere while this call ran: not written back
    const edited = recommendPatch({ info: { name: { value: "Edited" } }, batchId: "b1" }, { recipe: null, source: "none", info, batchId: "b1" }, { info, batchId: "b1" });
    expect(edited).not.toHaveProperty("info");
    // the bag is switched by this call
    expect(recommendPatch({ info, batchId: "b0" }, { recipe: null, source: "x", info, batchId: "b1" }, { info, batchId: "b0" })).toMatchObject({ batchId: "b1" });
    // the bag was changed elsewhere meanwhile: left alone
    expect(recommendPatch({ info, batchId: "b9" }, { recipe: null, source: "x", info, batchId: "b1" }, { info, batchId: "b0" })).not.toHaveProperty("batchId");
    expect(Object.keys(recommendPatch(null, { recipe: null, source: "rules", info, batchId: null })).sort()).toEqual(["info", "recipe", "recipeSource"]);
  });

  it("recommendPatch merged into a fresh record keeps a pin made elsewhere", () => {
    const info = { name: { value: "Ona" } };
    const fresh = { info, batchId: "b1", bestShotId: "pinned" };
    const merged = mergeRecord(fresh, recommendPatch(fresh, { recipe: { p: 1 }, source: "ai", info, batchId: "b1" }));
    expect(merged.bestShotId).toBe("pinned");
    expect(merged.recipe).toEqual({ p: 1 });
  });

  const add = { info: { n: 1 }, photo: null, productImage: null, art: null, batchId: "b2", now: "2026-11-10T00:00:00Z" };
  it("saveBeanPatch for a known coffee keeps its recipe, pin, photos and first-added time", () => {
    const fresh = { recipe: { p: 1 }, recipeSource: "ai", bestShotId: "pin", photo: "data:x", productImage: "/img", art: "product", addedAt: "2026-01-01", finished: true, batchId: "b1" };
    const out = mergeRecord(fresh, saveBeanPatch(fresh, add));
    // the manufacturer photo outranks the camera photo, which is dropped
    expect(out).toMatchObject({ ...fresh, photo: null, info: add.info, finished: false, batchId: "b2" });
  });
  it("saveBeanPatch for a new coffee starts with empty fields and a default art", () => {
    expect(mergeRecord(null, saveBeanPatch(null, add))).toEqual({
      info: add.info, finished: false, batchId: "b2", recipe: null, recipeSource: null, bestShotId: null, addedAt: add.now, photo: null, productImage: null, art: "photo",
    });
    expect(saveBeanPatch(null, { ...add, productImage: "/p" }).art).toBe("product");
  });
  it("saveBeanPatch takes a new photo and art when given, else keeps the record's", () => {
    const fresh = { photo: "old", art: "photo" };
    expect(saveBeanPatch(fresh, { ...add, photo: "new", art: "product" })).toMatchObject({ photo: "new", art: "product" });
    expect(saveBeanPatch(fresh, add).photo).toBeUndefined();
  });
  it("saveBeanPatch drops the bag photo and uses the product art when a manufacturer photo is present", () => {
    expect(saveBeanPatch(null, { ...add, photo: "data:bag", productImage: "/api/images/x", art: "photo" })).toMatchObject({ photo: null, productImage: "/api/images/x", art: "product" });
    const fresh = { photo: "old", art: "photo", productImage: "/old" };
    expect(saveBeanPatch(fresh, { ...add, photo: "new" })).toMatchObject({ photo: null, art: "product" });
  });
  it("saveBeanPatch keeps the bag photo when there is no manufacturer photo", () => {
    expect(saveBeanPatch(null, { ...add, photo: "data:bag", art: "photo" })).toMatchObject({ photo: "data:bag", art: "photo" });
    expect(saveBeanPatch(null, { ...add, photo: "data:bag" })).toMatchObject({ photo: "data:bag", art: "photo", productImage: null });
  });
});
