# Hokie Fuel 🦃

Answer four quick questions and get the Virginia Tech dining hall **plate** that fits your goal: recovery, pre-workout, muscle, light, study focus or bulking. Picks come from **today's real menu**, only from counters **open right now**.

In food courts like Turner, Owens, West End, Squires and Perry Place, **every plate comes from a single restaurant counter**, such as Firegrill or Wan, so you order it in one line. All-you-care-to-eat halls like D2 can mix stations.

**Saved meals:** tap ♡ Save meal on any result. Saved meals show up on the home screen, marked as on today's menu and open now, or not on the menu today. They're stored in the student's own browser (localStorage): no accounts, nothing sent anywhere.

**Build-your-own counters** (Tazon, Variabowl, Ciotola, Rambutan, Rambutan Pho, Fresh & Feta, Veloce, Rosso, Burger '37, Corner '24 subs, Xpress Lane subs) get a step-by-step order: bread or base, protein, cheese, each topping, sauce, plus which high-calorie extras to skip. These choices come from VT's menu sections, such as "Tazon - Bases", "Tazon - Protein" and "Tazon - Toppings".

## How it works

```
GitHub Action (5×/day)                    GitHub Pages
 scripts/fetch-menus.mjs  ──writes──▶  data/today.json  ◀──reads──  index.html (the app)
   │
   └─ pulls from VT's public menu endpoints (the same ones foodpro.students.vt.edu uses):
        Locations.aspx        list of dining locations
        MenuAtLocation.aspx   today's menu per location
        NutritiveReport.aspx  calories / protein / carbs / fat / fiber / sodium (batched)
        hours API             open/close times per location
```

- **No server, no database, no cost.** GitHub runs the fetch script on a schedule and hosts the site.
- The script makes about 30 requests per run, spaced out, so it's light on VT's servers.
- If `data/today.json` is missing, the app falls back to a small demo menu and says so.

## Put it online (about 10 minutes)

1. **Create a GitHub repo.** On github.com, click **New repository**, name it `hokie-fuel`, make it **Public**, and click **Create**.
2. **Upload these files.** On the new repo page, click **uploading an existing file**, drag in everything from this folder (including the hidden `.github` folder), and commit.
   - On a Mac, press `Cmd + Shift + .` in Finder to show hidden folders.
   - Or use the terminal:
     ```bash
     git init && git add . && git commit -m "Hokie Fuel"
     git branch -M main
     git remote add origin https://github.com/YOUR-USERNAME/hokie-fuel.git
     git push -u origin main
     ```
3. **Let the Action write files.** Go to **Settings → Actions → General → Workflow permissions**, choose **Read and write permissions**, and save.
4. **Run it once.** Go to the **Actions** tab, open **Update dining menus**, click **Run workflow**, and wait about a minute. A new commit should add `data/today.json`.
5. **Turn on the website.** Go to **Settings → Pages**. Under *Build and deployment*, choose **Deploy from a branch**, then **main** and **/ (root)**, and save.
6. After a minute your app is live at `https://YOUR-USERNAME.github.io/hokie-fuel/`.

From then on, the menu refreshes automatically about 5 times a day.

## Students install it like an app

Hokie Fuel is a **Progressive Web App (PWA)**: once it's on GitHub Pages, students can install it straight from the website. There's no app store and it's free.

- **iPhone (Safari):** open the site, tap **Share ⬆︎ → Add to Home Screen → Add**. The app's home screen also shows an **Install** card that walks them through it.
- **Android (Chrome):** tap **Install** on the card, or **⋮ → Install app**.
- **Laptop (Chrome or Edge):** click the install icon in the address bar.

Once installed, it opens full-screen with its own icon, keeps saved meals, and still works with bad Wi-Fi. It shows the last menu it downloaded until it can get a new one. Updates reach everyone automatically whenever the menu refreshes or you change the code.

**Share it:** post the link with a QR code (any free QR generator works) on flyers in the dining halls, or in GroupMe and Discord chats.

**Want it in the App Store or Google Play later?** You can wrap this same app with a free tool like [PWABuilder](https://www.pwabuilder.com) (paste your site's link and it builds the store packages). Google Play costs a one-time $25 developer fee and Apple costs $99/year, and both review the app first. Start with the PWA to get students using it.

Files that make this work: `manifest.webmanifest` (name, icon, colors), `sw.js` (offline support), `icons/`.

## Run it on your own computer

You need [Node.js](https://nodejs.org) 18 or newer.

```bash
node scripts/fetch-menus.mjs        # downloads today's menu into data/today.json
python3 -m http.server 8000         # then open http://localhost:8000
```

Tests (they use saved sample data, so they don't hit VT's servers):

```bash
PAUSE_MS=0 node test/fetch-menus.test.mjs
node test/logic.test.mjs
```

## Things you might want to tweak

| What | Where |
|---|---|
| Which halls count as "near the dorms" vs "academic side" | `LOCATION_INFO` in `scripts/fetch-menus.mjs` |
| Which halls may mix counters on one plate (`mix: true`) | `LOCATION_INFO` in `scripts/fetch-menus.mjs` |
| How menu sections are grouped into counters | `stationNames()` in `scripts/fetch-menus.mjs` |
| Which sections count as build-your-own choices | `COMPONENTS` / `findBuilds()` in `scripts/fetch-menus.mjs` |
| What counts as a main, side, drink, dessert or topping | `classify()` in `scripts/fetch-menus.mjs` |
| Calorie ranges for "just a little / regular / starving" | `HUNGER` in `index.html` |
| How each goal is scored | `scorePlate()` in `index.html` |
| Refresh schedule | `cron:` line in `.github/workflows/update-menus.yml` |

## Good to know

- **Allergens and diet labels come from VT Dining's own data.** "No gluten / dairy / nuts" means the item's allergen statement doesn't list them. VT kitchens are shared, so cross-contact is possible. The app says this, and you should keep that disclaimer.
- **If VT changes its menu website,** the fetch step will fail. You'll get an email from GitHub, and the app keeps showing the last good menu with a "showing menu from …" note. The endpoints are listed at the top of `fetch-menus.mjs`.
- **GitHub pauses scheduled Actions** in repos with no activity for 60 days. The bot's own commits normally keep it active. If it ever pauses, click **Enable workflow** in the Actions tab.
- This is an unofficial student project, not affiliated with Virginia Tech Dining Services. If it gets real use, contact VT Dining (yes@vt.edu). They may be glad to help, and it's courteous to let them know.
