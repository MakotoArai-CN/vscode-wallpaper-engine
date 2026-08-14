const vscode = acquireVsCodeApi();
const SERVER_ROOT = document
  .getElementById("settings-script")
  .getAttribute("data-server-root");

const PRESETS = {
  subtle: {
    enabled: true,
    preset: "subtle",
    tint: "#171A21",
    opacity: 0.82,
    blur: 12,
    saturation: 1.15,
    borderOpacity: 0.18,
    shadowOpacity: 0.18,
  },
  liquid: {
    enabled: true,
    preset: "liquid",
    tint: "#111827",
    opacity: 0.52,
    blur: 28,
    saturation: 1.85,
    borderOpacity: 0.46,
    shadowOpacity: 0.36,
  },
  solid: {
    enabled: true,
    preset: "solid",
    tint: "#111318",
    opacity: 0.92,
    blur: 6,
    saturation: 1,
    borderOpacity: 0.2,
    shadowOpacity: 0.22,
  },
};

const glassControls = {
  enabled: document.getElementById("glass-enabled"),
  tint: document.getElementById("glass-tint"),
  opacity: document.getElementById("glass-opacity"),
  blur: document.getElementById("glass-blur"),
  saturation: document.getElementById("glass-saturation"),
  borderOpacity: document.getElementById("glass-border-opacity"),
  shadowOpacity: document.getElementById("glass-shadow-opacity"),
};

const adaptiveColorControls = {
  enabled: document.getElementById("adaptive-colors-enabled"),
  strength: document.getElementById("adaptive-colors-strength"),
};

let glassPreset = (window.glassConfig && window.glassConfig.preset) || "liquid";

function post(command, payload = {}) {
  vscode.postMessage({ command, ...payload });
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number(value)));
}

function normalizeHex(value, fallback = "#111827") {
  return /^#[0-9A-Fa-f]{6}$/.test(value || "") ? value.toUpperCase() : fallback;
}

function hexToRgb(hex) {
  const value = normalizeHex(hex).slice(1);
  return {
    r: parseInt(value.slice(0, 2), 16),
    g: parseInt(value.slice(2, 4), 16),
    b: parseInt(value.slice(4, 6), 16),
  };
}

