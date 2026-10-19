# IT Ops Hub — deploy guide

Ek app: **Network Planner Pro** (IPv4 VLSM + naya **IPv6 Plan**), **CMD Notes** (Google Sheet + naya **View by**), **IT Ops Center** (Lab Manager, Diagram Builder, Work Tracker hata diye).

## Files
- `index.html` — hub (sidebar, search, **app lock**, **PWA install**, **Google Sheet link**)
- `modules/planner.html`, `modules/cmdnotes.html`, `modules/ops.html`
- `manifest.json`, `sw.js`, `icons/` — PWA
- `apps-script/Code.gs` — Google Sheet backend (login + users tab ke saath)
- `.github/workflows/static.yml` — GitHub Pages deploy

## GitHub Pages
1. Naya repo banao (ya purane me) → ye saari files upload karo (folder structure same rakho).
2. Settings → Pages → Source: **GitHub Actions**. Push karte hi deploy.
3. Site HTTPS par kholo (PWA, fingerprint aur clipboard ke liye zaroori).

## Google Sheet
1. Sheet → Extensions → Apps Script → `apps-script/Code.gs` paste, `SHEET_ID` badlo.
2. (Optional login) function `setupUsers` ▶ Run → sheet me `_Users` tab banta hai (`user | pin | role | active`). Admin ka PIN badlo. `_Users` tab delete = login band.
3. Deploy → New deployment → Web app → Execute as **Me**, Access **Anyone** → URL copy.
4. App me topbar ka **Sheet link** dabao → URL paste → Test → Save.
5. Code.gs badalne par: Deploy → Manage deployments → ✏️ → **New version**.

## App lock
Pehli baar PIN set karne ko poochta hai (Skip kar sakte ho). Settings me: PIN badlo, fingerprint on/off, auto-lock time. Lock sirf is device ka client-side lock hai; asli data-suraksha ke liye Sheet login (`_Users`) use karo. PIN bhool gaye: lock screen par "Forgot PIN?".

## PWA install
Chrome/Edge: topbar ka **Install** button. iPhone: Safari → Share → Add to Home Screen (banner dikhta hai). Naya release: `sw.js` me `VERSION` badlo.
