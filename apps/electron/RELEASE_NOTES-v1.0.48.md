# Titan POS v1.0.48

## Fix — "Cloud sync failed: partial pull failure — entities not synced: inventoryBatch" on register

**Symptom:** Setting up a register for a store whose data already lives in the
cloud failed with *"Partial pull failure — entities not synced: inventoryBatch"*.

**Cause:** When the hub pulls the store's data down from the cloud, it recreated
inventory batches by copying the cloud row verbatim. If a batch carried a field
the local schema didn't expect, or referenced a product/supplier that wasn't
resolvable locally yet, the create threw and took the **entire** batch entity
down — reported as a partial-pull failure and blocking the register setup.

**Fix:** The batch import now maps only the known batch columns (with correct
types) instead of copying the raw row, so an unexpected field can't break it; and
a batch that points at a missing product is skipped (a dangling supplier link is
dropped) rather than failing the whole sync. One odd batch can no longer block a
store from finishing setup.

Money and stock quantities remain hub-authoritative — the cloud copy never
overwrites an existing batch's remaining quantity on a normal pull.

Includes all earlier fixes: keyboard checkout, open-shift guidance, and the
clean-machine startup (bundled VC++ runtime for embedded PostgreSQL).
