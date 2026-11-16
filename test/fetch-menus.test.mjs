// Runs the real fetcher against a mocked fetch() serving VT-shaped fixture data.
// Usage: node test/fetch-menus.test.mjs
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { run, mealToPeriods, classify } from "../scripts/fetch-menus.mjs";

const fx = JSON.parse(await readFile(new URL("./fixture.json", import.meta.url)));
const nutByKey = new Map(fx.nutrition.map(r => [`${r.id}*${r.portionSize}`, r]));
const requested = [];

globalThis.fetch = async (url) => {
  requested.push(url);
  const u = new URL(url);
  const ok = body => ({ ok: true, status: 200, json: async () => body });
  if (u.pathname.endsWith("Locations.aspx")) return ok(fx.locations);
  if (u.pathname.endsWith("MenuAtLocation.aspx")) return ok(fx.menus[u.searchParams.get("locationNum")]);
  if (u.pathname.endsWith("NutritiveReport.aspx")) {
    const recipes = u.searchParams.get("items").split(",").map(s => {
      const [id, por] = s.split("*"); const r = nutByKey.get(`${id}*${por}`);
      return r && { id, portionSize: por, nutrients: Object.entries(r.n).map(([name, value]) => ({ name, value })) };
    }).filter(Boolean);
    return ok({ recipes });
  }
  if (u.hostname === "apps.students.vt.edu") return ok(fx.hours[u.pathname.split("/").at(-2)]);
  return { ok: false, status: 404, json: async () => ({}) };
};

const out = await run({ outFile: new URL("./out-today.json", import.meta.url).pathname });
const loc = n => out.locations.find(l => l.num === n);
const item = (l, name) => loc(l).items.find(i => i.n === name);

// unit checks
assert.equal(mealToPeriods("Lunch/Dinner"), "ld");
assert.equal(mealToPeriods("Lunch & Dinner"), "ld");
assert.equal(mealToPeriods("Daily Items"), "bld");
assert.equal(classify("Chicken Pot Pie", "Entrees", 450, 18), "main");
assert.equal(classify("Buttermilk Pancakes", "Breakfast", 320, 8), "main");

// fraction portions must round-trip ("4 3/4" and "1/2")
assert.equal(item("71", "French Fries").cal, 192);
assert.equal(item("15", "Oatmeal").por, "1/2 cup");
assert.ok(requested.some(u => decodeURIComponent(u).includes("161151*4 3/4*1")), "fraction portion sent as-is");

// roles
assert.equal(item("71", "Chicken Parm Wrap").role, "main");
assert.equal(item("71", "French Fries").role, "side");
assert.equal(item("15", "Chicken Pot Pie").role, "main");
assert.equal(item("15", "Chocolate Chip Cookie").role, "dessert");
assert.equal(item("15", "Chocolate Milk").role, "drink+");
assert.equal(item("15", "Ranch Dressing"), undefined, "condiments dropped");
assert.equal(item("15", "Beer Battered Fish"), undefined, "alcohol dropped");

// diet flags
assert.deepEqual(item("71", "French Fries").v.sort(), ["dairyfree", "nutfree", "vegan", "vegetarian"]);
assert.ok(item("15", "Grilled Chicken Breast").v.includes("halal"));
assert.ok(!item("15", "Chocolate Chip Cookie").v.includes("nutfree"));
assert.ok(item("15", "Oatmeal").v.includes("glutenfree"));

// periods merged across meals
assert.equal(item("15", "Grilled Chicken Breast").m, "ld");
assert.equal(item("15", "Scrambled Eggs").m, "b");

// hours
assert.deepEqual(loc("71").hours[0], { unit: "Dietrick - DX", label: "Regular Hours", open: "18:00", close: "02:00", title: "6:00 PM - 2:00 AM" });
assert.equal(loc("15").name, "D2 at Dietrick");
assert.equal(loc("15").area, "dorms");

console.log("\nAll fetcher tests passed ✔");

