(() => {
  "use strict";

  const manifest = window.SLICE_MANIFEST;
  const root = document.documentElement;

  if (!manifest || !Array.isArray(manifest.series) || manifest.series.length === 0) {
    document.body.innerHTML =
      '<div style="padding:24px;font-family:Segoe UI,system-ui,sans-serif;color:#e8f3f6;background:#07131a;min-height:100vh">manifest.js not found. Run <code>python build_viewer.py</code> first.</div>';
    return;
  }

  const els = {
    summary: document.getElementById("datasetSummary"),
    seriesList: document.getElementById("seriesList"),
    viewerStage: document.getElementById("viewerStage"),
    sliceImage: document.getElementById("sliceImage"),
    loadingMask: document.getElementById("loadingMask"),
    seriesBadge: document.getElementById("seriesBadge"),
    sliceBadge: document.getElementById("sliceBadge"),
    imageCaption: document.getElementById("imageCaption"),
    seriesCountLabel: document.getElementById("seriesCountLabel"),
    metadataList: document.getElementById("metadataList"),
    sliceSlider: document.getElementById("sliceSlider"),
    brightnessSlider: document.getElementById("brightnessSlider"),
    contrastSlider: document.getElementById("contrastSlider"),
    sliceValue: document.getElementById("sliceValue"),
    brightnessValue: document.getElementById("brightnessValue"),
    contrastValue: document.getElementById("contrastValue"),
    prevBtn: document.getElementById("prevBtn"),
    nextBtn: document.getElementById("nextBtn"),
    resetBtn: document.getElementById("resetBtn"),
  };

  const savedState = (() => {
    try {
      return JSON.parse(localStorage.getItem("baobei-slice-viewer-state") || "{}");
    } catch {
      return {};
    }
  })();

  const defaultSeriesIndex = Math.max(
    0,
    manifest.series.findIndex((series) => series.id === manifest.defaultSeriesId)
  );

  const state = {
    seriesIndex: Number.isInteger(defaultSeriesIndex) && defaultSeriesIndex >= 0 ? defaultSeriesIndex : 0,
    sliceIndex: Number.isFinite(savedState.sliceIndex) ? Number(savedState.sliceIndex) : 0,
    brightness: Number.isFinite(savedState.brightness) ? Number(savedState.brightness) : 100,
    contrast: Number.isFinite(savedState.contrast) ? Number(savedState.contrast) : 100,
  };

  if (savedState.seriesId) {
    const savedIndex = manifest.series.findIndex((series) => series.id === savedState.seriesId);
    if (savedIndex >= 0) {
      state.seriesIndex = savedIndex;
    }
  }

  function currentSeries() {
    return manifest.series[state.seriesIndex];
  }

  function seriesUrl(series, sliceIndex) {
    return `${series.imageDir}/${series.slices[sliceIndex]}`;
  }

  function formatPair(values, unit = "") {
    if (!Array.isArray(values) || values.length === 0) {
      return "N/A";
    }
    return values
      .map((value) => {
        if (value === null || value === undefined || Number.isNaN(value)) {
          return "N/A";
        }
        const number = Number(value);
        if (Number.isInteger(number)) {
          return `${number}${unit}`;
        }
        return `${number.toFixed(3).replace(/0+$/, "").replace(/\.$/, "")}${unit}`;
      })
      .join(" × ");
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function renderSeriesList() {
    els.seriesList.innerHTML = "";

    manifest.series.forEach((series, index) => {
      const card = document.createElement("button");
      card.type = "button";
      card.className = `series-card${index === state.seriesIndex ? " is-active" : ""}`;
      card.setAttribute("aria-pressed", String(index === state.seriesIndex));
      card.innerHTML = `
        <div class="series-card-top">
          <div class="series-title">${escapeHtml(series.title)}</div>
          <div class="series-count">${series.imageCount} 張</div>
        </div>
        <div class="series-meta">
          <div>${escapeHtml(series.modality)} · Series ${series.seriesNumber}</div>
          <div>${escapeHtml(series.protocol || "No protocol")}</div>
        </div>
      `;
      card.addEventListener("click", () => selectSeries(index));
      els.seriesList.appendChild(card);
    });
  }

  function updateSeriesHighlights() {
    [...els.seriesList.children].forEach((child, index) => {
      child.classList.toggle("is-active", index === state.seriesIndex);
      child.setAttribute("aria-pressed", String(index === state.seriesIndex));
    });
  }

  function updateSummary() {
    const { seriesCount, sliceCount, excludedCount } = manifest.summary;
    els.summary.textContent = `${seriesCount} series · ${sliceCount} slices${excludedCount ? ` · ${excludedCount} excluded` : ""}`;
  }

  function updateMetadataPanel() {
    const series = currentSeries();
    const entries = [
      ["Series", `${series.title || "N/A"} · ${series.modality}`],
      ["Protocol", series.protocol || "N/A"],
      ["Series Number", series.seriesNumber ?? "N/A"],
      ["Slices", series.imageCount],
      ["Matrix", formatPair([series.columns, series.rows])],
      ["Pixel Spacing", series.pixelSpacing?.length ? formatPair(series.pixelSpacing, " mm") : "N/A"],
      ["Slice Thickness", series.sliceThickness ? `${series.sliceThickness} mm` : "N/A"],
      ["Window", series.windowCenter && series.windowWidth ? `${series.windowCenter} / ${series.windowWidth}` : "N/A"],
      ["Orientation", series.orientation?.length ? series.orientation.map((value) => Number(value).toFixed(4)).join(", ") : "N/A"],
      ["Image Position", series.position?.length ? series.position.map((value) => Number(value).toFixed(4)).join(", ") : "N/A"],
    ];

    els.metadataList.innerHTML = entries
      .map(
        ([key, value]) => `
          <div class="metadata-item">
            <div class="metadata-key">${escapeHtml(key)}</div>
            <div class="metadata-value">${escapeHtml(value)}</div>
          </div>
        `
      )
      .join("");

    els.seriesCountLabel.textContent = `${series.imageCount} 張`;
  }

  function applyFilters() {
    els.sliceImage.style.filter = `brightness(${state.brightness}%) contrast(${state.contrast}%)`;
    els.brightnessValue.textContent = `${state.brightness}%`;
    els.contrastValue.textContent = `${state.contrast}%`;
  }

  function persistState() {
    localStorage.setItem(
      "baobei-slice-viewer-state",
      JSON.stringify({
        seriesId: currentSeries().id,
        sliceIndex: state.sliceIndex,
        brightness: state.brightness,
        contrast: state.contrast,
      })
    );
  }

  function preloadNeighborSlices() {
    const series = currentSeries();
    [state.sliceIndex - 1, state.sliceIndex + 1, state.sliceIndex + 2].forEach((index) => {
      if (index < 0 || index >= series.slices.length) {
        return;
      }
      const pre = new Image();
      pre.src = seriesUrl(series, index);
    });
  }

  function renderSlice() {
    const series = currentSeries();
    const total = series.slices.length;
    state.sliceIndex = Math.max(0, Math.min(state.sliceIndex, total - 1));

    els.viewerStage.classList.add("is-loading");
    els.loadingMask.textContent = "載入中";

    els.sliceImage.onload = () => {
      els.viewerStage.classList.remove("is-loading");
    };
    els.sliceImage.onerror = () => {
      els.viewerStage.classList.remove("is-loading");
      els.loadingMask.textContent = "影像載入失敗";
    };

    els.sliceImage.src = seriesUrl(series, state.sliceIndex);
    els.sliceBadge.textContent = `${state.sliceIndex + 1} / ${total}`;
    els.seriesBadge.textContent = `${series.modality} · ${series.title}`;
    els.imageCaption.textContent = `${series.title} · ${series.protocol || "N/A"} · ${state.sliceIndex + 1} / ${total}`;
    els.sliceSlider.max = String(total);
    els.sliceSlider.value = String(state.sliceIndex + 1);
    els.sliceValue.textContent = String(state.sliceIndex + 1);
    applyFilters();
    updateMetadataPanel();
    updateSeriesHighlights();
    persistState();
    preloadNeighborSlices();
  }

  function selectSeries(index) {
    if (index < 0 || index >= manifest.series.length) {
      return;
    }
    state.seriesIndex = index;
    const series = currentSeries();
    const restoredSlice = savedState.seriesId === series.id ? Number(savedState.sliceIndex) : Math.floor(series.imageCount / 2);
    state.sliceIndex = Number.isFinite(restoredSlice) ? restoredSlice : 0;
    renderSeriesList();
    renderSlice();
  }

  function moveSlice(delta) {
    state.sliceIndex += delta;
    renderSlice();
  }

  function changeSeries(delta) {
    const next = (state.seriesIndex + delta + manifest.series.length) % manifest.series.length;
    selectSeries(next);
  }

  function resetDisplay() {
    state.brightness = 100;
    state.contrast = 100;
    els.brightnessSlider.value = "100";
    els.contrastSlider.value = "100";
    applyFilters();
    persistState();
  }

  els.sliceSlider.addEventListener("input", () => {
    state.sliceIndex = Number(els.sliceSlider.value) - 1;
    renderSlice();
  });

  els.brightnessSlider.addEventListener("input", () => {
    state.brightness = Number(els.brightnessSlider.value);
    applyFilters();
    persistState();
  });

  els.contrastSlider.addEventListener("input", () => {
    state.contrast = Number(els.contrastSlider.value);
    applyFilters();
    persistState();
  });

  els.prevBtn.addEventListener("click", () => moveSlice(-1));
  els.nextBtn.addEventListener("click", () => moveSlice(1));
  els.resetBtn.addEventListener("click", resetDisplay);

  els.viewerStage.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      moveSlice(event.deltaY > 0 ? 1 : -1);
    },
    { passive: false }
  );

  window.addEventListener("keydown", (event) => {
    if (event.defaultPrevented) {
      return;
    }

    switch (event.key) {
      case "ArrowLeft":
      case "ArrowUp":
        event.preventDefault();
        moveSlice(-1);
        break;
      case "ArrowRight":
      case "ArrowDown":
        event.preventDefault();
        moveSlice(1);
        break;
      case "PageUp":
        event.preventDefault();
        moveSlice(-10);
        break;
      case "PageDown":
        event.preventDefault();
        moveSlice(10);
        break;
      case "Home":
        event.preventDefault();
        state.sliceIndex = 0;
        renderSlice();
        break;
      case "End":
        event.preventDefault();
        state.sliceIndex = currentSeries().imageCount - 1;
        renderSlice();
        break;
      case "1":
        event.preventDefault();
        changeSeries(-1);
        break;
      case "2":
        event.preventDefault();
        changeSeries(1);
        break;
      default:
        break;
    }
  });

  updateSummary();
  renderSeriesList();
  els.brightnessSlider.value = String(state.brightness);
  els.contrastSlider.value = String(state.contrast);
  selectSeries(state.seriesIndex);
})();
