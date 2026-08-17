(function () {
  "use strict";

  const SERIES = APP_DATA.series;
  const HISTORY = APP_DATA.history;

  // ---------- Cover image cache (localStorage) ----------
  // v2: multi-source (AniList + Jikan fallback), so bump the key to drop old
  // permanently-failed (null) entries from v1.
  const IMG_CACHE_KEY = "watchtracker_cover_cache_v2";
  let imgCache = {};
  try {
    imgCache = JSON.parse(localStorage.getItem(IMG_CACHE_KEY) || "{}");
  } catch (e) { imgCache = {}; }

  function saveImgCache() {
    try { localStorage.setItem(IMG_CACHE_KEY, JSON.stringify(imgCache)); } catch (e) {}
  }

  function simplifyTitle(title) {
    // Strip subtitle/annotation parts that often don't exist in DB search
    // e.g. "Re:ZERO -Starting Life in Another World-" -> "Re:ZERO"
    return title
      .replace(/\s*[-–—]\s*.+$/, "")
      .replace(/\s*[:：].+$/, "")
      .replace(/\s*\(.*\)\s*$/, "")
      .trim();
  }

  // Registry of subscribers waiting for a title's cover to resolve, so cards
  // rendered before resolution finishes still update once the batch job
  // comes back with an answer.
  const waiters = new Map(); // key -> [callback,...]
  function notify(key, url) {
    const cbs = waiters.get(key);
    if (cbs) {
      cbs.forEach((cb) => cb(url));
      waiters.delete(key);
    }
  }

  function getCover(title, onDone) {
    const key = title.trim().toLowerCase();
    if (imgCache[key] !== undefined) {
      onDone(imgCache[key]);
      return;
    }
    if (!waiters.has(key)) waiters.set(key, []);
    waiters.get(key).push(onDone);
  }

  function setCover(title, url) {
    const key = title.trim().toLowerCase();
    imgCache[key] = url;
    notify(key, url);
  }

  // ---------- AniList batch resolver (primary source) ----------
  // AniList's search is far more lenient with localized/alternate titles
  // than Jikan/MAL, and lets us resolve many titles per HTTP request.
  async function resolveBatchAniList(titles) {
    if (!titles.length) return;
    const variables = {};
    const parts = titles.map((t, i) => {
      variables["s" + i] = t;
      return `m${i}: Media(search: $s${i}, type: ANIME) { title { romaji english } coverImage { large extraLarge } }`;
    });
    const varDefs = titles.map((_, i) => `$s${i}: String`).join(", ");
    const query = `query (${varDefs}) { ${parts.join(" ")} }`;

    try {
      const res = await fetch("https://graphql.anilist.co", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ query, variables }),
      });
      if (res.status === 429) {
        // AniList is currently rate-limited to 30 req/min; the browser often
        // can't read the Retry-After header cross-origin, so fall back to a
        // conservative fixed wait long enough for the 1-minute window to reset.
        let waitMs = 65000;
        const ra = res.headers.get("retry-after");
        if (ra && !isNaN(parseInt(ra, 10))) waitMs = (parseInt(ra, 10) + 2) * 1000;
        await sleep(waitMs);
        return resolveBatchAniList(titles);
      }
      if (!res.ok) return;
      const json = await res.json();
      if (json.errors) return; // query/complexity error - let fallback passes handle these titles
      const data = json.data || {};
      titles.forEach((t, i) => {
        const media = data["m" + i];
        const url = media && media.coverImage ? (media.coverImage.large || media.coverImage.extraLarge) : null;
        if (url) setCover(t, url);
      });
    } catch (e) {
      /* swallow, leftovers get picked up by Jikan fallback */
    }
  }

  function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

  // ---------- Jikan single-title fallback ----------
  async function resolveJikan(title) {
    try {
      const res = await fetch("https://api.jikan.moe/v4/anime?q=" + encodeURIComponent(title) + "&limit=1");
      if (res.status === 429) {
        await sleep(1500);
        return resolveJikan(title);
      }
      if (!res.ok) return null;
      const data = await res.json();
      const first = data && data.data && data.data[0];
      if (first && first.images) {
        return (first.images.webp && first.images.webp.image_url) || (first.images.jpg && first.images.jpg.image_url) || null;
      }
    } catch (e) { /* ignore */ }
    return null;
  }

  const progressEl = () => document.getElementById("cover-progress");

  async function resolveAllCovers(titles) {
    const unresolved = titles.filter((t) => imgCache[t.trim().toLowerCase()] === undefined);
    if (!unresolved.length) return;

    // AniList is currently rate-limited to 30 requests/minute (degraded
    // state) - space requests at least 2.1s apart and use larger batches
    // to keep the total number of round trips low.
    const BATCH = 25;
    const ANILIST_GAP = 2100;
    let done = 0;
    updateProgress(done, unresolved.length);

    // Pass 1: AniList, full titles, batched.
    for (let i = 0; i < unresolved.length; i += BATCH) {
      const batch = unresolved.slice(i, i + BATCH);
      await resolveBatchAniList(batch);
      done += batch.length;
      updateProgress(Math.min(done, unresolved.length), unresolved.length);
      await sleep(ANILIST_GAP);
    }

    // Pass 2: AniList again with simplified titles, only for still-missing ones.
    const stillMissing1 = unresolved.filter((t) => imgCache[t.trim().toLowerCase()] === undefined);
    for (let i = 0; i < stillMissing1.length; i += BATCH) {
      const batch = stillMissing1.slice(i, i + BATCH).map(simplifyTitle);
      const original = stillMissing1.slice(i, i + BATCH);
      const results = {};
      await resolveBatchAniListMap(batch, results);
      original.forEach((orig, idx) => {
        const url = results[idx];
        if (url) setCover(orig, url);
      });
      await sleep(ANILIST_GAP);
    }

    // Pass 3: Jikan fallback, sequential, only for what's still missing.
    const stillMissing2 = unresolved.filter((t) => imgCache[t.trim().toLowerCase()] === undefined);
    for (const t of stillMissing2) {
      const url = await resolveJikan(t) || await resolveJikan(simplifyTitle(t));
      setCover(t, url);
      await sleep(500);
    }

    saveImgCache();
    updateProgress(unresolved.length, unresolved.length, true);
  }

  // Variant of the batch resolver that returns results by index instead of
  // writing straight to cache (used for the simplified-title retry pass so
  // we can map back to the original, un-simplified title as the cache key).
  async function resolveBatchAniListMap(titles, outMap) {
    if (!titles.length) return;
    const variables = {};
    const parts = titles.map((t, i) => {
      variables["s" + i] = t;
      return `m${i}: Media(search: $s${i}, type: ANIME) { coverImage { large extraLarge } }`;
    });
    const varDefs = titles.map((_, i) => `$s${i}: String`).join(", ");
    const query = `query (${varDefs}) { ${parts.join(" ")} }`;
    try {
      const res = await fetch("https://graphql.anilist.co", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ query, variables }),
      });
      if (res.status === 429) {
        let waitMs = 65000;
        const ra = res.headers.get("retry-after");
        if (ra && !isNaN(parseInt(ra, 10))) waitMs = (parseInt(ra, 10) + 2) * 1000;
        await sleep(waitMs);
        return resolveBatchAniListMap(titles, outMap);
      }
      if (!res.ok) return;
      const json = await res.json();
      if (json.errors) return;
      const data = json.data || {};
      titles.forEach((_, i) => {
        const media = data["m" + i];
        const url = media && media.coverImage ? (media.coverImage.large || media.coverImage.extraLarge) : null;
        if (url) outMap[i] = url;
      });
    } catch (e) { /* ignore */ }
  }

  function updateProgress(done, total, finished) {
    const el = progressEl();
    if (!el) return;
    if (finished || done >= total) {
      el.textContent = "";
      el.style.display = "none";
      return;
    }
    el.style.display = "inline";
    el.textContent = `Lade Cover… ${done}/${total} (API-Limit, kann 1-2 Min. dauern)`;
  }

  function attachLazyImage(container, imgEl, skelEl, fallbackEl, title) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          io.disconnect();
          getCover(title, (url) => {
            if (url) {
              imgEl.src = url;
              imgEl.onload = () => {
                imgEl.classList.add("loaded");
                if (skelEl) skelEl.remove();
              };
              imgEl.onerror = () => {
                if (skelEl) skelEl.remove();
                if (fallbackEl) fallbackEl.style.display = "flex";
              };
            } else {
              if (skelEl) skelEl.remove();
              if (fallbackEl) fallbackEl.style.display = "flex";
            }
          });
        }
      });
    }, { rootMargin: "300px" });
    io.observe(container);
  }

  function retryMissingCovers() {
    const allTitles = SERIES.map((s) => s.title);
    let cleared = 0;
    allTitles.forEach((t) => {
      const key = t.trim().toLowerCase();
      if (imgCache[key] === null) {
        delete imgCache[key];
        cleared++;
      }
    });
    saveImgCache();
    if (cleared === 0) return;
    resolveAllCovers(allTitles).then(() => {
      renderGrid();
      renderHistory(true);
    });
  }

  // ---------- Helpers ----------
  function fmtDate(iso) {
    const d = new Date(iso);
    return d.toLocaleDateString("de-DE", { year: "numeric", month: "short", day: "2-digit" });
  }
  function fmtDateTime(iso) {
    const d = new Date(iso);
    return d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
  }
  function dayKey(iso) {
    return iso.slice(0, 10);
  }
  function initials(title) {
    return title
      .split(/\s+/)
      .filter((w) => w.length)
      .slice(0, 3)
      .map((w) => w[0])
      .join("")
      .toUpperCase();
  }

  // Rough watch-time estimate: 24 min per fully-watched episode
  const totalMinutes = HISTORY.filter((h) => h.fw).length * 24;
  const totalHours = Math.round(totalMinutes / 60);

  document.getElementById("stat-series").textContent = SERIES.length;
  document.getElementById("stat-episodes").textContent = HISTORY.filter((h) => h.fw).length;
  document.getElementById("stat-hours").textContent = totalHours.toLocaleString("de-DE");
  document.getElementById("stat-updated").textContent = fmtDate(APP_DATA.generatedAt);

  // ---------- Watchlist rendering ----------
  const grid = document.getElementById("grid");
  const searchInput = document.getElementById("search");
  const sortSelect = document.getElementById("sort");
  const countPill = document.getElementById("count-pill");

  function currentSeriesList() {
    const q = searchInput.value.trim().toLowerCase();
    let list = SERIES.filter((s) => !q || s.title.toLowerCase().includes(q));
    const sortMode = sortSelect.value;
    if (sortMode === "title") {
      list = list.slice().sort((a, b) => a.title.localeCompare(b.title));
    } else if (sortMode === "recent") {
      list = list.slice().sort((a, b) => new Date(b.lastWatched) - new Date(a.lastWatched));
    } else if (sortMode === "episodes") {
      list = list.slice().sort((a, b) => b.episodeCount - a.episodeCount);
    }
    return list;
  }

  function renderGrid() {
    const list = currentSeriesList();
    countPill.textContent = list.length + " Anime";
    grid.innerHTML = "";
    if (!list.length) {
      grid.innerHTML = '<div class="empty">Keine Treffer.</div>';
      return;
    }
    const frag = document.createDocumentFragment();
    list.forEach((s) => {
      const card = document.createElement("div");
      card.className = "card";
      card.innerHTML = `
        <div class="poster-wrap">
          <div class="skel"></div>
          <img alt="${escapeHtml(s.title)}" />
          <div class="fallback" style="display:none">${escapeHtml(initials(s.title))}</div>
          <div class="ep-badge">${s.episodeCount} Ep.</div>
        </div>
        <div class="card-info">
          <p class="card-title">${escapeHtml(s.title)}</p>
          <div class="card-meta">${fmtDate(s.lastWatched)}</div>
        </div>
      `;
      const posterWrap = card.querySelector(".poster-wrap");
      const img = card.querySelector("img");
      const skel = card.querySelector(".skel");
      const fallback = card.querySelector(".fallback");
      attachLazyImage(posterWrap, img, skel, fallback, s.title);
      card.addEventListener("click", () => openModal(s));
      frag.appendChild(card);
    });
    grid.appendChild(frag);
  }

  function escapeHtml(str) {
    return str.replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
  }

  searchInput.addEventListener("input", () => { renderGrid(); renderHistory(true); });
  sortSelect.addEventListener("change", renderGrid);

  // ---------- Modal ----------
  const modalBackdrop = document.getElementById("modal-backdrop");
  const modalBody = document.getElementById("modal-body");

  function openModal(s) {
    const eps = HISTORY.filter((h) => h.sid === s.id).slice(0, 60);
    modalBody.innerHTML = `
      <button class="modal-close" id="modal-close-btn">&times;</button>
      <div class="modal-head">
        <img class="modal-poster" id="modal-poster" />
        <div>
          <h2 class="modal-title">${escapeHtml(s.title)}</h2>
          <div class="modal-stats">
            Episoden geschaut: <b>${s.episodeCount}</b><br/>
            Staffeln erkannt: <b>${s.seasonCount || 1}</b><br/>
            Zuletzt: <b>${fmtDate(s.lastWatched)}</b><br/>
            Zuerst: <b>${fmtDate(s.firstWatched)}</b>
          </div>
        </div>
      </div>
      <div class="modal-eps">
        ${eps.map((e) => `
          <div class="modal-ep-row">
            <span>S${e.sn ?? "-"}E${e.en} ${e.et ? "· " + escapeHtml(e.et) : ""}</span>
            <span>${fmtDate(e.wa)}</span>
          </div>
        `).join("")}
      </div>
    `;
    const posterImg = document.getElementById("modal-poster");
    queueImageFetch(s.title, (url) => {
      if (url) posterImg.src = url;
    });
    document.getElementById("modal-close-btn").addEventListener("click", closeModal);
    modalBackdrop.classList.add("active");
  }
  function closeModal() { modalBackdrop.classList.remove("active"); }
  modalBackdrop.addEventListener("click", (e) => { if (e.target === modalBackdrop) closeModal(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeModal(); });

  // ---------- History rendering ----------
  const histContainer = document.getElementById("history-list");
  const loadMoreBtn = document.getElementById("load-more");
  let histShown = 0;
  const HIST_PAGE = 150;

  function filteredHistory() {
    const q = searchInput.value.trim().toLowerCase();
    if (!q) return HISTORY;
    return HISTORY.filter((h) => h.t.toLowerCase().includes(q));
  }

  function renderHistory(reset) {
    if (reset) {
      histShown = 0;
      histContainer.innerHTML = "";
    }
    const list = filteredHistory();
    if (!list.length) {
      histContainer.innerHTML = '<div class="empty">Keine Treffer.</div>';
      loadMoreBtn.style.display = "none";
      return;
    }
    const slice = list.slice(histShown, histShown + HIST_PAGE);
    let lastDay = histShown > 0 ? dayKey(list[histShown - 1].wa) : null;

    slice.forEach((e, idx) => {
      const dk = dayKey(e.wa);
      if (dk !== lastDay) {
        const label = document.createElement("div");
        label.className = "day-label";
        label.textContent = fmtDate(e.wa);
        histContainer.appendChild(label);
        lastDay = dk;
      }
      const row = document.createElement("div");
      row.className = "hist-row" + (e.fw ? "" : " partial");
      row.innerHTML = `
        <div class="hist-thumb"><img alt=""/></div>
        <div class="hist-text">
          <div class="hist-title">${escapeHtml(e.t)}</div>
          <div class="hist-sub">S${e.sn ?? "-"}E${e.en}${e.et ? " · " + escapeHtml(e.et) : ""}${e.fw ? "" : " · angebrochen"}</div>
        </div>
        <div class="hist-time">${fmtDateTime(e.wa)}</div>
      `;
      const thumbWrap = row.querySelector(".hist-thumb");
      const img = row.querySelector("img");
      attachLazyImage(thumbWrap, img, null, null, e.t);
      row.addEventListener("click", () => {
        const s = SERIES.find((sr) => sr.id === e.sid);
        if (s) openModal(s);
      });
      histContainer.appendChild(row);
    });

    histShown += slice.length;
    loadMoreBtn.style.display = histShown < list.length ? "block" : "none";
  }
  loadMoreBtn.addEventListener("click", () => renderHistory(false));

  // ---------- Tabs ----------
  const tabButtons = document.querySelectorAll(".tab-btn");
  const views = document.querySelectorAll(".view");
  tabButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      tabButtons.forEach((b) => b.classList.remove("active"));
      views.forEach((v) => v.classList.remove("active"));
      btn.classList.add("active");
      document.getElementById("view-" + btn.dataset.tab).classList.add("active");
    });
  });

  // ---------- Retry button ----------
  const retryBtn = document.getElementById("retry-covers");
  if (retryBtn) {
    retryBtn.addEventListener("click", () => {
      retryBtn.disabled = true;
      retryMissingCovers();
      setTimeout(() => { retryBtn.disabled = false; }, 3000);
    });
  }

  // ---------- Init ----------
  renderGrid();
  renderHistory(true);
  // Runs in the background; cards already on screen subscribe via
  // getCover() and update themselves progressively as batches resolve.
  resolveAllCovers(SERIES.map((s) => s.title));
})();
