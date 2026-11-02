# Pilot handoff: the frozen `dev-176fc59` on an isolated Windows network

Status: **ready to run; externally blocked until a disposable Windows environment exists.** This document is the
whole pilot: run it top to bottom as one batch, record everything in the evidence sheet (§10), and report blockers
together. Release status stays **development candidate** until it passes.

Ground rules:
- **Disposable machines only.** Never install, upgrade or uninstall on a till or hub that trades, and never over
  the real store application on the build PC, without the owner's explicit approval for that machine.
- **Never production.** No production cloud, store, key, PIN or database. The pilot network has no internet route
  (§2), so neither the production cloud nor the auto-update feed can be reached even by mistake.
- **Never record secrets.** Keys, PINs, passwords, tokens and database URLs stay out of notes, screenshots and file
  names. Where a value matters, record its SHA-256 fingerprint.
- **Frozen build.** Run exactly the files in §1. Do not rebuild. A confirmed blocker is fixed on the branch after the
  pilot, all blockers together, in the 1.0.53 candidate (§11).

Already done on the build PC; do not repeat here: the API and register suites, negative controls, migrations on a fresh
database and on a copy of the deployed schema, the extracted-payload café pilot, released 1.0.51 tills through this
hub (`win-unpacked`), and rendered acceptance in headless Chromium (docs/SPRINT-2-ACCEPTANCE.md). This pilot covers what
those could not: the real installer and uninstaller, the operating system's networking, physical devices and screens,
and recovery.

## 1. Candidate files and full hashes

Frozen at `176fc5922508fa58a6316afe5dc17309ff884715` (local tag `freeze/dev-176fc59`, not pushed). Folder
`D:\TitanPOS-candidates\dev-176fc59\` (`FROZEN.txt`, `RELEASE.txt`, `SHA256SUMS.txt`, `UNPACKED-SHA256.txt`). The
binaries say version 1.0.52; this is not a release number.

| File | SHA-256 |
|---|---|
| `Titan-POS-Setup-1.0.52.exe` | `eeee3ce9c854d92d877612ba9dda4ac113ec70c66fe164591aeda81f7e330721` |
| `Titan-POS-Portable-1.0.52.exe` | `e392d762235ce17098db3d2e8ba0bb59a6e8fb45fab49e4a44f5d3c259d9b27d` |
| `Titan-POS-Setup-1.0.52.exe.blockmap` | `7738fe9dd5f4f9267f15f72032b47e9d73fe9928f135b58c7cd9bec9264b9af5` |
| `latest.yml` | `78df02c4777772f89377308ad264bd4281d7f02f6458b3435b7b0198181c82b9` |
| installed `Titan POS.exe` | `5fe62d73972e6ca09bcc443db32c44913ba84db8696aa67c47c5e37bf9a900bf` |
| installed `resources\app.asar` | `a743641732f448592b7f510cbff9896ef4bb712afceb3c67e8afa703b9410c02` |
| installed `resources\api\index.cjs` | `fcd561f551b0463e24d3ce485f893854f00401105fa37f70650f970c71e00703` |

The previous release, to install first (GitHub release v1.0.51; copy in `D:\TitanPOS-candidates\1.0.51-hotfix-31e1ce6\`):

| File | SHA-256 |
|---|---|
| `Titan-POS-Setup-1.0.51.exe` | `aaedfd2b2df30dfa23e5982e0b7b56457debe40a1abc91e2b3a0cb45ee42a80e` |
| `Titan-POS-Portable-1.0.51.exe` | `c62b290ef8e126c5a0855faba61c081c734cfee6567da5938baa548fbe80f362` |

Pilot kit, `D:\TitanPOS-pilot\dev-176fc59\`:

| File | SHA-256 | Use |
|---|---|---|
| `source-176fc59.bundle` | `9c4172e019fadc3bdb32e00280299df8d9690e5b41bd95252fa100d7446d6748` | the frozen source (git bundle; history to the tag) for the test cloud |
| `seed-pilot-store.mts` | `9ebae4c22b6b9e58d8b5e3cb2944c0e8517b08fc3e369f843f1eb738ec070b82` | creates the disposable store (§3) |

Check every file on arrival: `Get-FileHash -Algorithm SHA256 <file>`, compared with the tables above (case does not
matter). A mismatch stops the pilot.

## 2. Windows prerequisites

**Network.** One isolated network with no internet route: a separate router or switch (Wi-Fi and at least one cable
port), or a host-only virtual network. Record each machine's IP address.

**Machine A: hub, till A and the test cloud.** Windows 10 22H2 or Windows 11, x64; 8 GB RAM; 20 GB free; a standard
user account plus administrator credentials held by the operator. A VM is fine if it can take snapshots. On it:
- Node.js 22 LTS or later (the build PC used 24.19), pnpm 11 (`npm i -g pnpm@11`), Git for Windows.
- PostgreSQL 16, 17 or 18 on port 5432 (the build PC used 18). The hub's own embedded PostgreSQL uses 5434, so there
  is no clash.
- Install these offline from installers copied in, or before the machine joins the isolated network. Then
  snapshot: **"A-clean"**.

**Machine B: till B over Wi-Fi.** Windows 10/11 x64 laptop or VM with Wi-Fi (a bridged VM adapter on the isolated Wi-Fi
is acceptable). Snapshot **"B-clean"**.

**Device C: till C.** A tablet, phone or second PC with a current Chrome or Edge, on the isolated network (cable if
possible, otherwise Wi-Fi). It uses the hub in a browser and needs no installation.

**Devices** (the store's real models where possible): an 80 mm or 58 mm receipt printer, a label printer (40×25,
50×30 or 58×35 mm labels), a USB HID barcode scanner (and a Bluetooth one if the store uses it), and a cash drawer on
the receipt printer's kick port. Install printer drivers on A and B. Print a Windows test page from each.

**Before any Titan POS install, on A and B:**
1. Set the cloud address for the current user so every launch, including the installer's "Run Titan POS" and Start
   menu launches, uses the test cloud. Without it the app defaults to the production address.
   - On A: `setx LBPOS_CLOUD_URL http://127.0.0.1:3998`
   - On B: `setx LBPOS_CLOUD_URL http://127.0.0.1:3998`. B never activates as a hub; this only keeps its unused local
     server away from production.
