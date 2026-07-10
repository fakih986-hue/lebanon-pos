# Titan POS — Code Signing Decision Report

**Version:** 1.0.8
**Date:** 2026-07-10
**Author:** OpenCode (Sonnet)

---

## Executive Summary

Titan POS installer and portable EXEs are currently **unsigned**. Windows SmartScreen will display "Windows protected your PC" / " unrecognized app" warnings on every download and launch. This report evaluates three signing options and recommends a path forward.

---

## 1. Signing Options Comparison

### 1.1 Standard OV (Organization Validation) Certificate

| Factor | Detail |
|--------|--------|
| **Annual cost** | $65–$400 (SSL.com $65, Certum $108, Sectigo $220, DigiCert $400+) |
| **Key storage** | Hardware USB token (mandatory since June 2023) or cloud HSM |
| **Issuance time** | 1–3 business days |
| **Identity check** | Business name, address, domain registration |
| **SmartScreen impact** | Reputation builds over time as users run the file |
| **Kernel driver signing** | No |
| **Renewal** | Annual; must re-sign all artifacts |
| **Token shipping** | $40–$90 if physical token required |

### 1.2 EV (Extended Validation) Certificate

| Factor | Detail |
|--------|--------|
| **Annual cost** | $226–$580 (Certum $226, SSL.com $249, Sectigo $279, DigiCert $499+) |
| **Key storage** | Hardware USB token (shipped by courier) or cloud HSM |
| **Issuance time** | 3–7 business days |
| **Identity check** | Full legal entity + physical address + executive verification |
| **SmartScreen impact** | **No longer provides instant reputation** — since March 2024, Microsoft treats EV and OV identically for SmartScreen reputation scoring |
| **Kernel driver signing** | Required |
| **Renewal** | Annual; token may need re-shipment |
| **Token shipping** | $40–$90 |

### 1.3 Microsoft Azure Artifact Signing (recommended)

| Factor | Detail |
|--------|--------|
| **Monthly cost** | $9.99 (Basic) or $99.99 (Premium) |
| **Annual cost** | ~$120 (Basic) or ~$1,200 (Premium) |
| **Key storage** | Microsoft's FIPS 140-2 Level 3 HSM — **no physical token** |
| **Setup time** | 1–2 hours (Azure subscription + Entra ID config) |
| **Identity check** | Through existing Azure / Microsoft Entra ID |
| **SmartScreen impact** | Identical to traditional certificates |
| **Kernel driver signing** | Premium tier only |
| **Signatures/month** | 5,000 (Basic) — far more than Titan POS needs |
| **Signing tool** | `dotnet sign` CLI or Azure SDK |
| **CI/CD integration** | Native GitHub Actions, Azure DevOps, API |
| **Renewal** | Microsoft handles certificate lifecycle automatically |
| **Free tier** | Not available; requires paid Azure subscription |

---

## 2. Recommendation: Azure Artifact Signing (Basic Plan)

**Primary recommendation:** Microsoft Azure Artifact Signing at $9.99/month (~$120/year).

**Why:**
- Cheapest option at ~$120/year vs $65–$400/year for OV + no token management
- Zero key management — certificate lives in Azure HSM, never touches developer machines
- Microsoft-recommended for non-Store distribution
- Automatic certificate renewal — no risk of expiration during release
- No hardware token shipping delays or replacement costs
- Works with existing build pipeline (CLI + CI/CD integration)

**Drawbacks:**
- Requires a paid Azure subscription (not free/trial)
- Tied to Azure — can't sign offline during outages
- Entra ID P1/P2 license **not** required for Basic signing (standard Entra ID is sufficient)

**Fallback:** If the team cannot obtain an Azure subscription, an OV certificate from **SSL.com ($65/year)** is the cheapest traditional option. A physical USB token (~$50 one-time) will also be needed.

**EV not recommended** because:
- Since March 2024, EV provides no SmartScreen advantage over OV
- Titan POS does not sign kernel drivers
- EV costs 2–4× more than OV

---

## 3. Signing Workflow

### 3.1 Certificate Storage & Access

| Option | Where key lives | Who can sign |
|--------|----------------|--------------|
| **Azure Artifact Signing** | Azure cloud HSM | Anyone with Azure RBAC `Trusted Signing Certificate Profile Signer` role |
| **OV physical token** | USB token (safe) | Single person with physical token + PIN |
| **OV cloud HSM** | Vendor cloud HSM | Team members with vendor account access |

### 3.2 Signing Process (Azure Artifact Signing)

```bash
# Prerequisites
dotnet tool install --global Azure.Sdk.Tools.TrustedSigningCli --prerelease

# Sign the installer
dotnet sign \
  -a "Titan POS Setup 1.0.8.exe" \
  -o "Titan POS Setup 1.0.8-signed.exe" \
  -e "https://trustedsigning.azure.net" \
  -a "AccountName" \
  -p "ProfileName" \
  -u "https://your-endpoint.certprofile.trustedsigning.azure.net/"
```

### 3.3 Signing Process (Traditional OV Certificate with SignTool)

```bash
# Prerequisites: Windows SDK (signtool.exe), USB token inserted, PIN entered
# Sign the installer
signtool sign /fd SHA256 /a /tr http://timestamp.digicert.com /td SHA256 ^
  "Titan POS Setup 1.0.8.exe"

# Verify signature
signtool verify /pa /all "Titan POS Setup 1.0.8.exe"
```