function rgba(hex, alpha) {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function setOutput(id, value, suffix = "") {
  const el = document.getElementById(id);
  if (el) {
    el.textContent = `${value}${suffix}`;
  }
}

function collectGlassConfig() {
  return {
    enabled: glassControls.enabled.checked,
    preset: glassPreset,
    tint: normalizeHex(glassControls.tint.value),
    opacity: clamp(glassControls.opacity.value, 0.2, 1),
    blur: clamp(glassControls.blur.value, 0, 60),
    saturation: clamp(glassControls.saturation.value, 1, 2.5),
    borderOpacity: clamp(glassControls.borderOpacity.value, 0, 1),
    shadowOpacity: clamp(glassControls.shadowOpacity.value, 0, 1),
  };
}

function collectAdaptiveColorConfig() {
  return {
    enabled: adaptiveColorControls.enabled.checked,
    strength: clamp(adaptiveColorControls.strength.value, 0, 1),
  };
}

function setGlassControls(config) {
  const glass = { ...PRESETS.liquid, ...config };
  glassPreset = glass.preset || "liquid";

  glassControls.enabled.checked = glass.enabled !== false;
  glassControls.tint.value = normalizeHex(glass.tint);
  glassControls.opacity.value = glass.opacity;
  glassControls.blur.value = glass.blur;
  glassControls.saturation.value = glass.saturation;
  glassControls.borderOpacity.value = glass.borderOpacity;
  glassControls.shadowOpacity.value = glass.shadowOpacity;

  updateGlassPreview();
}

function updatePresetButtons() {
  document.querySelectorAll("#glass-presets button").forEach((button) => {
    button.classList.toggle("active", button.dataset.preset === glassPreset);
  });
}

function updateGlassPreview() {
  const glass = collectGlassConfig();
  const preview = document.getElementById("glass-preview-menu");
  const disabledOpacity = glass.enabled ? 1 : 0.42;

  preview.style.setProperty("--preview-glass-bg", rgba(glass.tint, glass.opacity));
  preview.style.setProperty("--preview-glass-border", `rgba(255, 255, 255, ${glass.borderOpacity})`);
  preview.style.setProperty("--preview-glass-shadow", `rgba(0, 0, 0, ${glass.shadowOpacity})`);
  preview.style.setProperty("--preview-glass-blur", `${glass.blur}px`);
  preview.style.setProperty("--preview-glass-saturation", glass.saturation);
  preview.style.opacity = disabledOpacity;

  setOutput("glass-opacity-value", glass.opacity.toFixed(2));
  setOutput("glass-blur-value", glass.blur.toFixed(0), "px");
  setOutput("glass-saturation-value", glass.saturation.toFixed(2));
  setOutput("glass-border-value", glass.borderOpacity.toFixed(2));
  setOutput("glass-shadow-value", glass.shadowOpacity.toFixed(2));
  const adaptiveColors = collectAdaptiveColorConfig();
  setOutput("adaptive-colors-strength-value", adaptiveColors.strength.toFixed(2));
  adaptiveColorControls.strength.disabled = !adaptiveColors.enabled;
  updatePresetButtons();
}

function applyGlassPreset(preset) {
  if (!PRESETS[preset]) {
    return;
  }
  setGlassControls(PRESETS[preset]);
}

Object.values(glassControls).forEach((control) => {
  control.addEventListener("input", updateGlassPreview);
  control.addEventListener("change", updateGlassPreview);
});

Object.values(adaptiveColorControls).forEach((control) => {
  control.addEventListener("input", updateGlassPreview);
  control.addEventListener("change", updateGlassPreview);
});

document.querySelectorAll("#glass-presets button").forEach((button) => {
  button.addEventListener("click", () => applyGlassPreset(button.dataset.preset));
});

document.getElementById("btn-save-glass").addEventListener("click", () => {
  post("updateGlassConfig", {
    glass: collectGlassConfig(),
    adaptiveColors: collectAdaptiveColorConfig(),
  });
});

function setStatus(el, text, state) {
  el.textContent = text;
  if (state === "ok") {
    el.style.color = "#6ccf7d";
  } else if (state === "warn") {
    el.style.color = "#f0b45b";
  } else if (state === "bad") {
    el.style.color = "#ff7979";
  } else {
    el.style.color = "";
  }
}

async function checkHTTP() {
  const el = document.getElementById("http-status");
  setStatus(el, "Checking", "warn");
  try {
    const started = Date.now();
    const res = await fetch(SERVER_ROOT + "/ping");
    const ms = Date.now() - started;
    setStatus(el, res.ok || res.status === 205 ? `OK ${ms}ms` : `HTTP ${res.status}`, res.ok || res.status === 205 ? "ok" : "bad");
  } catch {
    setStatus(el, "Failed", "bad");
  }
}

function checkWS() {
  const el = document.getElementById("ws-status");
  setStatus(el, "Connecting", "warn");
  try {
    const ws = new WebSocket(SERVER_ROOT.replace("http", "ws"));
    const started = Date.now();
    ws.onopen = () => {
      setStatus(el, `OK ${Date.now() - started}ms`, "ok");
      ws.close();
    };
    ws.onerror = () => setStatus(el, "Failed", "bad");
  } catch {
    setStatus(el, "Failed", "bad");
  }
}

document.getElementById("btn-refresh").addEventListener("click", () => post("refresh"));
document.getElementById("btn-switch").addEventListener("click", () => post("switch"));
document.getElementById("btn-add-custom").addEventListener("click", () => post("addCustomWallpaper"));
document.getElementById("btn-browser").addEventListener("click", () => post("openBrowser"));
document.getElementById("btn-folder").addEventListener("click", () => post("openFolder"));
document.getElementById("btn-detect-library").addEventListener("click", () => {
  setLibraryDetectionState({ state: "checking" });
  post("detectWorkshopPath");
});
document.getElementById("btn-add-custom-library").addEventListener("click", () => post("addCustomWallpaper"));
document.getElementById("btn-select-background").addEventListener("click", () => post("switch"));
const chkShowUnsupported = document.getElementById("chk-show-unsupported");
chkShowUnsupported.checked = window.showUnsupportedWallpapers === true;
chkShowUnsupported.addEventListener("change", () => {
  post("toggleUnsupportedWallpapers", { enabled: chkShowUnsupported.checked });
});
document.getElementById("btn-test-http").addEventListener("click", checkHTTP);
document.getElementById("btn-test-ws").addEventListener("click", checkWS);
document.getElementById("btn-stop-server").addEventListener("click", () => {
  post("stopServer");
  setStatus(document.getElementById("http-status"), "Stopped", "bad");
  setStatus(document.getElementById("ws-status"), "Stopped", "bad");
});

document.getElementById("search-input").addEventListener("input", (event) => {
  const term = event.target.value.toLowerCase();
  document.querySelectorAll("#propsPanel .control-item").forEach((item) => {
    item.classList.toggle("hidden", !item.textContent.toLowerCase().includes(term));
  });
});

function updateProp(key, value) {
  post("updateProp", { key, value });
}

function updateGeneral(key, value) {
  post("updateGeneral", { key, value });
}

function setLibraryDetectionState(data) {
  const status = document.getElementById("library-status");
  const libraryPath = document.getElementById("library-path");
  const candidates = document.getElementById("library-candidates");
  const button = document.getElementById("btn-detect-library");

  candidates.innerHTML = "";
  button.disabled = data.state === "checking";

  if (data.state === "checking") {
    setStatus(status, "Detecting", "warn");
    return;
  }

  if (data.state === "found") {
    setStatus(status, "Detected", "ok");
    libraryPath.textContent = data.path;
    (data.candidates || []).slice(0, 4).forEach((candidate) => {
      const row = document.createElement("div");
      row.className = "candidate-row";
      const source = document.createElement("span");
      const state = document.createElement("strong");
      const pathText = document.createElement("code");

      source.textContent = candidate.source;
      state.textContent = candidate.hasWallpapers ? "Ready" : "Empty";
      pathText.textContent = candidate.path;

      row.appendChild(source);
      row.appendChild(state);
      row.appendChild(pathText);
      candidates.appendChild(row);
    });
    return;
  }

  if (data.state === "missing") {
    setStatus(status, "Not found", "bad");
    return;
  }

  if (data.state === "error") {
    setStatus(status, data.message || "Error", "bad");
    return;
  }

  setStatus(status, "Ready", "");
}

window.addEventListener("message", (event) => {
  const message = event.data;
  if (message && message.type === "workshopDetection") {
    setLibraryDetectionState(message);
  }
});

function getSafeValue(property) {
  if (property.value !== undefined && property.value !== null) {
    return property.value;
  }
  if (property.default !== undefined && property.default !== null) {
    return property.default;
  }
  if (property.type === "color") {
    return "1 1 1";
  }
  if (property.type === "slider") {
    return property.min || 0;
  }
  if (property.type === "bool") {
    return false;
  }
  if (property.type === "combo") {
    return (property.options && property.options[0] && property.options[0].value) || "";
  }
  return "";
}

function weColorToHex(value) {
  if (!value || typeof value !== "string") {
    return "#ffffff";
  }
  const parts = value.split(" ").map(parseFloat);
  if (parts.length < 3) {
    return "#ffffff";
  }
  const toHex = (number) => {
    const hex = Math.floor(Math.min(1, Math.max(0, number)) * 255).toString(16);
    return hex.length === 1 ? "0" + hex : hex;
  };
  return `#${toHex(parts[0])}${toHex(parts[1])}${toHex(parts[2])}`;
}

function addControl(panel, label, input) {
  const row = document.createElement("div");
  row.className = "control-item";

  const text = document.createElement("label");
  text.textContent = label;
  row.appendChild(text);
  row.appendChild(input);
  panel.appendChild(row);
}

function renderGeneralSettings() {
  const panel = document.getElementById("generalPanel");
  panel.innerHTML = "";

  const audioSelect = document.createElement("select");
  const audioOptions = [
    ["system", "System (speaker loopback)"],
    ["simulate", "Simulate"],
    ["off", "Off"],
  ];
  // Mic is opt-in (useless with headphones); only offer it when enabled or already selected.
  if (window.micEnabled || window.audioSource === "mic") {
    audioOptions.splice(1, 0, ["mic", "Microphone"]);
  }
  audioOptions.forEach(([value, label]) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    audioSelect.appendChild(option);
  });
  audioSelect.value = window.audioSource || "system";
  audioSelect.addEventListener("change", (event) => updateGeneral("audioSource", event.target.value));
  addControl(panel, "Audio Source", audioSelect);

  const interactionCheckbox = document.createElement("input");
  interactionCheckbox.type = "checkbox";
  interactionCheckbox.checked = window.interactionEnabled !== false;
  interactionCheckbox.addEventListener("change", (event) => updateGeneral("interactionEnabled", event.target.checked));
  addControl(panel, "Interaction (mouse)", interactionCheckbox);
}