2. Sign out and back in. Check that `echo %LBPOS_CLOUD_URL%` in a new Command Prompt shows the address.
3. Record the Windows version, display scaling, and whether the user is an administrator. The installers are
   unsigned, so SmartScreen warns: record the warning and change no system settings.

## 3. Test cloud and disposable store (test-only connection details)

The test cloud runs the frozen source's API in cloud mode on machine A, against a local scratch database. Its
launcher refuses production hosts, cloud credentials and any database other than the local `lebanonpos_refund_it`. It
listens only on 127.0.0.1, so only the hub on machine A talks to it. Registers on B and C talk to the hub.

1. **Source.** `git clone --branch freeze/dev-176fc59 <kit>\source-176fc59.bundle C:\pilot\titan`, then
   `git -C C:\pilot\titan rev-parse HEAD` must print `176fc5922508fa58a6316afe5dc17309ff884715`. Run
   `pnpm install --frozen-lockfile` in `C:\pilot\titan`.
2. **Database.** In `psql` as the postgres superuser: create a login role (operator-chosen name and password) and
   `CREATE DATABASE lebanonpos_refund_it OWNER <role>;`. The connection string
   `postgresql://<role>:<password>@localhost:5432/lebanonpos_refund_it?schema=pilot` is the only database URL in the
   pilot. Keep it in the Command Prompt session (`set DATABASE_URL=...`); never write it down or into a file in the
   checkout.
3. **Schema.** In `C:\pilot\titan\apps\api`: `npx prisma migrate deploy`. Expected: 54 migrations applied.
4. **Disposable store.** Still in `apps\api`, choose three different disposable 4–6 digit PINs for the pilot only:
   `set PILOT_PIN_OWNER=…`, `set PILOT_PIN_MANAGER=…`, `set PILOT_PIN_CASHIER=…`. Then run
   `npx tsx <kit>\seed-pilot-store.mts`. It creates store `pilot-xxxxxx` with Owner (Admin), Manager Maya (Manager),
   Rana (Cashier: checkout, reprint, view stock), supplier "Bean & Dairy Co", and settings (no VAT, 89,500 LBP per USD).
   It writes ids to `pilot-store.json` and prints no secrets. Clear the three variables afterwards. Record the
   subdomain.