// classification edge cases seen in real VT data (Nov 2026)
const C = (n, s, cal, p = 0) => classify(n, s, cal, p);
assert.equal(C("White Chocolate Passion Fruit Gelato", "Dolci e Caffe: Gelato and Sorbettos", 346, 5), "dessert");
assert.equal(C("Ice Milk Soft Serve Vanilla", "Soft Serve Ice Cream and Toppings", 150, 4), "dessert");
assert.equal(C("Milk, Skim", "Beverages", 90, 8), "drink+");
assert.equal(C("Biscuit", "Gauchos Breakfast", 263, 5), "side");
assert.equal(C("Croissant", "Corner BYO Bread Options", 251, 5), "side");
assert.equal(C("Fresh Banana", "La Patisserie Fruit and Cups", 105, 1), "side");
assert.equal(C("Blush Sauce", "Rosso Sauce", 222, 3), "condiment");
assert.equal(C("Whipped Topping", "Soft Serve Ice Cream and Toppings", 50), "condiment");
assert.equal(C("Grilled Chicken Sandwich", "Grill", 442, 47), "main");
assert.equal(C("Egg & Cheese Bagel", "Breakfast", 420, 20), "main");
assert.equal(C("Cherry Fritter", "Bakery", 380, 4), "dessert");
console.log("Classification edge cases passed ✔");
assert.equal(C("Extra Turkey Breast", "Deli", 76, 17), "condiment");
assert.equal(C("Grilled Chicken Patty Add On", "B37 BYO Protein Options", 213, 30), "condiment");
assert.equal(C("Parmesan Cheese", "Toppings", 110, 10), "condiment");
assert.equal(C("Peach Mango Refresher Large", "Drinks", 277, 0), "drink");
assert.equal(C("Steamed Rice", "Wok", 481, 9), "side");
assert.equal(C("French Fries", "Grill", 400, 4), "side");
assert.equal(C("Fried Rice with Chicken", "Wok", 520, 22), "main");
console.log("Add-on / drink / starch rules passed ✔");
assert.equal(C("Southwest Chorizo Bowl", "Bowls", 220, 9), "main");
assert.equal(C("Rice Noodles", "Pho", 408, 9), "side");
assert.equal(C("Plain Tortilla for Wraps and Burritos", "Deli", 300, 8), "side");
console.log("Bowl / noodle / tortilla rules passed ✔");
assert.equal(C("Hot Macchiato Large", "Cafe", 180, 6), "drink");
assert.equal(C("Orange Gelatin", "Desserts", 80, 2), "dessert");
assert.equal(C("Shredded Mozzarella", "Deli", 80, 6), "condiment");
console.log("Drink / dessert / topping rules passed ✔");

// ---- stations (section names copied from real VT menus, Nov 2026) ----
import { stationNames, stationHours } from "../scripts/fetch-menus.mjs";
const SN = list => Object.fromEntries(stationNames(list));
const turner = SN(["Breakfast Hot Items","Blue Plate Special","Firegrill Southern Comfort","Firegrill Grillside Sides","Firegrill Grilled Meat and Seafood","Origami Grill","Sushi","Atomic Pizza: Pizza","Atomic Pizza: Pastas and Sauces","Soup Garden: Salads","Dolci e Caffe Pastries","Dolci e Caffe: Daily Crepe"]);
assert.equal(turner["Firegrill Grillside Sides"], "Firegrill");
assert.equal(turner["Atomic Pizza: Pastas and Sauces"], "Atomic Pizza");
assert.equal(turner["Dolci e Caffe Pastries"], "Dolci e Caffe");
assert.equal(turner["Sushi"], "Sushi");
assert.equal(turner["Blue Plate Special"], "Blue Plate Special");
const west = SN(["Rosso Pasta","Rosso Sauce","Leaf & Ladle Soups","Leaf & Ladle Salads","JP's Chop Shop Entrees","JP's Chop Shop Sides","JP's Chop Shop Lunch Special (availabile until 4 pm)","Fighting Gobbler Burgers & Sandwiches","Fighting Gobbler","Seven 70 Quesadillas"]);
assert.equal(west["JP's Chop Shop Sides"], "JP's Chop Shop");
assert.equal(west["Leaf & Ladle Salads"], "Leaf & Ladle");
assert.equal(west["Fighting Gobbler"], "Fighting Gobbler");
assert.equal(west["Rosso Sauce"], "Rosso");
const owens = SN(["Tazon - Protein","Tazon - Bases","Wan - Sides/Extras","Garden - Salad Bar"]);
assert.equal(owens["Wan - Sides/Extras"], "Wan");
const H = [
  { unit: "Turner Place - 1872 Fire Grill", open: "10:30", close: "19:30" },
  { unit: "Turner Place - Atomic Pizzeria", open: "10:00", close: "15:30" },
  { unit: "Turner Place - Origami: Sushi", open: "11:00", close: "18:00" },
  { unit: "Turner Place - Soup Garden", open: "10:30", close: "19:00" },
];
assert.equal(stationHours("Firegrill", H)[0].close, "19:30");
assert.equal(stationHours("Atomic Pizza", H)[0].close, "15:30");
assert.equal(stationHours("Sushi", H)[0].close, "18:00");
assert.equal(stationHours("Blue Plate Special", H).length, 0, "no match -> falls back to hall hours");
// in the fixture, D2 is an all-you-care-to-eat hall (mix), so it has one station
assert.equal(loc("15").mix, true);
assert.equal(loc("15").stations.length, 1);
console.log("Station grouping + per-station hours passed ✔");