function renderWallpaperProperties(json) {
  const panel = document.getElementById("propsPanel");
  panel.innerHTML = "";
  const props = json.properties || (json.general && json.general.properties) || {};

  if (Object.keys(props).length === 0) {
    panel.textContent = "No editable wallpaper properties.";
    return;
  }

  Object.keys(props).forEach((key) => {
    const property = props[key];
    const safeValue = getSafeValue(property);
    let input;

    if (property.type === "slider") {
      input = document.createElement("input");
      input.type = "range";
      input.min = property.min ?? 0;
      input.max = property.max ?? 100;
      input.step = property.step ?? 1;
      input.value = safeValue;
      input.addEventListener("input", (event) => updateProp(key, parseFloat(event.target.value)));
    } else if (property.type === "color") {
      input = document.createElement("input");
      input.type = "color";
      input.value = weColorToHex(safeValue);
      input.addEventListener("input", (event) => {
        const hex = event.target.value;
        const r = parseInt(hex.slice(1, 3), 16) / 255;
        const g = parseInt(hex.slice(3, 5), 16) / 255;
        const b = parseInt(hex.slice(5, 7), 16) / 255;
        updateProp(key, `${r.toFixed(3)} ${g.toFixed(3)} ${b.toFixed(3)}`);
      });
    } else if (property.type === "bool") {
      input = document.createElement("input");
      input.type = "checkbox";
      input.checked = Boolean(safeValue);
      input.addEventListener("change", (event) => updateProp(key, event.target.checked));
    } else if (property.type === "combo") {
      input = document.createElement("select");
      (property.options || []).forEach((optionData) => {
        const option = document.createElement("option");
        option.value = optionData.value;
        option.textContent = optionData.label;
        option.selected = optionData.value === safeValue;
        input.appendChild(option);
      });
      input.addEventListener("change", (event) => updateProp(key, event.target.value));
    } else {
      input = document.createElement("input");
      input.type = "text";
      input.value = safeValue;
      input.addEventListener("change", (event) => updateProp(key, event.target.value));
    }

    addControl(panel, property.text || key, input);
  });
}

