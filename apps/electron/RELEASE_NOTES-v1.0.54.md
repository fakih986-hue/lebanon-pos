# Titan POS v1.0.54 (release candidate — not published)

Supersedes the unpublished 1.0.53 (never publish 1.0.53). Includes everything listed for 1.0.53, plus the changes
below. **Upgrade order: cloud first, then this PC's hub, then registers** (see "Upgrade order").

## For managers and cashiers
- **Manager approvals work for staff added on a register.** A manager whose PIN was set on a register could sign in
  but every discount, refund, void and payout approval said "Wrong PIN". Fixed on the cloud and on the hub.
- **A shared PIN never approves.** If two people have the same PIN, an approval (or a server-checked sign-in) with it
  is refused with a clear message; the owner gives each person their own PIN. Nobody can pick "who is approving".
- **Receipts show each drink's options** (size, milk, extras, note) on the sale-complete panel, the Sales receipt,
  the return list (two Lattes with different options are told apart), printed receipts, reprints and the WhatsApp
  receipt — in Arabic when the register is in Arabic. Old receipts keep the options as sold.
- **Café report:** each drink is one row under its current name; names it was sold under are listed ("Sold as …");
  a drink no longer on the menu is marked. Figures unchanged.
- **Cash drawer scope.** A shift belongs to the register that opened it. Another register (a phone, a second PC)
  does not sell into it unless the owner turns on **Settings → Cloud sync → Cash drawer → One shared drawer for all
  registers**; without it, that register says whose shift is open and cannot open a second one (separate drawers per
  register are not supported yet). The setting changes only when no shift is open.
- **Daily close counts each sale once** when a store has more than one register: a register closes its own drawer's
  records; with one shared drawer, the store's close is one close that a second register corrects, never adds to.

## Upgrade order
1. Cloud (migration `20261106090000_drawer_scope`: three nullable columns; sync schema 7). Hubs on 1.0.53 or older
   keep working: the cloud never sends them the new fields.
2. This PC's hub (1.0.54 installer): its own database gets the same migration on start.
3. Registers (browser tills update with the hub; Windows registers with this installer).

## Known limits
- Separate cash drawers per register are not supported (blocked, not silently shared).
- Older registers (1.0.53 and before) still join any open shift as they always did; upgrade every register.
- Physical receipt printers, cash drawers and scanners are not yet validated.