// ---- build-your-own detection (real VT section names) ----
import { componentOf, findBuilds } from "../scripts/fetch-menus.mjs";
assert.deepEqual(componentOf("Tazon - Bases", "Tazon"), { k: "base", build: "Tazon" });
assert.deepEqual(componentOf("Tazon - Protein", "Tazon"), { k: "protein", build: "Tazon" });
assert.deepEqual(componentOf("Rambutan Pho Broth", "Rambutan"), { k: "broth", build: "Rambutan Pho" });
assert.deepEqual(componentOf("Rambutan Proteins", "Rambutan"), { k: "protein", build: "Rambutan" });
assert.deepEqual(componentOf("Corner BYO Bread Options", "Corner"), { k: "bread", build: "Corner Build-your-own" });
assert.deepEqual(componentOf("B37 BYO Bun Options", "B37"), { k: "bread", build: "B37 Build-your-own" });
assert.deepEqual(componentOf("Ciotola - Pastas", "Ciotola"), { k: "base", build: "Ciotola" });
assert.equal(componentOf("Wan - Entrees", "Wan"), null);
const allSecs = {
  owens: ["Tazon - Protein","Tazon - Bases","Tazon - Toppings","Variabowl - Proteins","Variabowl - Bases","Variabowl - Toppings","Wan - Entrees","Wan - Bases","Wan - Sides/Extras","Ciotola - Entrees","Ciotola - Pastas","Ciotola - Sauces","Garden - Salad Bar","Garden - Toppings"],
  perry: ["Smoke Tacos","Smoke Proteins","Smoke Toppings & Sauces","Rambutan Bases","Rambutan Proteins","Rambutan Toppings","Rambutan Sauces","Rambutan Pho Broth","Rambutan Pho Proteins","Rambutan Pho Toppings","Fresh & Feta Bases","Fresh & Feta Proteins","Fresh & Feta Toppings","Fresh & Feta Breads","Veloce Pasta","Veloce Proteins","Veloce Sauces","Veloce Toppings","Solarex Waffles and Toppings"],
  squires: ["Corner BYO Bread Options","Corner BYO Protein Options","Corner BYO Cheese Options","Corner BYO Sauce Options","Corner BYO Toppings","Corner Salads","Corner Salad Proteins","B37 Signature Burgers","B37 BYO Bun Options","B37 BYO Protein Options","B37 BYO Cheese Options","B37 BYO Toppings"],
  west: ["Rosso Pasta","Rosso Sauce","Leaf & Ladle Salad Toppings","Leaf & Ladle Salad Proteins","Leaf & Ladle Salads","Leaf & Ladle Salad Dressings"],
};
const B = list => [...findBuilds(list, x => stationNames(list).get(x))].sort();
assert.deepEqual(B(allSecs.owens), ["Ciotola", "Tazon", "Variabowl"]);
assert.deepEqual(B(allSecs.perry), ["Fresh & Feta", "Rambutan", "Rambutan Pho", "Veloce"]);
assert.deepEqual(B(allSecs.squires), ["B37 Build-your-own", "Corner Build-your-own"]);
assert.deepEqual(B(allSecs.west), ["Rosso"]);
console.log("Build-your-own detection passed ✔");
assert.equal(C("Orange Chicken", "Wan - Entrees", 520, 18), "main");
console.log("Orange chicken is not fruit ✔");

assert.deepEqual(B(["Mangia Pizza","Mangia Breads","Mangia Pasta","Mangia Special"]), [], "pasta + bread alone is not build-your-own");
assert.equal(C("Cilantro-Lime Rice", "Smoke Sides", 300, 5), "side");
console.log("Build validity + starch fixes passed ✔");

{ const we = loc("16");
  assert.equal(item("16", "Chicken Parm").role, "main", "a finished dish in a pasta section isn't a base");
  assert.equal(item("16", "Penne Pasta").k, "base");
  assert.equal(item("16", "Extra Grilled Chicken"), undefined, "Extra duplicate dropped");
  assert.equal(item("16", "Grilled Chicken").k, "protein");
  assert.equal(we.builds[item("16", "Penne Pasta").b].pasta, true);
  assert.equal(item("16", "Raisin Bran").m, "b", "cereal only at breakfast");
  console.log("Pasta / extras / cereal fixes passed ✔"); }