5. **Start the test cloud** in its own window: `set JWT_SECRET=<a new random test value>` (for example the output of
   `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`), then
   `node scripts\it-cloud.mjs --port 3998`. Expected: `local test cloud on 127.0.0.1:3998`. Then
   `http://127.0.0.1:3998/api/health` answers, and the cloud admin `http://127.0.0.1:3998/admin` opens and accepts the
   owner PIN for the pilot store.
6. **Cloud backup point** (needed by §9). Run `pg_dump -Fc -n pilot -f C:\pilot\backup-T0.dump lebanonpos_refund_it`
   after §5 and before §7, and record the time as `T_backup`.

Stopping the test cloud (Ctrl+C in its window) is how this pilot simulates a cloud outage.

## 4. Install 1.0.51 and create work (hub A, till B)

1. **A:** run `Titan-POS-Setup-1.0.51.exe` with the defaults (per user, `%LOCALAPPDATA%\Programs\Titan POS`). Start
   it. In the activation window, activate for the pilot store (subdomain and owner PIN). Check:
   - `%LOCALAPPDATA%\Programs\Titan POS\data\cloud-config.json` exists;
   - `%APPDATA%\lebanon-pos\.env` names `CLOUD_API_URL=http://127.0.0.1:3998`.
2. **A:** in Settings → Cloud sync, allow LAN access and accept the firewall prompt (on A only). Check that `.env` has
   `BIND_HOST=0.0.0.0` and record the Windows Defender Firewall rule that was created. Restart the hub from the tray.
3. **A (till A), owner:** create "Water 0.5L" (price 1.00, cost 0.40, stock 30, barcode 5281001000303). Receive 10 at a
   unit cost of 0.40 (this creates an invoice). Sell 1 water for cash.
4. **B:** install 1.0.51 the same way. On the connect screen choose "Connect to hub" and enter
   `http://<A's IP>:3015` and a pairing code generated on the hub (Settings → Devices). **Sign in with Rana's PIN on the
   connect screen**: that makes B a cashier-connected register for §7. Sell 1 water.
5. **Pending work:** stop the test cloud. Sell 1 water on A and 1 on B. A's Settings → Sync shows them pending.
6. Record (§10): sales on A and B, staff list, pending count, water stock (expected 36), the SHA-256 of
   `cloud-config.json`, and the SHA-256 of the `JWT_SECRET=` line in `.env` (fingerprints only). Quit both apps from
   the tray. Snapshot A as **"A-1.0.51-work"** and B as **"B-1.0.51-work"**.

## 5. Upgrade to the candidate, including the silent update, with pending work

Upgrade order is cloud, then hub, then registers. The test cloud already runs the candidate's API.

1. **A, interactive upgrade (test cloud still stopped):** run `Titan-POS-Setup-1.0.52.exe` over 1.0.51 in the same
   folder. It finishes without error and closes nothing else. Before starting the app, check:
   - `%LOCALAPPDATA%\Programs\Titan POS\data` is gone (the old uninstaller removed it);
   - `%APPDATA%\lebanon-pos\install-data-migration\cloud-config.json` exists (the installer staged it).
2. Start the hub. **Pass: no activation screen**, and the POS opens. Check:
   - `%APPDATA%\lebanon-pos\hub-data\cloud-config.json` exists with the fingerprint from §4.6, and
     `install-data-migration` is gone;
   - `.env` keeps `BIND_HOST=0.0.0.0` and the same `JWT_SECRET` fingerprint;
   - the installed `Titan POS.exe`, `resources\app.asar` and `resources\api\index.cjs` match §1;
   - staff, sales and the pending count equal §4.6, and water stock is 36.
3. **B, register upgrade with pending work:** install the candidate over 1.0.51 on B. It is still paired, Rana can
   sign in online through the hub, and its pending sale is still pending.
4. **Reconnect:** start the test cloud. Within a minute everything pending is sent **once**:
   - the cloud admin shows the 4 water sales once each and water stock 36;
   - A and B show nothing pending; nothing is "Held" that was not held before;
   - if the cloud's Refused work had an `IDENTITY_HELD` receive or adjustment from the 1.0.51 hub (expected for
     number-only forwards, RELEASE-MANIFEST.md §4), it is now applied once.
