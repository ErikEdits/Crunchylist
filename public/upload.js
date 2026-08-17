(function () {
  "use strict";

  const form = document.getElementById("upload-form");
  const fileInput = document.getElementById("file-input");
  const drop = form;
  const dropFile = document.getElementById("drop-file");
  const submitBtn = document.getElementById("submit-btn");
  const errorEl = document.getElementById("drop-error");
  const browse = document.querySelector(".drop-browse");

  let selectedFile = null;

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

  function setFile(file) {
    selectedFile = file || null;
    if (selectedFile) {
      dropFile.textContent = selectedFile.name;
      submitBtn.disabled = false;
      errorEl.textContent = "";
    } else {
      dropFile.textContent = "";
      submitBtn.disabled = true;
    }
  }

  browse.addEventListener("click", () => fileInput.click());
  drop.addEventListener("click", (e) => {
    if (e.target === submitBtn || e.target.closest(".drop-submit")) return;
    fileInput.click();
  });
  fileInput.addEventListener("change", () => setFile(fileInput.files[0]));

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
  drop.addEventListener("drop", (e) => {
    const file = e.dataTransfer.files && e.dataTransfer.files[0];
    if (file) setFile(file);
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!selectedFile) return;
    submitBtn.disabled = true;
    submitBtn.textContent = "Uploading…";
    errorEl.textContent = "";

    const body = new FormData();
    body.append("file", selectedFile);

    try {
      const res = await fetch("/upload", { method: "POST", body });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || "Upload failed.");
      }
      window.location.href = json.path;
    } catch (err) {
      errorEl.textContent = err.message || "Upload failed.";
      submitBtn.disabled = false;
      submitBtn.textContent = "Upload & view";
    }
  });
})();
