# Sprint 2 — compatibility, rollout and migrations

Canonical source for versions, observe/enforce and migrations.

## 1. Capability, not just sync schema
Sync schema 3 describes **data shape** (stock policy). Authentication is independent: a client can be data-current but evidence-legacy. Proposal: a separate header **`x-titan-auth: 1`** (evidence envelope v1). Clients send both; servers record both in `SyncClient` (Sprint 1 table, add `authVersion`).

## 2. Matrix

| Client → server | Old cloud 1.0.50 | Candidate 1.0.51 cloud | Sprint 2 cloud (observe) | Sprint 2 cloud (enforce) |
|---|---|---|---|---|
| Published till/hub 1.0.50 | as today | Sprint 1 rules | accepted, `claimed-legacy` | restricted ops **held**; hub-connected checkout of restricted ops refused before payment; unrestricted sales accepted `claimed-legacy` (D6) |
| Candidate 1.0.51 till/hub | not supported (cloud first) | as tested | accepted, `claimed-legacy` | as row above |
| Sprint 2 till | not supported | **never strip evidence and retry as legacy**; show "server update required"; keep queue | `verified-*` | `verified-*` |
| Sprint 2 hub | not supported | as above | forwards envelope + attestation | same |
| Old direct-cloud till | — | Sprint 1 release conditions | `claimed-legacy` | cannot be stopped before payment (direct, offline-first): accepted `claimed-legacy`, restricted ops held |
| Device absent during rollout, returns later | — | — | `claimed-legacy` | **not implicitly safe**: aging out of the activity window does not exempt it; held as above until upgraded or retired; retirement refuses hub-connected checkout (Sprint 1) |

Rollout: cloud → hubs → tills. Rollback limits: a Sprint 2 till against a rolled-back cloud stops sending and shows "server update required"; it never downgrades its evidence. Rolling back the cloud after enforce mode was enabled requires re-enabling observe first.

## 3. Observe → enforce (per store)
- **Observe** (default for every existing store): evidence recorded, limitations shown in audit/review; behaviour unchanged except fixes already shipped.
- **Enforce** is enabled by the owner after a compatibility check that lists every client seen (any activity, not only the last 14 days) with its `authVersion`; clients below 1 must be upgraded or **retired**. Retirement and re-admission keep their Sprint 1 effects; a retired device that returns is refused at hub checkout and its queued work is held, not applied silently.
- Enforce never rejects already-completed paid work; it holds it.

## 4. Database — implemented migrations (all additive)
`20261101130000_daily_close_unknown_cost` (d678a84), `20261101150000_hub_attestation` (HubKey; OperationEvidence.attestation, attestationKid), `20261101170000_manager_approval` (ManagerApproval; OperationEvidence.approval), `20261101190000_review_resolution` (SyncOperation.heldEvidence; ReviewResolution). Older servers ignore the new request fields (`ev.fwd`, `ev.approval`, `previewToken`, `outcome`); a hub of this branch in front of the deployed cloud forwards attestations the deployed cloud ignores. The review resolve endpoint now requires `previewToken` (and `outcome` for declines): clients of the review must be upgraded with the server (the admin app is).

### Original proposal
| Table / column | Why |
|---|---|
| `DeviceCredential` (id, tenantId, deviceId (server-assigned), issuer, status, keyId?, publicKey?, enrolledBy, enrolledAt, revokedAt, revokedBy, version) — unique (tenantId, deviceId) | enrollment, revocation, rotation |
| `StaffSession` (id, tenantId, staffId, deviceCredentialId, issuer, authVersion (`tokenVersion` at issue), authTime, expiresAt, revokedAt) — index (tenantId, staffId) | bind sessions to device; revocation; evidence references |
| `HubKey` (id, tenantId, kid, publicKey, status, enrolledBy, createdAt, revokedAt) — unique (tenantId, kid) | hub attestation verification and rotation |
| `Approval` (id, tenantId, deviceCredentialId, opId, digest, material jsonb, approverId, mode online/offline-local, createdAt, expiresAt, usedAt) — unique (tenantId, opId) where used | single-use binding |
| `OperationEvidence` (opId PK→SyncOperation, tenantId, actorId, approverId, evidence, limitations text[], verifiedBy, receivedAt, claimedAt, deviceSeq) | per-op evidence without touching business tables' immutable data |
| `ReviewResolution` (id, tenantId, opId, reviewerId, decision, note, createdAt) | separate resolution history |
| `SyncClient.authVersion` | compatibility check |

Constraints: tenantId on every row and in every unique key; issue/revoke/approve in single transactions with row locks on the credential/session; pruning: sessions and approvals after 90 days, evidence kept with the operation. No raw PINs, raw device secrets or token copies stored; audit payloads redact them. Migrations verified from: fresh DB, current production schema (dump of the deployed schema, no data), existing hub DB with pending work. Deployed migrations are never edited.