const chkTransparencyEnabled = document.getElementById("chk-transparency-enabled");
const transparencyPanel = document.getElementById("transparencyPanel");
const btnSaveTransparency = document.getElementById("btn-save-transparency");

function updateTransparencyUIState() {
  const enabled = chkTransparencyEnabled.checked;
  transparencyPanel.style.opacity = enabled ? "1" : "0.48";
  transparencyPanel.style.pointerEvents = enabled ? "auto" : "none";
  btnSaveTransparency.disabled = !enabled;
}

chkTransparencyEnabled.checked = window.transparencyEnabled !== false;
chkTransparencyEnabled.addEventListener("change", () => {
  updateTransparencyUIState();
  post("toggleTransparency", { enabled: chkTransparencyEnabled.checked });
});

document.getElementById("btn-save-base-color").addEventListener("click", () => {
  const color = document.getElementById("input-base-color").value.trim();
  if (color && !/^#[0-9A-Fa-f]{6}$/.test(color)) {
    return;
  }
  post("updateTransparencyBaseColor", { color });
});

function renderTransparencyRules() {
  const keys = window.transparencyKeys || [];
  const rules = window.transparencyRules || {};
  transparencyPanel.innerHTML = "";

  keys.forEach((key) => {
    const row = document.createElement("div");
    row.className = "rule-row";
    row.dataset.key = key;

    const label = document.createElement("label");
    label.textContent = key;

    const controls = document.createElement("div");
    controls.className = "rule-controls";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = rules[key] !== undefined;

    const slider = document.createElement("input");
    slider.type = "range";
    slider.min = "0";
    slider.max = "1";
    slider.step = "0.01";
    slider.value = rules[key] !== undefined ? rules[key] : 0;

    const value = document.createElement("output");
    value.textContent = Number(slider.value).toFixed(2);

    checkbox.addEventListener("change", () => {
      slider.disabled = !checkbox.checked;
    });
    slider.addEventListener("input", () => {
      value.textContent = Number(slider.value).toFixed(2);
    });

    slider.disabled = !checkbox.checked;
    controls.appendChild(checkbox);
    controls.appendChild(slider);
    controls.appendChild(value);
    row.appendChild(label);
    row.appendChild(controls);
    transparencyPanel.appendChild(row);
  });
}