5. **Restart:** reboot A, start the hub. No activation; LAN still on; B reconnects without re-pairing.
6. **LAN off and on:** switch LAN access off and restart; `.env` shows `BIND_HOST=127.0.0.1` and B cannot connect.
   Switch it back on and restart; B reconnects.
7. **Silent update path:** restore snapshot "A-1.0.51-work". Run `Titan-POS-Setup-1.0.52.exe /S` (what the
   auto-updater runs), wait for the process to end, then repeat checks 1–2 and reconnect (4). The real update feed
   cannot be exercised before publication: after publication, the feed's `latest.yml` must equal the published build's,
   and one 1.0.51 machine must be offered the update (§11).
8. **Refusals:** from "A-1.0.51-work", put a `cloud-config.json` for **another** store into `<install dir>\data`
   before upgrading. To get one, seed a second store with the kit script and activate the §6 machine for it. After the upgrade the hub opens activation, `hub-data` has
   no `cloud-config.json`, and the staged copy stays in `install-data-migration`. Restore the snapshot afterwards.
9. Continue on the upgraded A from step 6, not the refusal snapshot. Take the cloud backup point (§3.6).

## 6. Configuration, activation and LAN settings (fresh install)

On a clone of "A-clean", or another clean VM with the same prerequisites and its own test cloud:
1. Install the candidate only. Activation shows. After activating, `%APPDATA%\lebanon-pos\hub-data\cloud-config.json`
   exists, and nothing is written to the install directory's `data` folder.
2. Settings: store name, receipt header and footer, currency rate, language (English, then Arabic: the whole UI is
   right to left), printer selection, LAN access. Each setting survives a restart.
3. Activation refusals: a wrong owner PIN and an unknown subdomain are refused with a readable message and nothing is
   saved.

## 7. Café day: two tills over the LAN, expected stock and money

Run on the upgraded system from §5:
- **Till A** is the hub's own window on machine A, used by Maya (manager).
- **Till B** is machine B over Wi-Fi, connected with Rana's PIN.
- **Till C** is the browser on device C at `http://<A's IP>:3015`, with Rana signed in.
- Admin screens are the hub's `http://localhost:3015/admin` on A and the cloud's `http://127.0.0.1:3998/admin`.

Store mode stays **observe**. Amounts are USD and all payments are cash.

### 7.1 Setup (till A, Maya; then the owner)

1. **Topology.** In the hub admin → Store security, the owner creates the hub key. In the cloud admin → Store security,
   the owner chooses "registers through one hub", picks this hub, and confirms. The readiness checks must pass: no open
   shifts, queues empty, a matching hub report. The hub then shows that it is the store's hub.
2. **Ingredients** (category Ingredients, not sellable, stock 0), as stock unit / purchase unit:
   - Coffee beans g/kg
   - Instant coffee g/kg
   - Whole milk ml/L
   - Oat milk ml/L
   - Vanilla syrup ml/ml
   - Sugar sticks unit/pack of 100
   - Cups unit/pack of 50
   - Lids unit/pack of 100

   Then try to save an ingredient counted in ml but bought by the kg. **It is refused**: kg cannot be converted to ml.
3. **Packaged goods:**
   - Pepsi 330ml: price 1.00, cost 0.40, stock 24, barcode 5281001000101.
   - Chips: price 0.75, cost 0.30, stock 30, barcode 5281001000202.
4. **Option groups** (English / Arabic names):

   | Group | Rule | Options (price change) |
   |---|---|---|
   | Size / الحجم | required, choose 1 | Small −0.25, **Medium 0 (default)**, Large +0.75 |
   | Milk / الحليب | required, choose 1 | **Whole milk 0 (default)**, Oat milk +0.50 |
   | Sugar / السكر | optional, up to 1 | **No sugar (default)**, 1 sugar, 2 sugars |
   | Extra / إضافات | optional, up to 2 | Extra shot +0.75, Vanilla +0.50 |
   | Ice / الثلج | required, choose 1 | **Regular ice (default)**, Light ice, No ice |

