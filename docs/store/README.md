# App Store & Google Play — what is ready and what you do next

Everything that does not need your developer accounts is done. When the accounts are active,
follow the steps below (about one evening of work) and send Claude the values marked **SEND**.

## Ready in the repo

| Item                                                                             | Where                                                                 |
| -------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| App id / package                                                                 | `kw.sanad.app` (iOS and Android)                                      |
| Version 1.0.0, build numbers managed by EAS                                      | `apps/mobile/app.json`, `apps/mobile/eas.json`                        |
| Build profiles: development, preview (internal testers), production              | `apps/mobile/eas.json`                                                |
| Arabic + English app name and permission texts                                   | `apps/mobile/locales/*.json`                                          |
| Apple privacy manifest (required-reason APIs, data collected)                    | `app.json` → `ios.privacyManifests`                                   |
| Store listing texts (Arabic + English, within character limits)                  | `listing-ar.md`, `listing-en.md`                                      |
| Screenshots: iPhone 6.9″ 1290×2796 and Android phone 1080×1920, Arabic + English | `screenshots/`                                                        |
| Google Play feature graphic 1024×500                                             | `screenshots/play-feature-graphic.png`                                |
| App icon 1024×1024                                                               | `apps/mobile/assets/icon.png`                                         |
| Apple "App Privacy" answers                                                      | `app-privacy-apple.md`                                                |
| Google "Data safety" answers                                                     | `data-safety-google.md`                                               |
| Review notes + review account                                                    | `review-notes.md`                                                     |
| Public pages the stores ask for (draft text for your lawyer)                     | dashboard `/p/privacy`, `/p/terms`, `/p/delete-account`, `/p/support` |

Regenerate screenshots after design changes: `python3 docs/store/tools/make_assets.py <raw> docs/store/screenshots`.

## Your steps

### Apple ($99/year)

1. Enrol at developer.apple.com (as an organisation if you have a company — needs a D-U-N-S number).
2. In App Store Connect → Apps → **+** → New App: platform iOS, name **سند - Sanad**, primary
   language Arabic, bundle ID `kw.sanad.app` (register it under Certificates, IDs & Profiles
   first), SKU `sanad-ios`.
3. **SEND**: your Apple ID email, the **Team ID** (Membership page) and the **App Store Connect
   app ID** (App Information → Apple ID, a number).

### Google ($25 once)

1. Create a Play Console developer account (organisation account recommended).
2. Create app: name **سند - Sanad**, default language Arabic, app, free.
3. Setup → API access → create a **service account** with "Release manager" access; download
   its JSON key. Keep it private — put it at `apps/mobile/secrets/google-play-service-account.json`
   on your PC (this folder is git-ignored). **SEND**: only confirm it is in place.
4. Google requires the very first upload to be done by hand: Claude will give you the `.aab` file.

### Expo (free)

1. On your PC in `apps/mobile`: `npx eas-cli login` (your Expo account), then `npx eas-cli init`.
   This adds the project id to `app.json` — commit it. **SEND**: nothing, Claude sees it in git.

### Hosting the public pages

The privacy policy URL must be public before review. Until production hosting (Phase 7) the
pages can be hosted anywhere public; the URLs in the listing are placeholders
(`https://sanad.kw/p/privacy` …). Have your lawyer review the draft text first [LEGAL].

## What Claude does after you send the values

Fill `eas.json`, build (`eas build --profile preview` for internal testing on your phone, then
`production`), set up TestFlight and Play internal testing, and prepare the submission. Real
store submission waits for Phase 7 (licensed payments), because Apple and Google reject apps
whose payments are simulated.
