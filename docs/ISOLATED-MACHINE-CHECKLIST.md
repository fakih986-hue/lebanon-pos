# Isolated Windows machine — the acceptance this build PC cannot do

Status: **externally blocked.** The build PC has no disposable Windows machine (no Windows Sandbox or Hyper-V) and
runs a real installation; running the installer there would replace it. Extracted-payload runs (`win-unpacked`) were
done for everything else and must **not** be repeated as a substitute for this list: they skip the installer, the old
uninstaller and the operating system's networking and devices.

Use one disposable Windows 10/11 x64 machine or VM from a clean snapshot (two, or the same VM plus a second device on
the same network, for the LAN steps), a test cloud the VM can reach with a **disposable store** (never production), and
the candidate folder `D:\TitanPOS-candidates\dev-<commit>\` (Setup, Portable, `SHA256SUMS.txt`). Record for each step:
time, what was seen, pass/fail, screenshots. Never record keys, PINs, passwords or database URLs.

## 0. Preparation

1. Snapshot the VM. Record Windows version, whether the user is an administrator, the display scaling.
2. Copy the installers; check `Get-FileHash -Algorithm SHA256` against `SHA256SUMS.txt` (candidate) and the v1.0.51
   release notes (1.0.51 Setup). Both are unsigned: SmartScreen warns; record it, change no system settings.
3. The test cloud runs the candidate's API (cloud first, section 4 of RELEASE-MANIFEST.md). Note its commit.

## 1. Installer and upgrade (docs/HUB-INSTALL-CHECKLIST.md, sections A–F)

Run HUB-INSTALL-CHECKLIST.md A–F with the candidate in place of "1.0.52": install 1.0.51, create work (sales, a
receive, a paired till, LAN mode, pending work while the cloud is unreachable), upgrade over it, then reconnect,
restart, silent update (`/S`), refusals, fresh install. Pass: no activation screen after the upgrade; data, staff,
pairing, `BIND_HOST` and pending work survive; pending work reaches the cloud once.

Additional for this release:
- After the upgrade, Settings → Sync shows nothing "Held" that was not held before; work an older version gave up on
  while it only waited (a held stock-setting sale) is forwarded again and applied once.
- The hub's first forward of 1.0.51-era adjustments reaches the cloud with stable product ids: compare one adjusted
  product's stock on the hub and in the test cloud (same product, same quantity).

## 2. LAN and Wi-Fi registers

On a second device (or a browser on another machine) on the same network:
1. Pair a register with the hub over the LAN (`http://<hub-ip>:3015`), with Wi-Fi, then with a cable if available.
2. Sell a drink with options (Simple POS and full register), repeat it, edit a line, pay; sell a scanned packaged item.
3. Pull the Wi-Fi: the register says stock sales are paused and charges nothing; reconnect: it resumes; nothing is
   charged twice; the hub shows each sale once.
4. Restart the hub while the register is open: the register reconnects without re-pairing.
5. Two registers sell the last servings of a drink at the same moment: one completes, the other is refused before
   payment with the ingredient named.
6. A cashier-paired register records a remake: it shows "kept by the server — waiting for a manager"; a manager applies
   it in the hub's admin (Refused work); "Check now" on the register clears it.
7. Firewall prompt: allowed on the VM only. Record the Windows Defender Firewall rule created.

## 3. Printers and scanners

1. Receipt printer (58/80 mm, the store's model): print a sale with a configured drink; the options line and the note
   print under the drink; Arabic option names print right to left; a reprint matches.
2. Label printer: print ingredient and product labels from Receive stock (40×25, 50×30, 58×35 mm).
3. Barcode scanner (USB HID, then Bluetooth if used): scan a packaged item into the cart; scan a drink's barcode if one
   is set — the options sheet opens and the scanned text is not left in the scan field; scanning while the sheet is
   open does not add anything behind it.
4. Cash drawer kick on cash payment (if connected through the printer).
5. Camera scanning on a tablet (if used): a barcode adds the item.

## 4. Screens on real devices

On a real tablet and a phone (not emulation): touch targets, the options sheet's Add button in view, the cart drawer,
Arabic right to left, the on-screen keyboard not covering the scan field or the sheet's Add button.

## Result

Record the candidate folder and hashes, the VM image, each step's result and any deviation. Release stays
**development candidate** until 1–3 pass. Then: raise the version (proposed 1.0.53, RELEASE-MANIFEST.md §1), rebuild
from a clean checkout, and repeat section 1 with that exact build before publishing.