5. **Drinks** (category Coffee, made from a recipe) and their recipes, with yield 1 and note "opening menu":

   | Drink | Price | Groups | Recipe per serving |
   |---|---|---|---|
   | Espresso | 2.00 | Extra | beans 9 g; +9 g beans with Extra shot; syrup 15 ml with Vanilla; cups 1 |
   | Nescafé | 1.50 | Size, Milk, Sugar | instant 2/3/4 g (S/M/L); whole milk 50/80/100 ml unless Oat; oat 50/80/100 ml with Oat; sugar 1 with "1 sugar", 2 with "2 sugars"; cups 1 |
   | Cappuccino | 3.00 | Size, Milk, Extra | beans 18 g; whole milk 150/200/250 ml unless Oat; oat 150/200/250 ml with Oat; +18 g beans with Extra shot; syrup 15 ml with Vanilla; cups 1; lids 1 |
   | Iced latte | 3.50 | Size, Ice | beans 18 g; whole milk 180/220/260 ml; cups 1; lids 1 |

6. **Receive** in purchase units from Bean & Dairy Co, invoice INV-D71, "On account":

   | Item | Received | Price per purchase unit | Expiry |
   |---|---|---|---|
   | Coffee beans | 2 kg | 18.37 | 2027-03-01 |
   | Instant coffee | 0.5 kg | 12.00 | |
   | Whole milk | 6 L | 1.25 | 2026-12-01 |
   | Oat milk | 1 L | 2.40 | |
   | Vanilla syrup | 750 ml | 0.01 | |
   | Sugar sticks | 1 pack | 3.00 | |
   | Cups | 4 packs | 4.00 | |
   | Lids | 2 packs | 3.00 | |

   **Expected:** the purchase order total is **85.14**, and the supplier owes **85.14**.

### 7.2 Selling (till B, Rana, shift opened with a 20.00 float)

1. **S1**, live through the hub:
   - 2 × Cappuccino, Large + Oat milk + Extra shot, at 5.00 each;
   - 1 Pepsi, scanned (1.00);
   - 1 Chips, scanned (0.75).

   **Total 11.75.** The receipt prints the options under the drink. Before paying, check that adding the same
   configuration again joins the existing line and that a different milk makes a new line. Then remove those test
   additions so that S1 is exactly as listed.
2. **S2:** Nescafé, Medium + Whole milk + 1 sugar, note "extra hot" (1.50), and Espresso with Extra shot + Vanilla
   (3.25). **Total 4.75.**
3. **Refused before payment, nothing recorded:**
   - a Nescafé without a size cannot be added (Size is required);
   - 3 × Cappuccino Large + Oat is refused, naming **Oat milk** (needs 750 ml, 500 ml in stock).
4. **S3:** 2 × Cappuccino Medium + Whole (3.00 each) with a 0.50 discount. **Maya approves** it on till B with her PIN.
   Changing an option after approval needs a new approval. **Total 5.50.**
5. **Refund on S1, approved by Maya:** 1 Cappuccino (5.00) and 1 Pepsi (1.00), refund **6.00**. The confirmation says
   the drink is money only and its ingredients stay used, and the Pepsi goes back to stock and its lot.
6. **Rana records a remake:** Cappuccino, Medium + Whole, note "milk too hot, remade". Her connection may not adjust
   stock, so the server **keeps it for review**: B's Sync status shows it as kept by the server, and stock is
   unchanged. *Known in this build (tracked, does not fail the pilot):* the dialog text says "for a manager's review"
   from Rana's own permission. Fixed for 1.0.53 (RELEASE-MANIFEST.md §10).

### 7.3 Remakes and waste (till A, Maya, shift opened with a 20.00 float)

1. Maya's remake: Cappuccino, Medium + Whole, note "dropped on the counter". It applies at once.
2. Waste of 125.5 ml of Whole milk, "jug knocked over".
3. In the hub admin → Refused work, Maya **applies** Rana's held remake with note "remake confirmed with Rana". The
   reviewer is recorded apart from Rana. On B, "Check now" clears it.

### 7.4 Cloud outage (till A)

Stop the test cloud. **S4** live at the hub:
- Iced latte, Large + No ice (4.25);
- 2 × Espresso, no options (2.00 each);
- 2 × Chips (0.75 each).

