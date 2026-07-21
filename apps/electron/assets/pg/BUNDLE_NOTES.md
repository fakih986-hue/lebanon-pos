# Bundled PostgreSQL — required runtime DLLs

This directory is a trimmed, flat copy of a Windows x64 PostgreSQL build (ICU 77),
shipped verbatim to `resources/pg/` by electron-builder (`extraResources` in
`apps/electron/package.json`).

## Do NOT drop the Visual C++ runtime DLLs

`bin/` MUST contain these three Microsoft VC++ 2015–2022 runtime DLLs (x64):

- `vcruntime140.dll`      — imported by initdb.exe, postgres.exe, pg_ctl.exe, libpq.dll
- `vcruntime140_1.dll`    — imported by the ICU DLLs (icuuc77 / icuin77)
- `msvcp140.dll`          — imported by the ICU DLLs

Reason: the Postgres executables and ICU are MSVC-compiled and link these at load
time. Developer/hub machines usually have them in `System32`, which masks their
absence. A clean customer machine does **not**, so `initdb`'s bootstrap `postgres`
child crashes with `0xC0000005` and rolls back the data dir (the v1.0.44 first-run
failure — see RELEASE_NOTES-v1.0.45.md).

The Universal CRT (`api-ms-win-crt-*`, `ucrtbase.dll`) is a Windows 10/11 system
component and does not need bundling.

If you ever regenerate/replace this pg bundle, re-verify with a PE import check
that every import beginning `VCRUNTIME`/`MSVCP` is satisfied by a DLL present in
`bin/`, and re-copy these three from a machine's `System32` (or the VC++ redist)
if missing. They are committed via `git add -f` because the repo gitignores `*.dll`.
