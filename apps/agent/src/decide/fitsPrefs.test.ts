import { describe, expect, it } from "vitest";
import { compose } from "./compose";
import { fitsPrefs } from "./fitsPrefs";
import { dinner, PLAN, prefs, show } from "./testkit";

describe("fitsPrefs", () => {
  const bundles = compose(
    [dinner("Vegan Place", { dietary: ["vegan", "vegetarian"] }), dinner("Steakhouse"), show("Early", { end: "21:45" }), show("Late", { start: "21:00", end: "22:45" })],
    PLAN,
  );
  const names = (bs: typeof bundles) => bs.map((b) => `${b.dinner.data.name}+${b.show.data.name}`).sort();

  it("a vegan member drops a non-vegan dinner", () => {
    expect(names(fitsPrefs(bundles, [prefs(), prefs({ dietary: ["vegan"] })]))).toEqual(["Vegan Place+Early", "Vegan Place+Late"]);
  });

  it("latest_end drops shows ending later (equality kept)", () => {
    expect(names(fitsPrefs(bundles, [prefs({ latest_end: "22:00" })]))).toEqual(["Steakhouse+Early", "Vegan Place+Early"]);
    expect(fitsPrefs(bundles, [prefs({ latest_end: "22:45" })])).toHaveLength(4);
  });

  it("latest_end after midnight is later than an evening show end", () => {
    expect(fitsPrefs(bundles, [prefs({ latest_end: "00:30" })])).toHaveLength(4);
  });

  it("earliest_start after the plan start drops everything", () => {
    expect(fitsPrefs(bundles, [prefs({ earliest_start: "18:00" })])).toHaveLength(4);
    expect(fitsPrefs(bundles, [prefs({ earliest_start: "19:00" })])).toHaveLength(0);
  });
});
