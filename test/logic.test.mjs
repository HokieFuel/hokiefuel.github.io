// Tests the recommendation logic embedded in index.html (between LOGIC-START/END markers).
// Usage: node test/logic.test.mjs
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const code = html.slice(html.indexOf("/*LOGIC-START*/"), html.indexOf("/*LOGIC-END*/"));
const ctx = vm.createContext({ Intl, Math, Map, Set, Number, String, Object, Array });
vm.runInContext(code + ";this.L={etNow,openStatus,periodAt,recommend,countOptions,scorePlate,sumPlate,fmtTime};", ctx);
const L = ctx.L;
const at = (h, m = 0) => ({ iso: "2026-11-16", mins: h * 60 + m, hour: h });

/* hours */
const dx = { hours: [{ open: "18:00", close: "02:00" }] };
assert.equal(L.openStatus(dx, 17 * 60).open, false);
assert.equal(L.openStatus(dx, 17 * 60).opensNext, "18:00");
assert.equal(L.openStatus(dx, 23 * 60).open, true);
assert.equal(L.openStatus(dx, 23 * 60).closes, "02:00");
assert.equal(L.openStatus(dx, 60).open, true, "1am still open from last night");
assert.equal(L.openStatus(dx, 3 * 60).open, false);
const d2 = { hours: [{ open: "07:00", close: "10:30" }, { open: "10:30", close: "20:30" }] };
assert.equal(L.openStatus(d2, 12 * 60).closes, "20:30");
assert.equal(L.openStatus(d2, 21 * 60).open, false);
const turner = { hours: [{ open: "07:00", close: "15:00" }, { open: "10:00", close: "21:00" }] };
assert.equal(L.openStatus(turner, 12 * 60).closes, "21:00", "latest close among open units");
assert.equal(L.fmtTime("20:30"), "8:30 PM");
assert.equal(L.fmtTime("00:00"), "12 AM");
assert.equal(L.periodAt(8 * 60), "b"); assert.equal(L.periodAt(12 * 60), "l"); assert.equal(L.periodAt(18 * 60), "d");

/* recommendations on fixture-built data */
const data = JSON.parse(await readFile(new URL("./out-today.json", import.meta.url)));
const lunch = at(12, 30), dinner = at(19);

let r = L.recommend(data, { goal: "protein", hunger: "meal", diet: ["none"], where: "any" }, lunch);
assert.ok(r.plates.length >= 1);
assert.ok(r.plates.every(p => p.loc.name !== "DX"), "DX is closed at lunch (opens 6pm)");
assert.ok(r.plates[0].t.p >= 30, "high-protein pick");
assert.ok(r.plates[0].plate.every(i => i.m.includes("l")), "only lunch items");
assert.ok(r.plates[0].plate.length <= (r.plates[0].steps ? 7 : 3));

r = L.recommend(data, { goal: "train", timing: "after", diet: ["none"], where: "any" }, dinner);
assert.ok(r.plates.every(p => p.status.open));
assert.ok(r.plates[0].t.p >= 25, "recovery plate has real protein");

r = L.recommend(data, { goal: "lean", hunger: "meal", diet: ["vegan"], where: "any" }, dinner);
for (const p of r.plates) for (const i of p.plate) assert.ok(i.v.includes("vegan"), `${i.n} must be vegan`);

r = L.recommend(data, { goal: "protein", hunger: "meal", diet: ["halal"], where: "any" }, lunch);
for (const p of r.plates) for (const i of p.plate) assert.ok(i.v.includes("halal"));

r = L.recommend(data, { goal: "protein", hunger: "meal", diet: ["none"], where: "any" }, at(3));
assert.ok(r.nothingOpen, "3am: nothing open -> flagged");

r = L.recommend(data, { goal: "bulk", hunger: "starving", diet: ["none"], where: "dorms" }, dinner);
assert.ok(r.plates[0].why.some(w => w.includes("Close to you")));

const c = L.countOptions(data, { goal: "protein", diet: ["none"] }, dinner);
assert.ok(c > 0);
assert.ok(L.countOptions(data, { goal: "protein", diet: ["vegan"] }, dinner) < c, "counter shrinks with filters");