### 3.4 What Gets Signed

| Artifact | Must sign? | Notes |
|----------|-----------|-------|
| `Titan POS Setup x.y.z.exe` (NSIS) | **Yes** | Primary installer — most user-facing |
| `Titan POS x.y.z.exe` (Portable) | **Yes** | Direct download by power users |
| `Titan POS Setup x.y.z.exe.blockmap` | No | Electron-builder metadata; not user-executed |
| `Titan POS x.y.z.exe` (electron.exe) | No | Bundled inside installer; covered by installer signature |

### 3.5 Verification

```powershell
# After signing, verify:
Get-AuthenticodeSignature -FilePath "Titan POS Setup 1.0.8.exe"

# Expected output:
#   Status: Valid
#   SignerCertificate: CN=Titan Powerful Systems (or Azure Artifact Signing)
#   SignatureType: Authenticode
```

---

## 4. Release Artifact Naming Convention

| Artifact | Pattern | Example |
|----------|---------|---------|
| NSIS installer | `Titan POS Setup x.y.z.exe` | `Titan POS Setup 1.0.8.exe` |
| Portable EXE | `Titan POS Portable x.y.z.exe` | `Titan POS Portable 1.0.8.exe` |
| Blockmap (NSIS) | `Titan POS Setup x.y.z.exe.blockmap` | `Titan POS Setup 1.0.8.exe.blockmap` |
| Auto-update manifest | `latest.yml` | `latest.yml` |
| SHA-256 checksums | `Titan POS x.y.z.sha256` | `Titan POS 1.0.8.sha256` |
| Release notes | `RELEASE_NOTES-vx.y.z.md` | `RELEASE_NOTES-v1.0.8.md` |

**Note:** Portable EXE name changed from `Titan POS x.y.z.exe` to `Titan POS Portable x.y.z.exe` to disambiguate from the unpacked Electron executable when both appear in the same download directory.

---

## 5. Distribution Channels

| Channel | Use For | Auth Required | Notes |
|---------|---------|---------------|-------|
| **GitHub Releases** | Stable public releases | GitHub account | Auto-update reads `latest.yml` from here |
| **Private download link** | Pilot customers | Password/token | Google Drive, Dropbox, or self-hosted |
| **Customer-specific build** | Custom branding/settings | Only if needed | Same binary; customize config post-install |

### 5.1 GitHub Releases Setup

1. Repo: `fakih986-hue/lebanon-pos` (or `titan-pos-releases` for cleaner separation)
2. Tag format: `v1.0.8`
3. Release title: `Titan POS v1.0.8`
4. Assets to attach:
   - `Titan POS Setup 1.0.8.exe`
   - `Titan POS Portable 1.0.8.exe`
   - `latest.yml`
   - `Titan POS 1.0.8.sha256`
   - `RELEASE_NOTES-v1.0.8.md`
5. Set release as "Latest"

### 5.2 Pilot Distribution

- Provide signed (or unsigned, with warning) installer via private link
- Include clear SmartScreen bypass instructions:
  ```
  When Windows SmartScreen shows a warning, click "More info" →
  "Run anyway". This happens because the installer is new and hasn't
  been downloaded enough times to build reputation.
  ```
- Collect feedback before stable release

---

## 6. Auto-Update Policy

| Channel | Auto-update enabled? | Notes |
|---------|---------------------|-------|
| **Internal test builds** | No | Manual install only |
| **Pilot builds** | No | Deliberate — avoids unexpected upgrades during testing |
| **Stable production** | Yes, **only if signed** | Auto-update checks GitHub Releases on startup |

### 6.1 Rollback Procedure

1. Tag broken release as `v1.0.8-bad` in GitHub
2. Upload previous working release as latest
3. Update `latest.yml` to point to previous version
4. Existing clients will detect older version as "update" on next check

---

## 7. Remaining Gap: No Certificate Purchased

| Blocking item | Action needed | Owner | Timeline |
|---------------|---------------|-------|----------|
| Acquire Azure subscription (paid) | Sign up for pay-as-you-go Azure; ~$0 minimum spend | Business owner | 1 day |
| Set up Azure Artifact Signing | Create resource in Azure portal; configure RBAC roles | Developer | 2 hours |
| Install `dotnet sign` CLI | `dotnet tool install --global Azure.Sdk.Tools.TrustedSigningCli` | Developer | 10 min |
| Sign installer & verify | Run signing commands, verify with `Get-AuthenticodeSignature` | Developer | 30 min |
| Build signed release | Trigger build from clean CI | Developer | ~30 min |
| **Total** | | | **~2 days** |

**Until certificate is acquired:**
- All installers remain unsigned → SmartScreen warning on every download
- Pilot users must click "More info → Run anyway" to install
- Auto-update should remain disabled for unsigned builds
- Document the SmartScreen bypass in pilot instructions

---

## 8. Current Status (2026-07-10)

| Item | Status |
|------|--------|
| Installer signed? | **NO** |
| Certificate purchased? | **NO** |
| SmartScreen will block? | **YES** — "Windows protected your PC" warning on download + " unrecognized app" on launch |
| Workaround for testers | Click "More info → Run anyway" |
| Cost to resolve | $9.99/month (Azure) or $65–$400/year (OV cert) |
| Next step | Acquire Azure subscription + set up Artifact Signing, or purchase OV cert |