document.getElementById("btn-save-transparency").addEventListener("click", () => {
  const rules = {};
  document.querySelectorAll("#transparencyPanel .rule-row").forEach((row) => {
    const checkbox = row.querySelector("input[type='checkbox']");
    const slider = row.querySelector("input[type='range']");
    if (checkbox.checked) {
      rules[row.dataset.key] = parseFloat(slider.value);
    }
  });
  post("updateTransparencyRules", { rules });
});

document.getElementById("btn-edit-css").addEventListener("click", () => post("editCustomCss"));
document.getElementById("btn-save-css").addEventListener("click", () => {
  post("updateCss", { customCss: document.getElementById("input-custom-css").value });
});

const initialAdaptiveColors = window.adaptiveColorConfig || { enabled: true, strength: 0.68 };
adaptiveColorControls.enabled.checked = initialAdaptiveColors.enabled !== false;
adaptiveColorControls.strength.value = clamp(initialAdaptiveColors.strength ?? 0.68, 0, 1);
setGlassControls(window.glassConfig || PRESETS.liquid);
renderGeneralSettings();
renderTransparencyRules();
updateTransparencyUIState();
setTimeout(() => {
  checkHTTP();
  checkWS();
}, 700);

if (document.getElementById("library-path").textContent === "Not detected") {
  setTimeout(() => {
    setLibraryDetectionState({ state: "checking" });
    post("detectWorkshopPath");
  }, 300);
}

fetch(SERVER_ROOT + "/project.json")
  .then((res) => res.json())
  .then((json) => renderWallpaperProperties(json))
  .catch((error) => {
    document.getElementById("propsPanel").textContent = `Error: ${error.message}`;
  });
