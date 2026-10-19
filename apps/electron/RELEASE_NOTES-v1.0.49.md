# Titan POS v1.0.49

## Fix: a PIN reset from the owner portal now takes effect on every device

**Symptom:** after the owner reset a staff or admin PIN, the new PIN was refused
on the register (and on a hub the old PIN kept working).

**What changed**
- **Installed hub:** the hub now receives PIN resets (and role, permission and
  active changes) from the cloud. Before, it only received staff created since
  its last sync, so a reset never arrived. After this update the hub refreshes
  all staff once, then keeps them current.
- **Register (lock screen):** the PIN check names the store it belongs to, so the
  cloud can verify it. Devices already connected are recognised automatically.
- **After a reset:** the register's connection to the cloud is renewed the next
  time that person signs in with the new PIN (before, sync stopped with "Token
  expired, re-enter in Settings").

**How PINs behave now**
- **Online:** the server decides. The old PIN is refused; the new PIN works.
- **Offline:** a device accepts only the last PIN verified on it, and not even
  that once it has learned of a newer PIN. A new PIN must be used once while
  online on each device before it works offline.

## Also in this release (from 1.0.48, not published separately)
- Cloud pull: one unusual inventory batch can no longer block a register from
  finishing setup ("Partial pull failure: inventoryBatch").

## Plus everything built since 1.0.47
Midnight Gold back office for Products, Lots and Receiving and for Customers,
Suppliers and Receipts; sync durability and recovery; receiving recovery; hub
checkout safety; refunds, voids and supplier changes enforced by the services
and the server; supplier editing.

**Upgrade order:** cloud first (done), then hubs, then registers.