/* every plate comes from ONE counter (except all-you-care-to-eat halls) */
const scenarios = [
  [{ goal: "protein", hunger: "meal", diet: ["none"], where: "any" }, at(12, 30)],
  [{ goal: "train", timing: "after", diet: ["none"], where: "any" }, at(12, 30)],
  [{ goal: "bulk", hunger: "starving", diet: ["none"], where: "any" }, at(13)],
  [{ goal: "lean", hunger: "meal", diet: ["vegan"], where: "any" }, at(12)],
];
let turnerSeen = false;
for (const [a, now] of scenarios) {
  for (const p of L.recommend(data, a, now).plates) {
    if (p.loc.mix) continue;
    turnerSeen = true;
    const counters = new Set(p.plate.map(i => i.s));
    assert.equal(counters.size, 1, `plate mixes counters: ${p.plate.map(i => i.n + "@" + i.s).join(", ")}`);
    assert.equal(p.station.name, p.loc.stations[p.plate[0].s].name);
  }
}
assert.ok(turnerSeen, "food-court plates were produced");

r = L.recommend(data, { goal: "protein", hunger: "meal", diet: ["none"], where: "any" }, at(12, 30));
const fire = r.plates.find(p => p.station.name === "Firegrill");
assert.ok(fire, "Firegrill plate exists");
assert.ok(fire.plate.some(i => i.n === "Grilled Chicken Breast"));
assert.ok(fire.plate.every(i => i.n !== "Penne Alfredo" && i.n !== "Jasmine Rice Bowl"), "no items from other Turner counters");
assert.equal(fire.status.closes, "19:30", "uses the Fire Grill's own hours");

r = L.recommend(data, { goal: "bulk", hunger: "starving", diet: ["none"], where: "any" }, at(16));
assert.ok(r.plates.every(p => p.station.name !== "Atomic Pizza"), "Atomic Pizzeria closes 3:30pm");


/* build-your-own: Tazon at Owens */
const tazon = a => L.recommend(data, a, at(12, 30)).plates.find(p => p.station.name === "Tazon");
let tz = tazon({ goal: "protein", hunger: "meal", diet: ["none"], where: "any" });
assert.ok(tz, "Tazon build recommended");
assert.ok(tz.steps, "has ordering steps");
assert.equal(tz.steps.map(s => s.k).join(","), "base,protein,topping");
assert.equal(tz.steps[0].items.length, 1, "exactly one base");
assert.equal(tz.steps[1].items.length, 1, "exactly one protein");
assert.ok(tz.steps[2].items.length <= 4);
assert.ok(["Grilled Chicken", "Carne Asada"].includes(tz.steps[1].items[0].n), "a high-protein protein");
assert.ok(tz.plate.every(i => i.b === 0), "all choices from the Tazon counter");
assert.ok(tz.t.cal >= 450 * .75);
tz = tazon({ goal: "lean", hunger: "meal", diet: ["vegan"], where: "any" });
assert.ok(tz && tz.plate.every(i => i.v.includes("vegan")), "vegan Tazon build");
assert.equal(tz.steps[1].items[0].n, "Sofritas");
tz = tazon({ goal: "lean", hunger: "meal", diet: ["dairyfree"], where: "any" });
assert.ok(tz.plate.every(i => !/Sour Cream|Shredded Cheese/.test(i.n)), "dairy-free skips dairy toppings");
assert.ok(L.recommend(data, { goal: "protein", hunger: "meal", diet: ["none"], where: "any" }, at(12, 30)).plates
  .filter(p => !p.steps).every(p => p.plate.every(i => i.role !== "comp")), "build parts never appear on normal plates");
{ const r2 = L.recommend(data, { goal: "train", timing: "after", diet: ["none"], where: "any" }, at(12, 30));
  const pasta = L.recommend(data, { goal: "train", timing: "before", diet: ["none"], where: "any" }, at(12, 30)).plates.concat(r2.plates).find(p => p.steps && p.station.name === "Rosso");
  if (pasta) assert.ok(pasta.steps.find(s => s.k === "sauce").items.length === 1, "pasta build always has a sauce"); }
console.log("Build-your-own tests passed ✔");

console.log("All logic tests passed ✔");
