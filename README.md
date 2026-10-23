# Whisper Wall — Anonymous Campus Confession Platform

Anonymous confessions, reactions, comments, trending posts, user-created
communities, user-created polls, and delete-your-own-content everywhere.

## What changed from your uploaded version

1. **Removed all seed/sample data.** `backend/db.js` previously inserted 6 fake
   confessions, 5 fake communities, and a poll with fabricated votes the first
   time the database file was empty. That block is gone — the schema is
   created, nothing is inserted. The database now starts completely empty and
   only ever contains what real users create through the UI.
2. **Communities can now be created and deleted by users.** Before, communities
   were fixed (only "join/leave" existed). Added `POST /api/communities` and
   `DELETE /api/communities/:id` (creator-only), plus a create form and
   Delete button in the Communities tab.
3. **Polls can now be created and deleted by users.** Before, there was a
   single hardcoded poll (vote-only). Added `POST /api/polls` and
   `DELETE /api/polls/:id` (creator-only), support for multiple simultaneous
   polls, a create form (question + dynamic options), and a Delete button.
   Confession delete already existed and is unchanged.
4. **Removed every `:hover` effect** across the stylesheet (cards, buttons,
   chips, nav, poll options — all of it).
5. **Removed the "bulletin board" look**: the corkboard pin dot on each card,
   the alternating card rotation, and the rotated stamp effects. Cards are now
   flat rectangles.
6. **Restructured Communities and Polls into real full-page tabs** (previously
   they just scrolled to a small sidebar preview) with their own create forms
   and full lists.
7. **Made the frontend deployable separately from the backend** — added
   `frontend/config.js` (one line: `API_BASE`) instead of hardcoding
   same-origin `/api` calls, and the backend no longer serves the frontend as
   static files (so its `Root Directory` on Render can just be `backend`).
8. **Configurable CORS** via a `CLIENT_ORIGIN` env var, instead of allowing
   every origin.

Everything else (reactions, comments, reporting, anonymous identity via
`localStorage`, category/tag filters, search, trending) is unchanged.

---

## Project structure

```
whisper-wall/
├── backend/
│   ├── server.js        # Express app + all API routes
│   ├── db.js             # SQLite schema only — no seed data
│   ├── package.json
│   └── .env.example
└── frontend/
    ├── index.html
    ├── style.css
    ├── script.js
    └── config.js         # <-- change API_BASE here after deploying the backend
```

---

## 1. Run it locally first

Requires **Node.js 22.5+** (needed for the built-in `node:sqlite` module — no
native compilation, no build tools, works the same on Windows/Mac/Linux).
Check with `node -v`.

### Backend
```bash
cd backend
cp .env.example .env
npm install
npm start
```
You should see `Whisper Wall API running on port 3000`. Visit
`http://localhost:3000` — you should see `{"status":"ok",...}`.

### Frontend
No build step needed. Easiest: install the **Live Server** VS Code extension,
right-click `frontend/index.html` → "Open with Live Server". Or just
double-click `index.html` to open it directly in a browser.

`frontend/config.js` should already point at your local backend:
```js
const API_BASE = "http://localhost:3000/api";
```

Test it: post a confession, create a community, create a poll, vote, and use
the Delete buttons. Confirm everything starts **empty** on first run.

---

## 2. Deploying separately (backend on Render, frontend on Netlify)

### 2a. Push to GitHub
```bash
cd whisper-wall
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/<your-username>/whisper-wall.git
git push -u origin main
```

### 2b. Deploy the backend on Render
1. Go to https://dashboard.render.com → **New → Web Service** → connect your repo.
2. Settings:
   - **Root Directory**: `backend`
   - **Environment**: Node
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
3. Environment Variables:
   - `CLIENT_ORIGIN` = the URL you'll deploy the frontend to (you can update
     this after step 2c — Render redeploys automatically on env var changes)
   - Don't set `PORT` — Render sets it automatically and the code already
     reads `process.env.PORT`.
4. Click **Create Web Service**. Once live, note the URL, e.g.
   `https://whisper-wall-backend.onrender.com`. Visit it — you should see
   `{"status":"ok",...}`.

**Important — read this before you deploy:** Render's free web service
instances have an **ephemeral filesystem**. This project stores data in a
SQLite file (`whisperwall.db`) on disk, which means:
- Every time the free service redeploys or restarts (including automatic
  restarts after inactivity), **the database file is wiped and you start
  empty again.**
