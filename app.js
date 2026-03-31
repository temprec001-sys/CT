(() => {
  "use strict";

  const manifest = window.SLICE_MANIFEST;
  const root = document.documentElement;
  const VIEW_ORDER = ["axial", "coronal", "sagittal"];
  const VIEW_LABELS = {
    axial: "Axial",
    coronal: "Coronal",
    sagittal: "Sagittal",
  };
  const ASPECT_MODES = {
    physical: "物理比例",
  };
  const ZOOM_MIN = 50;
  const ZOOM_MAX = 300;
  const ZOOM_STEP = 10;

  if (!manifest || !Array.isArray(manifest.series) || manifest.series.length === 0) {
    document.body.innerHTML =
      '<div style="padding:24px;font-family:Segoe UI,system-ui,sans-serif;color:#e8f3f6;background:#07131a;min-height:100vh">manifest.js not found. Run <code>python build_viewer.py</code> first.</div>';
    return;
  }

  const els = {
    summary: document.getElementById("datasetSummary"),
    seriesList: document.getElementById("seriesList"),
    viewerStage: document.getElementById("viewerStage"),
    imageWrap: document.querySelector(".image-wrap"),
    sliceImage: document.getElementById("sliceImage"),
    loadingMask: document.getElementById("loadingMask"),
    seriesBadge: document.getElementById("seriesBadge"),
    sliceBadge: document.getElementById("sliceBadge"),
    imageCaption: document.getElementById("imageCaption"),
    seriesCountLabel: document.getElementById("seriesCountLabel"),
    metadataList: document.getElementById("metadataList"),
    aspectTabs: document.getElementById("aspectTabs"),
    zoomSlider: document.getElementById("zoomSlider"),
    zoomValue: document.getElementById("zoomValue"),
    sliceSlider: document.getElementById("sliceSlider"),
    brightnessSlider: document.getElementById("brightnessSlider"),
    contrastSlider: document.getElementById("contrastSlider"),
    sliceValue: document.getElementById("sliceValue"),
    brightnessValue: document.getElementById("brightnessValue"),
    contrastValue: document.getElementById("contrastValue"),
    viewTabs: document.getElementById("viewTabs"),
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

  const savedSliceMap = {};
  const rawSliceMap = savedState.sliceIndexBySeriesView;
  if (rawSliceMap && typeof rawSliceMap === "object") {
    Object.entries(rawSliceMap).forEach(([seriesId, views]) => {
      if (!views || typeof views !== "object") {
        return;
      }
      savedSliceMap[seriesId] = {};
      VIEW_ORDER.forEach((viewKey) => {
        const value = views[viewKey];
        if (Number.isFinite(value)) {
          savedSliceMap[seriesId][viewKey] = Number(value);
        }
      });
    });
  }
  if (savedState.seriesId && Number.isFinite(savedState.sliceIndex)) {
    if (!savedSliceMap[savedState.seriesId]) {
      savedSliceMap[savedState.seriesId] = {};
    }
    savedSliceMap[savedState.seriesId].axial = Number(savedState.sliceIndex);
  }

  const defaultSeriesIndex = Math.max(
    0,
    manifest.series.findIndex((series) => series.id === manifest.defaultSeriesId)
  );

  const state = {
    seriesIndex: Number.isInteger(defaultSeriesIndex) && defaultSeriesIndex >= 0 ? defaultSeriesIndex : 0,
    viewKey: VIEW_ORDER.includes(savedState.viewKey) ? savedState.viewKey : "axial",
    aspectMode: "physical",
    zoom: Number.isFinite(savedState.zoom) ? Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Number(savedState.zoom))) : 100,
    sliceIndex: 0,
    sliceIndexBySeriesView: savedSliceMap,
    brightness: Number.isFinite(savedState.brightness) ? Number(savedState.brightness) : 100,
    contrast: Number.isFinite(savedState.contrast) ? Number(savedState.contrast) : 100,
  };

  if (savedState.seriesId) {
    const savedIndex = manifest.series.findIndex((series) => series.id === savedState.seriesId);
    if (savedIndex >= 0) {
      state.seriesIndex = savedIndex;
    }
  }

  function normalizeSeries(series) {
    if (series?.views?.axial) {
      return series;
    }

    const axialSlices = Array.isArray(series?.slices) ? series.slices : [];
    const axialImageCount = Number.isFinite(series?.imageCount) ? Number(series.imageCount) : axialSlices.length;
    const rows = Number.isFinite(series?.rows) ? Number(series.rows) : 0;
    const columns = Number.isFinite(series?.columns) ? Number(series.columns) : 0;
    const rowSpacing = Array.isArray(series?.pixelSpacing) && series.pixelSpacing.length > 0 ? Number(series.pixelSpacing[0]) : 1;
    const colSpacing = Array.isArray(series?.pixelSpacing) && series.pixelSpacing.length > 1 ? Number(series.pixelSpacing[1]) : 1;

    return {
      ...series,
      views: {
        axial: {
          key: "axial",
          label: VIEW_LABELS.axial,
          imageDir: series?.imageDir || "data",
          slices: axialSlices,
          imageCount: axialImageCount,
          rows,
          columns,
          pixelSpacing: [rowSpacing, colSpacing],
          sliceSpacing: Number(series?.sliceThickness) || 1,
          physicalWidthMm: columns * colSpacing,
          physicalHeightMm: rows * rowSpacing,
          sampleShape: Array.isArray(series?.sampleShape) ? series.sampleShape : [rows, columns],
        },
      },
    };
  }

  function currentSeries() {
    return normalizeSeries(manifest.series[state.seriesIndex]);
  }

  function currentView() {
    const series = currentSeries();
    const views = series.views || {};
    if (views[state.viewKey]) {
      return views[state.viewKey];
    }
    state.viewKey = "axial";
    return views.axial;
  }

  function viewSeriesState(seriesId) {
    if (!state.sliceIndexBySeriesView[seriesId]) {
      state.sliceIndexBySeriesView[seriesId] = {};
    }
    return state.sliceIndexBySeriesView[seriesId];
  }

  function getStoredSliceIndex(seriesId, viewKey, fallback) {
    const seriesState = state.sliceIndexBySeriesView[seriesId];
    const value = seriesState?.[viewKey];
    return Number.isFinite(value) ? Number(value) : fallback;
  }

  function setStoredSliceIndex(seriesId, viewKey, sliceIndex) {
    const seriesState = viewSeriesState(seriesId);
    seriesState[viewKey] = sliceIndex;
  }

  function seriesUrl(view, sliceIndex) {
    return `${view.imageDir}/${view.slices[sliceIndex]}`;
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
      const normalized = normalizeSeries(series);
      const availableViewCount = VIEW_ORDER.filter((viewKey) => normalized.views?.[viewKey]).length || 1;
      const viewSummary = VIEW_ORDER.map((viewKey) => {
        const count = normalized.views?.[viewKey]?.imageCount ?? normalized.views?.axial?.imageCount ?? normalized.imageCount;
        return `${VIEW_LABELS[viewKey]} ${count}`;
      }).join(" · ");
      const card = document.createElement("button");
      card.type = "button";
      card.className = `series-card${index === state.seriesIndex ? " is-active" : ""}`;
      card.setAttribute("aria-pressed", String(index === state.seriesIndex));
      card.innerHTML = `
        <div class="series-card-top">
          <div class="series-title">${escapeHtml(normalized.title)}</div>
          <div class="series-count">${availableViewCount} views</div>
        </div>
        <div class="series-meta">
          <div>${escapeHtml(normalized.modality)} · Series ${normalized.seriesNumber}</div>
          <div>${escapeHtml(normalized.protocol || "No protocol")}</div>
          <div>${escapeHtml(viewSummary)}</div>
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
    const summary = manifest.summary || {};
    const seriesCount = summary.seriesCount ?? manifest.series.length;
    const axialSliceCount = summary.axialSliceCount ?? summary.sliceCount ?? 0;
    const viewCount = summary.viewCount ?? VIEW_ORDER.length;
    const excludedCount = summary.excludedCount ?? 0;
    els.summary.textContent = `${seriesCount} series · ${axialSliceCount} axial slices · ${viewCount} views${excludedCount ? ` · ${excludedCount} excluded` : ""}`;
  }

  function updateMetadataPanel() {
    const series = currentSeries();
    const view = currentView();
    const currentSlice = Math.min(state.sliceIndex + 1, view.imageCount);
    const entries = [
      ["Series", `${series.title || "N/A"} · ${series.modality}`],
      ["View", `${VIEW_LABELS[state.viewKey] || "Axial"} · ${view.imageCount} slices`],
      ["Aspect", ASPECT_MODES.physical],
      ["Zoom", `${state.zoom}%`],
      ["Protocol", series.protocol || "N/A"],
      ["Series Number", series.seriesNumber ?? "N/A"],
      ["Current Slice", `${currentSlice} / ${view.imageCount}`],
      ["Matrix", formatPair([view.columns, view.rows])],
      ["Pixel Spacing", view.pixelSpacing?.length ? formatPair(view.pixelSpacing, " mm") : "N/A"],
      ["Slice Spacing", view.sliceSpacing ? `${view.sliceSpacing} mm` : "N/A"],
      ["Physical Size", view.physicalWidthMm && view.physicalHeightMm ? `${formatPair([view.physicalWidthMm, view.physicalHeightMm], " mm")}` : "N/A"],
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

    els.seriesCountLabel.textContent = `${view.imageCount} 張`;
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
        viewKey: state.viewKey,
        sliceIndex: state.sliceIndex,
        sliceIndexBySeriesView: state.sliceIndexBySeriesView,
        aspectMode: state.aspectMode,
        zoom: state.zoom,
        brightness: state.brightness,
        contrast: state.contrast,
      })
    );
  }

  function renderViewTabs() {
    const series = currentSeries();
    const views = series.views || {};
    els.viewTabs.innerHTML = "";

    VIEW_ORDER.forEach((viewKey) => {
      if (!views[viewKey]) {
        return;
      }

      const button = document.createElement("button");
      button.type = "button";
      button.className = `view-button${viewKey === state.viewKey ? " is-active" : ""}`;
      button.dataset.view = viewKey;
      button.setAttribute("aria-pressed", String(viewKey === state.viewKey));
      button.textContent = VIEW_LABELS[viewKey];
      button.addEventListener("click", () => selectView(viewKey));
      els.viewTabs.appendChild(button);
    });
  }

  function updateViewTabs() {
    [...els.viewTabs.children].forEach((child) => {
      const viewKey = child.dataset.view || "";
      const isActive = viewKey === state.viewKey;
      child.classList.toggle("is-active", isActive);
      child.setAttribute("aria-pressed", String(isActive));
    });
  }

  function renderAspectTabs() {
    if (!els.aspectTabs) {
      return;
    }

    els.aspectTabs.innerHTML = "";
    Object.entries(ASPECT_MODES).forEach(([modeKey, modeLabel]) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "view-button is-active";
      button.disabled = true;
      button.dataset.aspectMode = modeKey;
      button.setAttribute("aria-pressed", "true");
      button.textContent = modeLabel;
      els.aspectTabs.appendChild(button);
    });
  }

  function updateAspectTabs() {
    return;
  }

  function updateZoomControls() {
    if (els.zoomSlider) {
      els.zoomSlider.value = String(state.zoom);
    }
    if (els.zoomValue) {
      els.zoomValue.textContent = `${state.zoom}%`;
    }
  }

  function centerViewerStage() {
    if (!els.viewerStage) {
      return;
    }

    window.requestAnimationFrame(() => {
      const stage = els.viewerStage;
      stage.scrollLeft = Math.max(0, (stage.scrollWidth - stage.clientWidth) / 2);
      stage.scrollTop = Math.max(0, (stage.scrollHeight - stage.clientHeight) / 2);
    });
  }

  function setZoom(nextZoom, center = false) {
    const clamped = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Math.round(nextZoom)));
    if (clamped === state.zoom) {
      return;
    }

    state.zoom = clamped;
    updateZoomControls();
    updateImageSizing(currentView());
    updateMetadataPanel();
    persistState();

    if (center) {
      centerViewerStage();
    }
  }

  function changeZoom(delta, center = false) {
    setZoom(state.zoom + delta, center);
  }

  function updateImageSizing(view) {
    const physicalWidthMm = Number(view?.physicalWidthMm);
    const physicalHeightMm = Number(view?.physicalHeightMm);

    if (!Number.isFinite(physicalWidthMm) || !Number.isFinite(physicalHeightMm) || physicalWidthMm <= 0 || physicalHeightMm <= 0) {
      els.sliceImage.style.removeProperty("width");
      els.sliceImage.style.removeProperty("height");
      els.sliceImage.style.removeProperty("max-width");
      els.sliceImage.style.removeProperty("max-height");
      return;
    }

    const wrap = els.imageWrap;
    if (!wrap) {
      return;
    }

    els.sliceImage.style.maxWidth = "none";
    els.sliceImage.style.maxHeight = "none";

    const wrapStyle = window.getComputedStyle(wrap);
    const paddingX = Number.parseFloat(wrapStyle.paddingLeft) + Number.parseFloat(wrapStyle.paddingRight);
    const paddingY = Number.parseFloat(wrapStyle.paddingTop) + Number.parseFloat(wrapStyle.paddingBottom);
    const availableWidth = Math.max(1, wrap.clientWidth - paddingX);
    const availableHeight = Math.max(1, wrap.clientHeight - paddingY);
    const ratio = physicalWidthMm / physicalHeightMm;

    let width = availableWidth;
    let height = width / ratio;
    if (height > availableHeight) {
      height = availableHeight;
      width = height * ratio;
    }

    const zoomFactor = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, state.zoom)) / 100.0;
    width *= zoomFactor;
    height *= zoomFactor;

    els.sliceImage.style.width = `${Math.max(1, Math.round(width))}px`;
    els.sliceImage.style.height = `${Math.max(1, Math.round(height))}px`;
  }

  function preloadNeighborSlices() {
    const view = currentView();
    [state.sliceIndex - 1, state.sliceIndex + 1, state.sliceIndex + 2].forEach((index) => {
      if (index < 0 || index >= view.slices.length) {
        return;
      }
      const pre = new Image();
      pre.src = seriesUrl(view, index);
    });
  }

  function renderSlice() {
    const series = currentSeries();
    const view = currentView();
    const total = view.slices.length;
    state.sliceIndex = Math.max(0, Math.min(state.sliceIndex, total - 1));
    setStoredSliceIndex(series.id, state.viewKey, state.sliceIndex);

    els.viewerStage.classList.add("is-loading");
    els.loadingMask.textContent = "載入中";

    els.sliceImage.onload = () => {
      els.viewerStage.classList.remove("is-loading");
    };
    els.sliceImage.onerror = () => {
      els.viewerStage.classList.remove("is-loading");
      els.loadingMask.textContent = "影像載入失敗";
    };

    updateImageSizing(view);
    els.sliceImage.src = seriesUrl(view, state.sliceIndex);
    els.sliceBadge.textContent = `${state.sliceIndex + 1} / ${total}`;
    els.seriesBadge.textContent = `${series.modality} · ${VIEW_LABELS[state.viewKey] || "Axial"} · ${series.title}`;
    els.imageCaption.textContent = `${series.title} · ${VIEW_LABELS[state.viewKey] || "Axial"} · ${state.sliceIndex + 1} / ${total}`;
    els.sliceSlider.max = String(total);
    els.sliceSlider.value = String(state.sliceIndex + 1);
    els.sliceValue.textContent = String(state.sliceIndex + 1);
    applyFilters();
    updateMetadataPanel();
    updateSeriesHighlights();
    updateViewTabs();
    updateAspectTabs();
    updateZoomControls();
    persistState();
    preloadNeighborSlices();
    if (state.zoom !== 100) {
      centerViewerStage();
    }
  }

  function selectSeries(index) {
    if (index < 0 || index >= manifest.series.length) {
      return;
    }
    state.seriesIndex = index;
    const series = currentSeries();
    const view = currentView();
    const fallback = Math.floor((view?.imageCount || series.imageCount || 1) / 2);
    state.sliceIndex = getStoredSliceIndex(series.id, state.viewKey, fallback);
    renderSeriesList();
    renderViewTabs();
    renderSlice();
  }

  function selectView(viewKey) {
    if (!VIEW_ORDER.includes(viewKey)) {
      return;
    }
    state.viewKey = viewKey;
    const series = currentSeries();
    const view = currentView();
    const fallback = Math.floor((view?.imageCount || series.imageCount || 1) / 2);
    state.sliceIndex = getStoredSliceIndex(series.id, viewKey, fallback);
    renderSlice();
  }

  function selectAspectMode(mode) {
    if (!ASPECT_MODES[mode] || mode === state.aspectMode) {
      return;
    }
    state.aspectMode = mode;
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

  function changeView(delta) {
    const currentIndex = Math.max(0, VIEW_ORDER.indexOf(state.viewKey));
    const next = (currentIndex + delta + VIEW_ORDER.length) % VIEW_ORDER.length;
    selectView(VIEW_ORDER[next]);
  }

  function resetDisplay() {
    state.brightness = 100;
    state.contrast = 100;
    state.zoom = 100;
    els.brightnessSlider.value = "100";
    els.contrastSlider.value = "100";
    updateZoomControls();
    applyFilters();
    updateImageSizing(currentView());
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

  if (els.zoomSlider) {
    els.zoomSlider.addEventListener("input", () => {
      setZoom(Number(els.zoomSlider.value), true);
    });
  }

  els.prevBtn.addEventListener("click", () => moveSlice(-1));
  els.nextBtn.addEventListener("click", () => moveSlice(1));
  els.resetBtn.addEventListener("click", resetDisplay);

  els.viewerStage.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      if (event.ctrlKey) {
        changeZoom(event.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP, true);
        return;
      }
      moveSlice(event.deltaY > 0 ? 1 : -1);
    },
    { passive: false }
  );

  window.addEventListener("resize", () => {
    updateImageSizing(currentView());
    if (state.zoom !== 100) {
      centerViewerStage();
    }
  });

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
        state.sliceIndex = currentView().imageCount - 1;
        renderSlice();
        break;
      case "a":
      case "A":
        event.preventDefault();
        selectView("axial");
        break;
      case "c":
      case "C":
        event.preventDefault();
        selectView("coronal");
        break;
      case "s":
      case "S":
        event.preventDefault();
        selectView("sagittal");
        break;
      case "v":
      case "V":
        event.preventDefault();
        changeView(1);
        break;
      case "=":
      case "+":
        event.preventDefault();
        changeZoom(ZOOM_STEP, true);
        break;
      case "-":
      case "_":
        event.preventDefault();
        changeZoom(-ZOOM_STEP, true);
        break;
      case "0":
        event.preventDefault();
        setZoom(100, true);
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
  renderAspectTabs();
  renderViewTabs();
  els.brightnessSlider.value = String(state.brightness);
  els.contrastSlider.value = String(state.contrast);
  updateZoomControls();
  selectSeries(state.seriesIndex);
})();