**Total 9.75.** It is sold normally and waits for the cloud.

### 7.5 Wi-Fi drop on a hub-connected till (till B)

Turn off B's Wi-Fi and try to sell a Cappuccino. B says stock sales are paused and **charges nothing**; this is by
design for hub-connected registers. Turn Wi-Fi back on: B resumes, nothing is charged twice, and the hub shows no sale
from this attempt.

### 7.6 Recipe revision (till A, Maya)

Save Cappuccino revision 2: base beans 20 g instead of 18 g, note "stronger". It becomes current on the hub, and
revision 1 is kept in the recipe history.

### 7.7 After the revision (till B, Rana)

1. **S5:** Cappuccino, Medium + Whole (3.00). It uses **revision 2**: beans 20 g, milk 200 ml, 1 cup, 1 lid.
2. Close Rana's shift. Her expected drawer is **39.00**: float 20.00 + her cash sales (11.75 + 4.75 + 5.50 + 3.00)
   − the 6.00 refund. Count 39.00.

### 7.8 Count and close (till A, Maya)

1. Stock count:
   - Coffee beans counted **1777.5 g**, a variance of −4.5 g;
   - Whole milk counted **4504.5 ml**, a variance of −30 ml.

   Complete the count.
2. Close Maya's shift: expected drawer **29.75** (float 20.00 + 9.75). Close the day.
3. Start the test cloud. Wait until A shows nothing pending.

### 7.9 Expected stock at each checkpoint (hub; the cloud matches after 7.8.3)

| Item | after 7.1 | after 7.2 | after 7.3 | after 7.4 | after 7.7 | final (after count) |
|---|---|---|---|---|---|---|
| Coffee beans (g) | 2000 | 1874 | 1838 | 1802 | 1782 | **1777.5** |
| Instant coffee (g) | 500 | 497 | 497 | 497 | 497 | **497** |
| Whole milk (ml) | 6000 | 5520 | 4994.5 | 4734.5 | 4534.5 | **4504.5** |
| Oat milk (ml) | 1000 | 500 | 500 | 500 | 500 | **500** |
| Vanilla syrup (ml) | 750 | 735 | 735 | 735 | 735 | **735** |
| Sugar sticks | 100 | 99 | 99 | 99 | 99 | **99** |
| Cups | 200 | 194 | 192 | 189 | 188 | **188** |
| Lids | 200 | 196 | 194 | 193 | 192 | **192** |
| Pepsi 330ml | 24 | 24 | 24 | 24 | 24 | **24** |
| Chips | 30 | 29 | 29 | 27 | 27 | **27** |
| Each drink's own stock | 0 | 0 | 0 | 0 | 0 | **0** |

Water 0.5L stays at 36 throughout. Every product's open lots add up to its stock.

### 7.10 Expected money and reports (cloud admin, today)

- **Sales:**
  - 5 sales with 10 lines: S1 11.75, S2 4.75, S3 5.50 (after the approved 0.50 discount), S4 9.75, S5 3.00, for a
    total of **34.75**.
  - Refunds **6.00**; net **28.75**.
  - Plus the 4 water sales from §4: 4.00, on earlier dates if §4 ran on another day.
- **Shifts:** Rana 39.00 expected and counted; Maya 29.75. The day close lists both shifts. Unknown cost is shown as
  unknown, never as 0.
- **Café report:**
  - revenue **32.00** = drinks' own price **26.00** + options **6.00**;
  - refunds **5.00**;
  - ingredient cost **6.91**; unknown and partial cost quantities **0**;
  - waste cost **1.54**: waste 1 event 0.16, remakes 2 events 1.38.

  | Drink | Qty | Own price | Options | Ingredient cost | Margin |
  |---|---|---|---|---|---|
  | Cappuccino | 5 | 15.00 | 4.00 | 4.85 | 9.15 |
  | Espresso | 3 | 6.00 | 1.25 | 1.05 | 6.20 |
  | Iced latte | 1 | 3.50 | 0.75 | 0.77 | 3.48 |
  | Nescafé | 1 | 1.50 | 0.00 | 0.25 | 1.25 |

  Costs come from the lot costs recorded by the clean café-day pilot (`D:\TitanPOS-it\batch78\costs.out`). S5's
  revision-2 cost (0.7274) is derived. Accept ±0.01 per figure; anything more is a finding.
