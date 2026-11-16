#!/usr/bin/env node
/**
 * Hokie Fuel – menu fetcher
 * -------------------------
 * Pulls today's menus, nutrition and hours for every Virginia Tech dining
 * location and writes one compact file: data/today.json
 *
 * Data sources (the same public endpoints the official menu site uses):
 *   Locations : https://foodpro.students.vt.edu/menus/API/Locations.aspx
 *   Menu      : .../MenuAtLocation.aspx?locationNum=15&dtdate=11/16/2026
 *   Nutrition : .../NutritiveReport.aspx?items=<recipeId>*<portion>*1,...
 *   Hours     : https://apps.students.vt.edu/hours/Api/NonRestricted/FoodProCentersOpen/readByFoodPro/15/2026-11-16
 *
 * Run locally:   node scripts/fetch-menus.mjs
 * Requires Node 18+ (uses built-in fetch). No npm packages needed.
 */
import { writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const MENU_API = "https://foodpro.students.vt.edu/menus/API";
const HOURS_API = "https://apps.students.vt.edu/hours/Api/NonRestricted/FoodProCentersOpen/readByFoodPro";
const BATCH = 100;          // recipes per nutrition request
const PAUSE_MS = Number(process.env.PAUSE_MS ?? 400);       // be polite to VT's servers between requests

/* Friendly names + rough campus area for each locationNum. Edit freely.
   mix: true  -> one counter / all-you-care-to-eat, so a plate may combine items from any station.
   otherwise  -> food court of separate restaurants; every plate comes from ONE restaurant. */
export const LOCATION_INFO = {
  "15": { short: "D2 at Dietrick", area: "dorms", mix: true },
  "72": { short: "Deet's Place", area: "dorms", mix: true },
  "71": { short: "DX", area: "dorms", mix: true },
  "39": { short: "Owens Food Court", area: "dorms" },
  "09": { short: "Hokie Grill", area: "dorms" },
  "16": { short: "West End", area: "dorms" },
  "18": { short: "Squires Food Court", area: "academic" },
  "06": { short: "Perry Place", area: "academic" },
  "14": { short: "Turner Place", area: "academic" },
  "19": { short: "Viva Market", area: "academic", mix: true },
  "01": { short: "Ducky's at GLC", area: "academic", mix: true },
  "07": { short: "Xpress Lane Market", area: "other", mix: true },
};

/* ---------------- helpers ---------------- */
export function easternDate(d = new Date()) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" })
      .formatToParts(d).map(x => [x.type, x.value]));
  return { iso: `${p.year}-${p.month}-${p.day}`, us: `${p.month}/${p.day}/${p.year}` };
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function getJSON(url, tries = 3) {
  for (let i = 1; i <= tries; i++) {
    try {
      const r = await fetch(url, { headers: { "User-Agent": "HokieFuel/1.0 (student project)", Accept: "application/json" } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } catch (e) {
      if (i === tries) throw new Error(`${url} -> ${e.message}`);
      await sleep(1000 * i);
    }
  }
}

const num = v => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };

/** "Breakfast" -> "b", "Lunch/Dinner" -> "ld", "Daily Items" -> "bld" */
export function mealToPeriods(meal) {
  const m = meal.toLowerCase();
  let out = "";
  if (m.includes("breakfast") || m.includes("brunch")) out += "b";
  if (m.includes("lunch") || m.includes("brunch")) out += "l";
  if (m.includes("dinner")) out += "d";
  return out || "bld"; // "Daily Items", "All Day", etc.
}

/** Decide what kind of item this is so the app can build sensible plates. */
export function classify(name, section, cal, protein) {
  const n = name.toLowerCase(), s = section.toLowerCase();
  if (/whipped topping|sprinkles/.test(n)) return "condiment";
  if (/gelato|sorbet|soft serve|ice cream|frozen yogurt|milkshake|gelatin|jello|pudding/.test(n)) return "dessert";
  // add-ons & toppings from build-your-own stations aren't a meal on their own
  if (/^(extra|add[- ]?on|side of)\b|\badd[- ]?ons?\b|crumbles|shredded cheese|^shredded (mozzarella|cheddar|parmesan|monterey)|parmesan|\bfeta\b|sliced cheese|cheese slice|^(american|cheddar|swiss|provolone|pepper jack|mozzarella|monterey jack[^,]*) cheese$|^avocado$|guacamole|sour cream|^bacon$/.test(n))
    return "condiment";
  if (/beverage|drinks?\b|coffee|juice bar/.test(s) ||
      /\b(coffee|juice|soda|lemonade|tea|water|latte|milk|smoothie|shake|refresher|frappe|frappuccino|cold brew|chai|boba|slush|slushie|agua fresca|cappuccino|espresso|mocha|americano|kombucha|macchiato|hot chocolate|cocoa)\b/.test(n))
    return /milk|smoothie|shake|protein/.test(n) && cal >= 80 ? "drink+" : "drink";
  if ((/condiment|dressing|toppings?\b|syrups?|sauces?\b|spreads?/.test(s) && cal < 300) ||
      (/(dressing|sauce|syrup|ketchup|mustard|mayo|jelly|jam|cream cheese|gravy|seasoning|croutons?|vinaigrette|honey|butter)$/.test(n) && cal < 300))
    return "condiment";
  // fruit is a side even when it's sold at the bakery counter
  if (/\b(fresh |whole )?(fruit|banana|apple|orange|berries|melon|grapes|pineapple|fruit cup)s?\b/.test(n) && !/pie|cake|crisp|cobbler|danish|muffin|bread/.test(n) && cal < 250)
    return "side";
  const savory = /pot pie|shepherd|crab cake|fish cake|salmon cake|corn ?bread|pizza/.test(n);
  if (!savory && (/patisserie|dessert|\bcakes?\b|cookies?|brownies?|cobbler|bakery|sweets|donuts?|pastr/.test(s) ||
      /\b(cookie|brownie|cake|cupcake|pie|donut|doughnut|cobbler|muffin|cinnamon roll|cinnamon bun|danish|cheesecake|fritter|munchkin)s?\b/.test(n)))
    return /croissant|bagel|biscuit/.test(n) ? "side" : "dessert";
  // plain breads are sides, not meals (but sandwiches, wraps, pizza etc. are mains)
  if (/\b(biscuit|bagel|toast|bread|roll|croissant|pita|baguette|ciabatta|tortilla|english muffin|naan|bun)s?\b/.test(n) &&
      !/sandwich|wrap|burger|pizza|melt|panini|sub\b|club|egg|chicken|turkey|ham|bacon|sausage|steak|tuna|salmon|tofu|blt/.test(n))
    return "side";
  // plain starches are sides even in big portions
  if (/^((steamed|jasmine|brown|white|fried|yellow|cilantro[- ]lime|basmati|coconut|spanish|mexican) )?rice$|french fries|tater tots|mashed potatoes|hash ?browns|home fries|^(plain )?((rice|egg|lo mein|udon|soba) )?(noodles|pasta|penne|spaghetti|rigatoni|fettuccine)$|^plain |tortilla for/.test(n))
    return "side";
  if (/\b(bowl|plate|sandwich|wrap|burrito|entree|quesadilla|taco|platter)s?\b/.test(n) && cal >= 150) return "main";
  if (cal >= 250 || protein >= 15) return "main";
  if (cal >= 40) return "side";
  return "condiment";
}

/** Diet flags from VT's legend icons + allergen statement. */
export function dietFlags(legendImages, allergens) {
  const a = (allergens || "").toLowerCase();
  const f = new Set(legendImages.filter(x => ["vegan", "vegetarian", "halal"].includes(x)));
  if (f.has("vegan")) f.add("vegetarian");
  if (!/wheat|gluten/.test(a)) f.add("glutenfree");
  if (!/milk/.test(a)) f.add("dairyfree");
  if (!/peanut|tree nut/.test(a)) f.add("nutfree");
  return [...f];
}

const hhmm = t => (t || "").slice(0, 5); // "07:00:01" -> "07:00"

export function parseHours(hoursJson) {
  const out = [];
  for (const unit of Array.isArray(hoursJson) ? hoursJson : [])
    for (const h of unit.hours || [])
      out.push({ unit: (unit.name || "").trim(), label: h.label, open: hhmm(h.open_time), close: hhmm(h.close_time), title: h.title });
  return out;
}

/**
 * Work out which restaurant/counter each menu section belongs to.
 *   "Wan - Entrees" / "Atomic Pizza: Pizza"         -> "Wan" / "Atomic Pizza"
 *   "JP's Chop Shop Entrees" + "JP's Chop Shop Sides" -> "JP's Chop Shop"  (shared leading words)
 *   "Sushi" (nothing else starts with "Sushi")       -> "Sushi"
 */
export function stationNames(sections) {
  const map = new Map(), rest = [];
  for (const s of sections) {
    const m = s.match(/^(.+?)\s*(?: - |: )/);
    if (m) map.set(s, m[1].trim()); else rest.push(s);
  }
  const explicit = [...new Set(map.values())];
  const groups = new Map();
  for (const s of rest) {
    const ex = explicit.find(e => s.toLowerCase() === e.toLowerCase() || s.toLowerCase().startsWith(e.toLowerCase() + " "));
    if (ex) { map.set(s, ex); continue; }
    const w = s.split(/\s+/)[0].toLowerCase();
    if (!groups.has(w)) groups.set(w, []);
    groups.get(w).push(s);
  }
  for (const list of groups.values()) {
    let name = list[0];
    if (list.length > 1) {
      const words = list.map(x => x.split(/\s+/));
      const lcp = [];
      for (let i = 0; i < words[0].length; i++) {
        const w = words[0][i];
        if (words.every(ws => ws[i] && ws[i].toLowerCase() === w.toLowerCase())) lcp.push(w); else break;
      }
      name = lcp.join(" ");
    }
    for (const s of list) map.set(s, name);
  }
  return map;
}

const norm = x => x.toLowerCase().replace(/[^a-z0-9]/g, "");
/** Hours for one station: units whose name matches it (e.g. "Turner Place - Soup Garden"), else none. */
export function stationHours(station, hours) {
  const first = norm(station.split(/\s+/)[0]);
  return hours.filter(h => {
    const unit = norm((h.unit || "").split(/ - /).slice(1).join(" ") || h.unit || "");
    const unitFirst = norm(((h.unit || "").split(/ - /)[1] || "").split(/[\s:]+/)[0] || "");
    return (first.length >= 3 && unit.includes(first)) || (unitFirst.length >= 3 && norm(station).includes(unitFirst));
  });
}

/* -------- build-your-own counters --------
   VT lists a build-your-own counter as separate sections, e.g.
     "Tazon - Bases", "Tazon - Protein", "Tazon - Toppings"
     "Rambutan Pho Broth", "Rambutan Pho Proteins", "Rambutan Pho Toppings"
     "Corner BYO Bread Options", "Corner BYO Protein Options", ...
   componentOf() says which choice a section is (base, protein, ...) and which build it belongs to. */
const COMPONENTS = [
  [/\b(bases?|grains?|greens)\b/, "base"],
  [/\bpastas?\b/, "base"],
  [/\bproteins?\b/, "protein"],
  [/\b(breads?|buns?|tortillas?)\b/, "bread"],
  [/\bbroths?\b/, "broth"],
  [/\bcheeses?\b/, "cheese"],
  [/\b(sauces?|dressings?|salsas?)\b/, "sauce"],
  [/\b(toppings?|veggies|vegetables|mix-?ins|fillings?)\b/, "topping"],
];
export function componentOf(section, station) {
  let rest = section.toLowerCase().startsWith(station.toLowerCase()) ? section.slice(station.length) : section;
  rest = rest.replace(/^\s*[-:]\s*/, "").replace(/\boptions?\b/gi, "").trim();
  if (!rest) return null;
  const lower = rest.toLowerCase();
  for (const [re, k] of COMPONENTS) {
    const m = lower.match(re);
    if (m) {
      const sub = rest.slice(0, m.index).replace(/\s*[-:&]\s*$/, "").trim();
      const name = `${station}${sub ? " " + sub : ""}`.replace(/\bBYO\b/g, "Build-your-own").trim();
      return { k, build: name };
    }
  }
  return null;
}
/** A real build-your-own counter needs a foundation (base, bread or broth) plus at least one other choice. */
export function findBuilds(sections, stationOf) {
  const types = new Map();
  for (const sec of sections) {
    const c = componentOf(sec, stationOf(sec));
    if (!c) continue;
    if (!types.has(c.build)) types.set(c.build, new Set());
    types.get(c.build).add(c.k);
  }
  const valid = new Set();
  for (const [b, t] of types)
    if ((t.has("base") || t.has("bread") || t.has("broth")) &&
        (t.has("protein") || t.has("sauce") || t.has("topping") || t.has("cheese"))) valid.add(b);
  return valid;
}

/** Turn raw VT responses for one location into the compact app format. */
export function buildLocation(loc, menuJson, nutritionByKey, hoursJson) {
  const info = LOCATION_INFO[loc.locationNum] || { short: loc.name.trim(), area: "other" };
  const hours = parseHours(hoursJson);
  const sections = [...new Set((menuJson?.meals || []).flatMap(m => (m.sections || []).map(x => x.sectionName.trim())))];
  const secToStation = info.mix ? new Map(sections.map(x => [x, info.short])) : stationNames(sections);
  const stations = [...new Set(secToStation.values())].map(name => ({ name, hours: info.mix ? [] : stationHours(name, hours) }));
  const stationIdx = new Map(stations.map((s, i) => [s.name, i]));
  // build-your-own detection uses restaurant-level grouping even in all-you-care-to-eat halls
  const groupNames = stationNames(sections);
  const validBuilds = findBuilds(sections, x => groupNames.get(x));
  const builds = [], buildIdx = new Map();
  const byKey = new Map();
  for (const meal of menuJson?.meals || []) {
    const per = mealToPeriods(meal.mealName);
    for (const sec of meal.sections || []) {
      for (const r of sec.recipes || []) {
        if (r.legendImages?.includes("alcohol")) continue;
        const key = `${r.recipeId}*${r.portionSize}`;
        const existing = byKey.get(key);
        if (existing) { for (const c of per) if (!existing.m.includes(c)) existing.m += c; continue; }
        const nut = nutritionByKey.get(key);
        const secName = sec.sectionName.trim();
        const comp = componentOf(secName, groupNames.get(secName) || secName);
        const inBuild = comp && validBuilds.has(comp.build) && !(comp.k === "base" && (nut?.p ?? 0) >= 20); // "Chicken Parm" in "Rosso Pasta" is a dish
        if (!nut || nut.cal == null || nut.cal < 0 || (!inBuild && nut.cal === 0)) continue; // no nutrition info -> skip
        let role = inBuild ? "comp" : classify(r.name, sec.sectionName, nut.cal, nut.p ?? 0);
        const periods = /cereal/i.test(sec.sectionName) || /\b(bran|cheerios|granola|frosted flakes|corn flakes)\b/i.test(r.name) ? "b" : per;
        if (role === "condiment") continue; // keep the file small; not useful for plates
        let b;
        if (inBuild) {
          const sIdx = stationIdx.get(secToStation.get(secName));
          const bk = `${comp.build}@${sIdx}`;
          if (!buildIdx.has(bk)) { buildIdx.set(bk, builds.length); builds.push({ name: comp.build, s: sIdx }); }
          b = buildIdx.get(bk);
          if (comp.k === "base" && /pasta/i.test(secName)) builds[b].pasta = true;   // pasta builds need a sauce
        }
        byKey.set(key, {
          id: r.recipeId,
          n: r.name.trim(),
          d: (r.description || "").trim().slice(0, 90),
          st: sec.sectionName.trim(),
          s: stationIdx.get(secToStation.get(sec.sectionName.trim())),
          m: periods,
          por: `${r.portionSize} ${r.portionUnit}`.trim().toLowerCase(),
          cal: Math.round(nut.cal), p: Math.round(nut.p ?? 0), c: Math.round(nut.c ?? 0),
          f: Math.round(nut.f ?? 0), fib: Math.round(nut.fib ?? 0), sug: Math.round(nut.sug ?? 0),
          sod: Math.round(nut.sod ?? 0),
          v: dietFlags(r.legendImages || [], r.allergens),
          al: (r.allergens || "").trim(),
          role,
          ...(inBuild ? { b, k: comp.k } : {}),
        });
      }
    }
  }
  for (const it of byKey.values()) {
    if (/cereal/i.test(it.st) || /\b(bran|cheerios|granola|frosted flakes|corn flakes)\b/i.test(it.n)) it.m = "b";
    it.m = ["b", "l", "d"].filter(c => it.m.includes(c)).join("");
  }
  // "Extra Turkey Breast" is a double scoop; drop it when plain "Turkey Breast" is a choice at the same counter
  for (const it of [...byKey.entries()]) {
    const [key, x] = it, m = x.n.match(/^extra\s+(.+)$/i);
    if (x.role === "comp" && m && [...byKey.values()].some(y => y.b === x.b && y.role === "comp" && y.n.toLowerCase() === m[1].toLowerCase())) byKey.delete(key);
  }
  return {
    num: loc.locationNum, name: info.short, fullName: loc.name.trim(), area: info.area, mix: !!info.mix,
    hours, stations, builds,
    items: [...byKey.values()],
  };
}

/** NutritiveReport response -> Map("recipeId*portion" -> macros) */
export function parseNutrition(json) {
  const map = new Map();
  for (const r of json?.recipes || []) {
    const v = Object.fromEntries((r.nutrients || []).map(x => [x.name, num(x.value)]));
    map.set(`${r.id}*${r.portionSize}`, {
      cal: v["Cals"], p: v["Prot"], c: v["Carb"], f: v["Fat-T"], fib: v["Fiber"], sug: v["Sugar"], sod: v["Sod"],
    });
  }
  return map;
}

/* ---------------- main ---------------- */
export async function run({ outFile } = {}) {
  const date = easternDate();
  const locations = await getJSON(`${MENU_API}/Locations.aspx`);
  const result = { date: date.iso, generatedAt: new Date().toISOString(), source: "foodpro.students.vt.edu", locations: [] };

  for (const loc of locations) {
    try {
      const menu = await getJSON(`${MENU_API}/MenuAtLocation.aspx?locationNum=${loc.locationNum}&dtdate=${encodeURIComponent(date.us)}`);
      await sleep(PAUSE_MS);
      const keys = [...new Set((menu.meals || []).flatMap(m => m.sections.flatMap(s => s.recipes.map(r => `${r.recipeId}*${r.portionSize}`))))];
      const nutrition = new Map();
      for (let i = 0; i < keys.length; i += BATCH) {
        const items = keys.slice(i, i + BATCH).map(k => `${k}*1`).join(",");
        const nut = await getJSON(`${MENU_API}/NutritiveReport.aspx?items=${encodeURIComponent(items)}`);
        for (const [k, v] of parseNutrition(nut)) nutrition.set(k, v);
        await sleep(PAUSE_MS);
      }
      let hours = [];
      try { hours = await getJSON(`${HOURS_API}/${loc.locationNum}/${date.iso}`); } catch (e) { console.warn(`  hours unavailable for ${loc.name}: ${e.message}`); }
      const built = buildLocation(loc, menu, nutrition, hours);
      result.locations.push(built);
      console.log(`✓ ${built.name.padEnd(20)} ${String(built.items.length).padStart(4)} items  ${built.hours.map(h => h.title).join(", ") || "no hours listed"}`);
    } catch (e) {
      console.error(`✗ ${loc.name}: ${e.message}`);
    }
  }

  if (!result.locations.some(l => l.items.length)) throw new Error("No menu items fetched; not overwriting today.json");
  const file = outFile || path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data", "today.json");
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(result));
  console.log(`\nWrote ${file} (${result.locations.reduce((n, l) => n + l.items.length, 0)} items, ${date.iso})`);
  return result;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  run().catch(e => { console.error(e); process.exit(1); });
}