- This is a completely different (and correct) kind of "empty" than the seed
  data problem you started with — but if you want data to actually persist
  between visits/restarts, you have two options:
  - **Option A (recommended, small cost):** upgrade the Render service to a
    paid instance type (Starter, $7/mo or up) and attach a **Render Disk**
    (Render dashboard → your service → **Disks** → Add Disk, mount path
    `/opt/render/project/src/backend`, e.g. 1GB). This gives the SQLite file
    a persistent home across restarts and deploys.
  - **Option B (free, but data resets):** keep the free tier as-is. Fine for
    a live class demo where you populate the wall yourself right before
    presenting; not fine if you need weeks of accumulated posts to survive.

### 2c. Deploy the frontend on Netlify
1. Edit `frontend/config.js` and set it to your Render URL:
   ```js
   const API_BASE = "https://whisper-wall-backend.onrender.com/api";
   ```
2. Commit and push that change.
3. Go to https://app.netlify.com → **Add new site → Import an existing project** → connect the same repo.
4. Settings:
   - **Base directory**: `frontend`
   - **Build command**: leave blank
   - **Publish directory**: `frontend`
5. Deploy. You'll get a URL like `https://whisper-wall.netlify.app`.

### 2d. Connect the two (CORS)
Back on Render → your backend service → Environment tab → set:
```
CLIENT_ORIGIN=https://whisper-wall.netlify.app
```
Save — Render redeploys automatically. Without this, the browser blocks all
requests from your frontend to your backend.

### 2e. Final test
Open your Netlify URL, create a confession, a community, and a poll. If the
free Render instance was asleep, the first request can take ~30–60 seconds —
that's normal, not a bug.

---

## 3. Alternative frontend hosts
Any static host works the same way — set `API_BASE` in `config.js` first,
then update `CLIENT_ORIGIN` on the backend to match:
- **Render Static Site** (root directory `frontend`)
- **Vercel** (root directory `frontend`, framework preset "Other")
- **GitHub Pages** (deploy from the `frontend` folder)

---

## 4. Common errors and fixes

| Symptom | Fix |
|---|---|
| Frontend shows nothing / network error in console | Check `config.js` — is `API_BASE` correct and does it end in `/api`? |
| CORS error in browser console | `CLIENT_ORIGIN` on Render doesn't exactly match your frontend URL (no trailing slash). Update it and let Render redeploy. |
| Data disappears after a while on Render | Expected on the free tier — see the persistent-disk note in section 2b. |
| "Delete" button does nothing / 403 error | You can only delete confessions/communities/polls **you** created in **this browser** (tracked via `localStorage`). Clearing site data forgets what's "yours". |
| Render free instance slow on first request | Normal — free tier "spins down" after inactivity, wakes in ~30–60s. |
| `node:sqlite` errors locally | You need Node **22.5+**. Check with `node -v` and upgrade if needed. |

---

## API overview

| Method | Route | Description |
|---|---|---|
| GET | `/api/confessions` | List confessions (filters: `category`, `tag`, `search`, `sort=new\|top`) |
| POST | `/api/confessions` | Create a confession |
| DELETE | `/api/confessions/:id` | Delete your own confession |
| POST | `/api/confessions/:id/react` | Add/change/remove your reaction |
| POST | `/api/confessions/:id/comments` | Add a comment |
| POST | `/api/confessions/:id/report` | Flag a confession |
| GET | `/api/tags` | Distinct tags in use |
| GET | `/api/trending` | Top 4 confessions by reactions |
| GET | `/api/communities` | List communities + joined/owner state |
| POST | `/api/communities` | Create a community |
| DELETE | `/api/communities/:id` | Delete a community you created |
| POST | `/api/communities/:id/toggle` | Join / leave a community |
| GET | `/api/polls` | List all polls + options + your vote state |
| POST | `/api/polls` | Create a poll (question + 2+ options) |
| DELETE | `/api/polls/:id` | Delete a poll you created |
| POST | `/api/polls/:id/vote` | Vote once in a poll |

## How anonymous delete works

There are no user accounts. The first time your browser loads the app it
generates a random ID and stores it in `localStorage`. That ID travels with
every confession, community, poll, reaction, comment, and vote you make. The
server only allows a **Delete** button to work on items whose stored owner ID
matches yours. Clearing your browser's site data "forgets" which items were
yours.