- **Waste:** 9 waste adjustments, the same on the hub and the cloud:
  - Maya's remake: 4 lines (beans, milk, cup, lid);
  - the spill: 1 line;
  - Rana's remake applied on review: 4 lines.
- **Cost hidden from the cashier:** Rana signed in to the cloud admin is refused the café report. Her register shows no
  cost on sale lines, lots or the purchase order.
- **Hub equals cloud:** for every product, stock and open-lot totals match. Each sale and refund exists once, with the
  same lines, options and consumption. The purchase order matches.

### 7.11 Two tills at once, after the checks above (till B and till C)

Oat milk is 500 ml, enough for exactly 2 Large oat Cappuccinos. On B and C at the same moment, each sells
2 × Cappuccino Large + Oat:
- **one completes;**
- the other is refused before payment, naming Oat milk, and nothing is charged.

Expected change: oat 500 → 0, beans −72 g, cups −2, lids −2, one sale of 10.00. Restart the hub while C is open: C
reconnects without re-pairing.

## 8. Printers, scanner, cash drawer and real screens

1. **Receipt printer** (A and B):
   - S1 and S2 print with the options and the note under each drink;
   - in Arabic the option names print right to left;
   - a reprint matches the original. *Known:* option names on receipts print in English when the receipt language is
     English.
2. **Label printer:** print ingredient and product labels from Receive stock at 40×25, 50×30 and 58×35 mm. Barcodes
   scan back.
3. **Scanner:**
   - USB HID adds Pepsi and Chips to the cart.
   - If a drink has a barcode, scanning it opens its options sheet, and the scanned text is not left in the scan field.
   - Scanning while the sheet is open adds nothing behind it.
   - Repeat with a Bluetooth scanner if the store uses one.
4. **Cash drawer** opens on each cash payment and on the cash-refund flow if configured. It does not open on a refused
   sale.
5. **Camera scanning** on the tablet (C), if used: a barcode adds the item.
6. **Real screens** (C as tablet and as phone; not emulation):
   - touch targets are comfortable;
   - the options sheet's Add button stays in view;
   - the cart drawer works;
   - Arabic is right to left;
   - the on-screen keyboard covers neither the scan field nor the Add button.

   *Known:* back-office drawer buttons are 40 px high; the register's are 44 px.

## 9. Recovery rehearsal, uninstall and reinstall

### 9.1 Recovery rehearsal (RELEASE-MANIFEST.md §8.3, on the test cloud)

1. **Stop.** Stop the test cloud and record `T_stop2`. A, B and C keep their queues; reinstall, re-pair and clearing
   data are not allowed.
2. **Preserve.** Run `pg_dump -Fc -n pilot -f C:\pilot\D_post.dump lebanonpos_refund_it` and record its SHA-256. Quit
   the hub and copy `%APPDATA%\lebanon-pos` to `C:\pilot\hub-backup-<time>`.
3. **Restore into a new database, never over the live one.**
   - In psql: `CREATE DATABASE pilot_restore OWNER <role>;`
   - `pg_restore -d pilot_restore C:\pilot\backup-T0.dump`
4. **Reconciliation report.** Run the queries below on both databases, substituting the pilot store's id and
   `T_backup`. Save the outputs as evidence.

   ```sql
   SELECT entity, action, count(*) FROM pilot."SyncOperation"
     WHERE "tenantId" = '<store id>' AND "appliedAt" > '<T_backup>' GROUP BY 1, 2 ORDER BY 1, 2;
   SELECT count(*), sum(total) FROM pilot."Sale" WHERE "tenantId" = '<store id>' AND "createdAt" > '<T_backup>';
   SELECT count(*) FROM pilot."SaleRefund" WHERE "tenantId" = '<store id>' AND "createdAt" > '<T_backup>';
   SELECT action, count(*) FROM pilot."AuditEvent" WHERE "tenantId" = '<store id>' AND "createdAt" > '<T_backup>' GROUP BY 1;
   SELECT name, stock FROM pilot."Product" WHERE "tenantId" = '<store id>' ORDER BY name;
   ```

   **Pass:**
   - On the live database, the report lists the café-day work: 5 sales (6 with 7.11) totalling 34.75 (44.75), 1
     refund, the receive, waste, the count and the closes, plus the menu changes made in the admin.
   - The restored database has none of it.
   - Its stock equals the post-§5 state.

   This is the list a rollback would have to replay or re-enter. RELEASE-MANIFEST.md §8.3.4 explains why most of it
   cannot be replayed into old code.
