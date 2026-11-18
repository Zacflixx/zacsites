# Isaac — personal launchpad

A static landing page with eight themed app cards, app editing/reordering, and a local encrypted vault for passwords and grouped text notes.

## Netlify from GitHub

1. In Netlify, choose **Add new project → Import an existing project → GitHub**.
2. Select **Zacflixx/zacsites** and branch **main**.
3. Leave the build command empty. Publish directory is **.** (also set in `netlify.toml`).
4. Deploy. No environment variables or paid database are needed. Later commits to main trigger a new deployment.

Use the final HTTPS address consistently. Different Netlify previews, custom domains, browsers, profiles, and devices have separate browser storage.

## Apps

Choose **Edit apps** to edit app names/links or use the arrows to change their order. These choices save in this browser. App branding stays attached when cards move. To change the defaults for everyone, edit the `defaults` array in `index.html` and its order; keep each app's `theme` index consistent if you reorder the source array.

## Vault

Open **Private vault**, choose a strong master passphrase (12+ characters), and add passwords or notes. Use **Group** to organize related text entries. Passwords can be revealed or copied; notes and usernames can be copied too.

All entry contents are encrypted before browser storage using AES-256-GCM, a random 96-bit nonce for every save, and a 256-bit key derived with PBKDF2-HMAC-SHA-256 (600,000 iterations, random 128-bit salt). The master passphrase and derived key are not persisted. The vault locks after five minutes idle, on leaving the tab, and on relevant changes in another tab. Entry text is rendered as text, never HTML. Netlify applies restrictive headers to `vault.html`. There are no analytics, external scripts, or vault network requests.

**Export backup** downloads an encrypted JSON file. Export after important changes and before clearing browser storage or changing domains. Keep that file outside the repo, for example in your personal backup storage. **Restore** asks for the backup's passphrase and confirms before replacing an existing vault. A backup is a snapshot; it does not sync changes between devices.

There is no recovery for a forgotten master passphrase. Clearing browser data can erase the vault. No passwords, private notes, master passphrase, keys, or vault backups belong in this repository or Netlify environment variables. The JSON is created when you use the vault; no shared vault JSON is deployed.

This is a small custom vault, not an independently audited password manager. A compromised browser/device, malicious extensions, or modified site code while the vault is unlocked can access its contents. Use an established password manager for high-value credentials. Clipboard copies stay in the clipboard until replaced.

## Local preview / tests

Run `python3 -m http.server 8080` in this directory and open `http://localhost:8080`. The vault requires HTTPS or localhost; do not open `vault.html` as a local file.

Run `node --test tests/crypto.test.mjs` to verify encryption, wrong-passphrase/tamper rejection, format validation, and fresh nonces. No npm install is required (Node 20+).
