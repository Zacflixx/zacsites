# Isaac — apps and encrypted synced vault

The landing page and all app links open normally. Only the private vault requires a passphrase. The same passphrase decrypts your vault and authorizes syncing; there is no separate account or site-wide login.

## Netlify setup (once)

Connect Netlify to **Zacflixx/zacsites**, branch **main**. `netlify.toml` now sets build command **npm run build**, publish directory **public**, Functions directory **netlify/functions**, and Node **22**. Netlify installs the pinned `@netlify/blobs` dependency automatically. Do not use the older static-only ZIP for this version: it does not contain the sync backend.

1. Deploy this repository to Netlify.
2. Open **Private vault**. If sync has not been activated, the page shows **One-time sync setup**.
3. Enter and confirm a strong master passphrase (12+ characters). If you already have a local vault, use its existing passphrase so it can be migrated. Select **Generate Netlify setting**.
4. Copy the generated value. In your Netlify project's environment variables, add **ISAAC_VAULT_AUTH** with this value. Give it **Functions** scope and **Production** context. If scope selection is unavailable, use all scopes. Do not add it to this repo. This is a verifier derived in your browser; your actual passphrase is never sent to the server.
5. Redeploy the site to apply the variable. Return to the vault and select **Check connection**, then unlock with the same passphrase.

On another phone, browser, or computer: open the same Netlify site → Private vault → enter that passphrase. The encrypted vault loads automatically. Changes save to the cloud immediately; an unlocked browser checks for other-browser changes every 30 seconds, and **Sync now** refreshes on demand. Reopening a locked vault always fetches the latest copy. Internet access is required. App order and app edits still save per browser.

Sync uses Netlify Blobs and Functions within your existing Netlify project; no separate database account, browser API key, or Netlify access token is needed. Usage counts against your Netlify plan. Unconfigured endpoints cannot read or write a vault. Set the verifier in the Production context only so deploy previews do not gain production-vault access. Moving to a different Netlify project does not move its vault storage automatically; keep an encrypted backup for that case.

## Existing vaults and backups

When no cloud vault exists, the first successful unlock migrates an older vault found in that browser (using its original passphrase). It uploads only the encrypted contents and keeps the original local copy untouched. If a cloud vault already exists, it is authoritative; local vaults are not silently merged.

**Export backup** is optional protection against accidental deletion or losing the Netlify project. You do not need it to move between browsers. **Restore**, available after unlocking, decrypts a chosen backup locally and re-encrypts its contents with the current vault key before syncing. It replaces the shared contents after confirmation, and does not change the current vault passphrase.

Never commit vault backups, real passwords, private notes, master passphrases, or the ISAAC_VAULT_AUTH value. There is no master-passphrase recovery. Do not regenerate the Netlify setting with a different passphrase for an existing vault; this does not re-encrypt its data.

## Security and behavior

- AES-256-GCM with a fresh random 96-bit nonce for every save; PBKDF2-HMAC-SHA-256 with 600,000 iterations and random 128-bit salt for the encryption key.
- A separate, purpose-specific PBKDF2 derivation generates the sync credential. Only its SHA-256 verifier is configured server-side. Requests use the derived credential in an Authorization header over HTTPS. Neither the encryption key nor master passphrase is uploaded.
- The backend only exposes encrypted envelopes after authorization. It uses strong reads and conditional writes with ETags; stale saves are rejected instead of overwriting newer changes. The editor retains an unsaved entry when a conflict or connection failure occurs. Close the editor, sync the latest copy, and reapply your change. Saves do not silently fall back to a separate local-only vault.
- Encrypted envelopes are limited to 2 MB, with strict format validation and a function rate limit. Responses disable caching. Passphrases, tokens, decrypted entries, and derived keys remain in memory and are cleared from app state/DOM on locking. JavaScript cannot guarantee physical memory erasure.
- The vault locks after five minutes idle and when leaving the tab. Private content is rendered as text. The vault has no third-party scripts, analytics, or service worker; its CSP allows same-origin sync only. Clipboard copies remain in the clipboard until replaced.

This is custom software, not an independently audited password manager. A compromised browser/device, malicious extension, or modified site code while the vault is unlocked can access contents. Use an established password manager for high-value credentials.

## Development

`npm install`, then `npm test` runs encryption and sync endpoint tests. Use Netlify Dev for the backend (with ISAAC_VAULT_AUTH in a local, uncommitted `.env`). A plain static file server only previews the landing page; vault sync needs the Function. Netlify Dev uses a separate local Blobs sandbox. Static public files are under `public/`; only that directory is published. Function code and tests live outside the public directory.