5. **Forward-fix path.** Start the test cloud again on the live data (unchanged). The hub and registers resend
   whatever they queued during the stop, once each. Hub equals cloud again.
6. Drop `pilot_restore` afterwards.

### 9.2 Uninstall and reinstall (machine A)

1. Uninstall the candidate (Settings → Apps). Record what remains. Expected: `%APPDATA%\lebanon-pos` is kept,
   including `pgdata`, `hub-data` and `.env`.
2. Reinstall the candidate. No activation; data, staff and pairing are intact; nothing pending; B and C reconnect.
3. **Hub backup restore:**
   - Quit the hub and replace `%APPDATA%\lebanon-pos` with the backup from 9.1.2. Start it.
   - Record whether it opens without activation and catches up with the cloud; there must be no duplicate sales in the
     cloud. A mismatch is a finding.
4. **Clean reinstall:**
   - Uninstall, delete `%APPDATA%\lebanon-pos` by hand, reinstall.
   - Activation shows. After activating for the pilot store, the products, staff and stock come back from the cloud.
     Record the counts against the cloud.
5. On B, uninstall, reinstall and re-pair. Rana signs in; B's history comes from the hub.

## 10. Evidence capture and pass/fail

**Evidence folder** on machine A: `C:\pilot\evidence\<YYYY-MM-DD>\`, copied off the network at the end with a
`SHA256SUMS.txt` of its files.
- **Results sheet** (`results.csv`), one row per step: section, step, time, machine, expected, observed,
  pass/fail/finding, screenshot names.
- **Screenshots** named `<section>-<step>-<pass|fail>.png`.
- **Consoles:**
  - the test cloud window: copy its text at the end;
  - `%APPDATA%\lebanon-pos\pg.log` from A;
  - the installer exit code where shown.
- **Fingerprints:**
  - the installed files' SHA-256 (§5.2);
  - `cloud-config.json` and the `JWT_SECRET` line (§4.6, §5.2);
  - the dumps (§9.1).
- **Reports:** the §9.1.4 query outputs; the cloud admin's café report, day close and shift close as screenshots;
  hub-versus-cloud stock as the two product lists, side by side.
- **Never captured:** keys, PINs, passwords, tokens, the database URL or `JWT_SECRET` values. Blur them if they appear
  on screen.

**Blocker** (fails the pilot; fix on the branch, then rebuild and revalidate as 1.0.53):
- a file hash mismatch or an installer failure;
- activation after an upgrade, or lost data, staff, pairing, LAN setting or pending work;
- any sale, refund, receive or adjustment missing, duplicated or applied to the wrong product or lot;
- stock, lots or money differing from §7.9–§7.10 beyond the stated tolerance;
- a cashier able to see cost;
- a crash or a stuck queue;
- a required device (receipt printer, scanner, drawer) unusable;
- a till that cannot pair or reconnect over the LAN;
- a recovery step losing live data.

**Finding** (recorded, not blocking): cosmetic issues, wording, and timing differences that do not change results. Also
the tracked items: the remake/waste wording in this build, observe-mode authorization by connection account, English
option names on receipts, and 40 px back-office buttons.

**Pass:** every step in §4–§9 passes with no blocker. Report all findings together in one pilot report with the
evidence folder and its checksum.

## 11. After the pilot

1. Fix every confirmed blocker on the branch together, with tests; the waste wording fix `ea52d71` is already there.
2. Raise `apps/electron/package.json` to **1.0.53** (RELEASE-MANIFEST.md §1) and build from a clean checkout.
3. Validate that exact binary: the suites, the café-day pilot on its package, and §4–§5 of this document with the
   1.0.53 Setup. A version change alone still requires this.
4. Publish only after that, and only with the owner's approval. Then check the update feed: a 1.0.51 machine is offered
   1.0.53, and the feed's `latest.yml` hash equals the build's.
