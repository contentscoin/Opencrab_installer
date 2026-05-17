# Signing and Notarization Guide

This repository currently builds unsigned installers. Use this guide when you are ready to attach publisher identity to the macOS and Windows release assets.

Official references:

- Apple notarization overview: https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution
- Apple custom notarization workflow: https://developer.apple.com/documentation/xcode/notarizing_macos_software_before_distribution/customizing_the_notarization_workflow
- Electron code signing overview: https://www.electronjs.org/docs/latest/tutorial/code-signing
- electron-builder macOS signing: https://www.electron.build/code-signing-mac
- electron-builder Windows signing: https://www.electron.build/code-signing-win
- Microsoft SignTool: https://learn.microsoft.com/en-us/windows/win32/seccrypto/signtool
- Microsoft Artifact/Trusted Signing quickstart: https://learn.microsoft.com/en-us/azure/trusted-signing/quickstart

## macOS Developer ID Signing and Notarization

Requirements:

- Active Apple Developer Program membership.
- macOS build machine or GitHub Actions macOS runner.
- Xcode or Command Line Tools with `notarytool`.
- `Developer ID Application` certificate for direct distribution outside the Mac App Store.
- App Store Connect API key or Apple ID app-specific password for notarization.

Recommended GitHub secrets:

- `CSC_LINK`: base64-encoded `.p12` containing the Developer ID Application certificate and private key.
- `CSC_KEY_PASSWORD`: password for the `.p12`.
- `APPLE_API_KEY`: contents of the App Store Connect `AuthKey_XXXXXXXXXX.p8` file.
- `APPLE_API_KEY_ID`: App Store Connect API key ID.
- `APPLE_API_ISSUER`: App Store Connect issuer ID.

Alternative notarization secrets:

- `APPLE_ID`
- `APPLE_APP_SPECIFIC_PASSWORD`
- `APPLE_TEAM_ID`

Suggested `apps/desktop/package.json` build addition when secrets are ready:

```json
{
  "build": {
    "mac": {
      "target": ["dmg", "zip"],
      "category": "public.app-category.developer-tools",
      "hardenedRuntime": true,
      "gatekeeperAssess": false,
      "notarize": true
    }
  }
}
```

Build:

```bash
npm --prefix apps/desktop run dist:mac
```

Manual validation on macOS:

```bash
codesign --verify --deep --strict --verbose=2 "apps/desktop/dist/mac/OpenCrab.app"
spctl --assess --type execute --verbose=4 "apps/desktop/dist/mac/OpenCrab.app"
xcrun stapler validate "apps/desktop/dist/OpenCrab-1.0.4.dmg"
```

Manual notarization fallback:

```bash
xcrun notarytool store-credentials opencrab-notary \
  --apple-id "$APPLE_ID" \
  --team-id "$APPLE_TEAM_ID" \
  --password "$APPLE_APP_SPECIFIC_PASSWORD"

xcrun notarytool submit "apps/desktop/dist/OpenCrab-1.0.4.dmg" \
  --keychain-profile opencrab-notary \
  --wait

xcrun stapler staple "apps/desktop/dist/OpenCrab-1.0.4.dmg"
xcrun stapler validate "apps/desktop/dist/OpenCrab-1.0.4.dmg"
```

Notes:

- Use Developer ID certificates for direct downloads. Mac App Store certificates are a different distribution path.
- Apple no longer accepts `altool` notarization uploads; use `notarytool`.
- Do not commit Apple credentials, `.p12` files, API keys, or app-specific passwords.

## Windows Code Signing

Windows does not have Apple-style notarization. The equivalent release step is Authenticode code signing plus trusted timestamping. Signing identifies the publisher and helps SmartScreen reputation build over time.

### Option A: Microsoft Artifact/Trusted Signing

This is the best CI-friendly path because the private signing material stays in Microsoft's managed signing service.

Requirements:

- Azure tenant.
- Artifact Signing account.
- Completed identity validation.
- Public Trust certificate profile.
- App registration or federated identity that can sign with the certificate profile.

Suggested GitHub secrets:

- `AZURE_TENANT_ID`
- `AZURE_CLIENT_ID`
- `AZURE_CLIENT_SECRET`

Suggested `apps/desktop/package.json` build addition:

```json
{
  "build": {
    "win": {
      "target": "nsis",
      "icon": "../../logo.png",
      "azureSignOptions": {
        "publisherName": "YOUR_PUBLISHER_CN",
        "endpoint": "https://YOUR_REGION.codesigning.azure.net",
        "certificateProfileName": "YOUR_CERTIFICATE_PROFILE",
        "codeSigningAccountName": "YOUR_SIGNING_ACCOUNT"
      }
    }
  }
}
```

Build:

```powershell
npm --prefix apps\desktop run dist:win
```

Verify:

```powershell
signtool verify /pa /v "apps\desktop\dist\OpenCrab Setup 1.0.4.exe"
```

### Option B: Traditional EV or Cloud Code Signing Certificate

Requirements:

- EV or cloud-backed code signing certificate from a trusted CA.
- Signing tool from the CA, or a local certificate store integration that `signtool` can use.
- RFC 3161 timestamp server.

Manual signing example:

```powershell
signtool sign /a /fd SHA256 /tr http://timestamp.digicert.com /td SHA256 `
  /d "OpenCrab Desktop" `
  "apps\desktop\dist\OpenCrab Setup 1.0.4.exe"

signtool verify /pa /v "apps\desktop\dist\OpenCrab Setup 1.0.4.exe"
```

Notes:

- Always timestamp signed releases. Without a timestamp, signatures can become invalid after certificate expiration.
- Use SHA256 for file digest and timestamp digest.
- Do not commit PFX files, token credentials, certificate passwords, or vendor API keys.
