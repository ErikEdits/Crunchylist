# Watchlog

A private, self-hostable, **temporary** viewer for your anime watch history.

Anyone can upload their exported history, get a clean dark-themed watchlist +
timeline with auto-fetched cover art, and share nothing permanently: uploaded
files are **automatically deleted from the server after 20 minutes** (configurable).
Once that window passes the link stops working and the file has to be uploaded
again.

- **Upload page** — drag & drop a `data.js` or `.json` export.
- **Viewer** — searchable/sortable grid, episode timeline, per-series detail
  modal, cover art from AniList with a Jikan/MyAnimeList fallback (cached in the
  visitor's own browser).
- **Ephemeral by design** — each upload lives at a random URL and is swept off
  disk after the retention window. A restart never leaks old uploads.
- **One config file** for your domain, port, retention window, and size limit.

---

## Quick start (local)

Requires Node.js 18+.

```bash
npm install
npm start
# open http://localhost:3000
```

Try it with the bundled example: on the upload page, select
[`samples/sample-data.json`](samples/sample-data.json).

---

## Configuration

All settings live in [`config.js`](config.js). Each value can also be set with an
environment variable (handy for Docker/systemd). The only value you normally
need to change for a real deployment is `baseUrl`.

| Setting            | Env var             | Default                 | Meaning                                              |
| ------------------ | ------------------- | ----------------------- | ---------------------------------------------------- |
| `baseUrl`          | `BASE_URL`          | `http://localhost:3000` | Public URL of your site (used for share links)       |
| `host`             | `HOST`              | `0.0.0.0`               | Interface to bind                                    |
| `port`             | `PORT`              | `3000`                  | Internal listening port                              |
| `retentionMinutes` | `RETENTION_MINUTES` | `20`                    | Minutes an upload stays available before deletion    |
| `maxUploadMb`      | `MAX_UPLOAD_MB`     | `15`                    | Max upload size in MB                                 |
| `uploadDir`        | `UPLOAD_DIR`        | `server/uploads`        | Temp storage location (auto-created, auto-cleaned)   |

---

## Buy a domain and put it online

1. **Buy a domain** at any registrar (Namecheap, Cloudflare, Porkbun, …).
2. **Point DNS** — add an `A` record for your domain (e.g. `watchlog.example.com`)
   pointing at your server's public IP.
3. **Set your URL** — edit `config.js` (or set `BASE_URL`) to
   `https://watchlog.example.com`. This is the only value that must match your
   domain.
4. **Run it behind a reverse proxy with HTTPS.** An nginx example is in
   [`deploy/nginx.conf.example`](deploy/nginx.conf.example); get a free TLS cert
   with `certbot --nginx -d watchlog.example.com`.
5. **Keep it running** — either the systemd unit in
   [`deploy/watchlog.service`](deploy/watchlog.service), or Docker below.

### Docker

```bash
# edit BASE_URL in docker-compose.yml first
docker compose up -d --build
```

---

## Export data format

An upload is either a `.json` file or a `data.js` file that assigns a global
`APP_DATA`. The shape is:

```jsonc
{
  "generatedAt": "2026-08-17T10:00:00.000Z",
  "series": [
    {
      "id": "s1",
      "title": "Frieren: Beyond Journey's End",
      "episodeCount": 28,
      "seasonCount": 1,
      "firstWatched": "2026-01-05T20:10:00.000Z",
      "lastWatched": "2026-03-11T22:40:00.000Z"
    }
  ],
  "history": [
    {
      "sid": "s1",                         // series id
      "t": "Frieren: Beyond Journey's End",// title (denormalized for the timeline)
      "sn": 1,                             // season number (nullable)
      "en": 28,                            // episode number
      "et": "The Magic of Reproducing an Image", // episode title (optional)
      "wa": "2026-03-11T22:40:00.000Z",    // watched-at (ISO)
      "fw": true                           // fully watched? (false = partial)
    }
  ]
}
```

`data.js` variant:

```js
window.APP_DATA = { generatedAt: "…", series: [ … ], history: [ … ] };
```

See [`samples/sample-data.json`](samples/sample-data.json) for a working example.

> `.js` uploads are evaluated in an isolated VM context with no Node globals and
> a short timeout, then re-serialized to plain JSON so nothing executable is
> stored or served.

---

## How the temporary storage works

- Each upload is written to `uploadDir` under a random id and tracked with an
  expiry timestamp.
- A background sweep (every minute) deletes anything past its retention window.
- On startup the registry is rebuilt from disk using each file's modified time,
  so restarts still enforce expiry and never leak old uploads.
- Requesting an expired link returns HTTP `410` and a friendly "upload again"
  page.

---

## Project layout

```
config.js              # <-- your settings (domain, port, retention, size)
package.json
Dockerfile / docker-compose.yml
deploy/                # nginx + systemd examples
public/                # frontend
  index.html           # upload landing page
  upload.js
  viewer.html          # the watchlog viewer (APP_DATA injected per request)
  app.js
  styles.css
  expired.html
server/
  server.js            # Express app: static, /upload, /w/:id viewer
  lib/parseData.js     # parse & validate uploads (.json / data.js)
  lib/store.js         # ephemeral on-disk store + expiry sweeper
samples/sample-data.json
```

---

## License

MIT — see [`LICENSE`](LICENSE).
