(function () {
  "use strict";

  const form = document.getElementById("upload-form");
  const fileInput = document.getElementById("file-input");
  const folderInput = document.getElementById("folder-input");
  const drop = form;
  const dropFile = document.getElementById("drop-file");
  const submitBtn = document.getElementById("submit-btn");
  const errorEl = document.getElementById("drop-error");
  const pickers = document.querySelectorAll(".drop-browse");

  let selectedFiles = [];

  // Only these are worth sending; everything else in the folder (animelist.xml,
  // images, …) is dead weight, so filter client-side to keep the upload small.
  function keep(file) {
    const n = (file.name || "").toLowerCase();
    return n.endsWith(".json") || n.endsWith(".js");
  }

  // Reflect the configured retention window in the notice text.
  fetch("/api/config")
    .then((r) => r.json())
    .then((cfg) => {
      const note = document.getElementById("retention-note");
      if (note && cfg.retentionMinutes) {
        note.textContent =
          `Uploaded files are automatically deleted after ${cfg.retentionMinutes} minutes. ` +
          `Once that window passes, the link stops working and you have to upload again.`;
      }
    })
    .catch(() => {});

  function setFiles(files) {
    selectedFiles = files.filter(keep);
    if (selectedFiles.length) {
      const names = selectedFiles.map((f) => f.name);
      dropFile.textContent =
        names.length <= 3 ? names.join(", ") : `${names.length} files selected`;
      submitBtn.disabled = false;
      errorEl.textContent = "";
    } else {
      dropFile.textContent = "";
      submitBtn.disabled = true;
      if (files.length) errorEl.textContent = "No .json / .js file found in that selection.";
    }
  }

  pickers.forEach((el) =>
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      (el.dataset.pick === "folder" ? folderInput : fileInput).click();
    })
  );
  drop.addEventListener("click", (e) => {
    if (e.target.closest(".drop-submit") || e.target.closest(".drop-browse")) return;
    fileInput.click();
  });
  fileInput.addEventListener("change", () => setFiles(Array.from(fileInput.files)));
  folderInput.addEventListener("change", () => setFiles(Array.from(folderInput.files)));

  ["dragenter", "dragover"].forEach((ev) =>
    drop.addEventListener(ev, (e) => {
      e.preventDefault();
      drop.classList.add("dragging");
    })
  );
  ["dragleave", "drop"].forEach((ev) =>
    drop.addEventListener(ev, (e) => {
      e.preventDefault();
      if (ev === "dragleave" && drop.contains(e.relatedTarget)) return;
      drop.classList.remove("dragging");
    })
  );
  drop.addEventListener("drop", async (e) => {
    const items = e.dataTransfer.items;
    // If a folder was dropped, walk it; otherwise use the plain file list.
    if (items && items.length && items[0].webkitGetAsEntry) {
      const entries = [];
      for (const it of items) {
        const entry = it.webkitGetAsEntry && it.webkitGetAsEntry();
        if (entry) entries.push(entry);
      }
      const files = await gatherFiles(entries);
      setFiles(files);
    } else {
      setFiles(Array.from(e.dataTransfer.files || []));
    }
  });

  // Recursively collect File objects from dropped FileSystemEntry items.
  async function gatherFiles(entries) {
    const out = [];
    async function walk(entry) {
      if (entry.isFile) {
        const file = await new Promise((res) => entry.file(res));
        out.push(file);
      } else if (entry.isDirectory) {
        const reader = entry.createReader();
        const kids = await new Promise((res) => reader.readEntries(res));
        for (const k of kids) await walk(k);
      }
    }
    for (const e of entries) await walk(e);
    return out;
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!selectedFiles.length) return;
    submitBtn.disabled = true;
    submitBtn.textContent = "Uploading…";
    errorEl.textContent = "";

    const body = new FormData();
    selectedFiles.forEach((f) => body.append("files", f, f.name));

    try {
      const res = await fetch("/upload", { method: "POST", body });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Upload failed.");
      window.location.href = json.path;
    } catch (err) {
      errorEl.textContent = err.message || "Upload failed.";
      submitBtn.disabled = false;
      submitBtn.textContent = "Upload & view";
    }
  });
})();
