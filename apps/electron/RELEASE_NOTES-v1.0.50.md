# Titan POS v1.0.50

## Staff sign-in and roles stay as the owner set them

- **PIN resets hold.** An older offline edit of a staff member can no longer bring back a PIN the
  owner reset. A PIN change is now its own change on the device and is refused if a reset
  happened since.
- **One store admin, never none.** A store has exactly one active Admin. The admin cannot be
  demoted or disabled from a register; transfer the role in the owner portal (the transfer also
  restores an admin to a store that has none).
- **Conflicting role changes are shown, not hidden.** If two devices change someone's role or
  access at the same time, or a device changes it from an outdated copy, only one change applies
  and the other appears as a rejected change in the sync status.
- **Removing access signs the person out** of their existing sessions.
- **Older devices (1.0.49):** PIN changes still work from an up-to-date copy. Role changes from
  1.0.49 are refused with a message to update; make role changes from the owner portal or 1.0.50.

## Sync
- A late answer from the hub can no longer overwrite a change the register already settled.

**Upgrade order:** cloud first, then hubs, then registers. A register must not be newer than its hub.
