# Titan POS v1.0.45

## Critical fix — first-run startup on clean machines

**Symptom:** On a freshly-installed machine that has never had PostgreSQL (or the
Microsoft Visual C++ runtime) installed, the app failed at first launch with:

```
Titan POS — Startup Error
Command failed: "...\resources\pg\bin\initdb.exe" ...
child process was terminated by exception 0xC0000005
initdb: removing data directory "...\lebanon-pos\pgdata"
```

**Cause:** The bundled PostgreSQL binaries (`initdb.exe`, `postgres.exe`, the ICU
DLLs) are compiled against the Microsoft Visual C++ 2015–2022 runtime. Their PE
import tables reference `VCRUNTIME140.dll`, `VCRUNTIME140_1.dll` and `MSVCP140.dll`
(the last two pulled in by ICU, which `initdb`'s bootstrap `postgres` child loads).
The bundle shipped **none** of these. On developer/hub machines they exist in
`System32` (installed by other software) so the crash was masked; on a clean
customer machine they're absent, so the bootstrap child access-violates (`0xC0000005`)
and `initdb` rolls back the data directory.

**Fix:** The three VC++ runtime DLLs are now bundled app-local in
`resources/pg/bin/` next to the Postgres binaries (the Microsoft-sanctioned
app-local deployment). Titan POS is now fully self-contained and initializes its
database on any clean Windows 10/11 machine with no prerequisite installs.

## Who needs this build

- **New installs / clean machines:** install 1.0.45 — this is the build that works
  out of the box.
- **Affected machines that already showed the error:** just install 1.0.45 over the
  top (or run it again). The previous failed attempt left no database behind, so
  first-run initialization simply succeeds this time. No cleanup needed.
- **Existing working hubs:** unaffected; their database is already initialized.

## Distribution note

This fix cannot ship via in-app auto-update to a machine that can't start, because
the crash happens during database init before the app UI (and updater) load. The
first-run fix must reach affected machines as a **manually installed** 1.0.45
installer. Every already-running install continues to auto-update normally.
