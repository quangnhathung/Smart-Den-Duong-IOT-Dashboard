/* Live-only observation harness. Production app/response/polling/control remain unchanged. */
(() => {
  const receiver = "http://127.0.0.1:18765";
  const frame = document.getElementById("dashboard");
  const status = document.getElementById("status");
  const display = document.getElementById("events");
  const epoch = () => performance.timeOrigin + performance.now();
  const pageId = crypto.randomUUID();
  const observations = new Map();
  const completed = new Set();
  let trial = {}, version = 0, lastUi = "", inspectFrame = () => {};
  const markStart = document.getElementById("markStart");
  const trialHint = document.getElementById("trialHint");
  let markedTrial = "";
  let marker = null;
  let clockOffsetHigh = Infinity;
  markStart.addEventListener("click", async () => {
    if (!trial.id || document.visibilityState !== "visible") return;
    markStart.disabled = true;
    try {
      const selected = { ...trial };
      const state = await (await fetch(receiver + "/state", { cache: "no-store" })).json();
      const baseline = state.latest;
      if (trial.id !== selected.id || trial.revision !== selected.revision) throw new Error("Lượt đo đã đổi; hãy bấm bắt đầu lại.");
      if (!baseline?.boot_id || baseline.seq === undefined) throw new Error("Chưa có baseline MQTT thật.");
      if (typeof baseline.distance_cm !== "number") throw new Error("Baseline chưa có khoảng cách hợp lệ.");
      if (Math.abs(baseline.distance_cm - selected.target_cm) <= Math.max(2, selected.target_cm * .05)) {
        await record("marker-refused", { trial: selected, baseline, reason: "Sensor already at target before marker" });
        status.textContent = "Chưa bắt đầu: cảm biến đã ở khoảng cách đích";
        trialHint.textContent = "Giữ nguyên Distance; cần chuẩn bị lượt có đích khác trước khi đo.";
        markStart.disabled = false;
        return;
      }
      const started = epoch();
      await record("manual-start-marker", { trial: selected, marker_ms: started, baseline,
        method: "Lower bound before user changes physical simulator sensor; MQTT/Serial is an upper bound, not the action timestamp" });
      marker = { trialId: selected.id, revision: selected.revision, started, baseline,
        host_upper_ms: started + clockOffsetHigh };
      markedTrial = selected.id + "/" + selected.revision;
      status.textContent = "Đang đo lượt " + trial.id + " · hãy đổi Distance";
      trialHint.textContent = "Đổi Distance về khoảng " + trial.target_cm + " cm, giữ nguyên và giữ tab này nhìn thấy đến khi đã ghi.";
    } catch (error) { show(String(error)); markStart.disabled = false; }
  });
  function show(value) { display.textContent = JSON.stringify(value) + "\n" + display.textContent.slice(0, 4000); }
  async function record(event, data = {}) {
    const item = { source: "browser", event, recorder_version: "marker-baseline-v2", page_id: pageId, time_origin: performance.timeOrigin,
      visibility: document.visibilityState, browser_ms: epoch(), ...data };
    await fetch(receiver + "/events", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(item) });
  }
  async function sync() {
    const samples = [];
    for (let i = 0; i < 5; i++) {
      const before = epoch();
      const value = await (await fetch(receiver + "/time", { cache: "no-store" })).json();
      const after = epoch();
      samples.push({ before, after, host_ms: value.host_ms, rtt_ms: after - before,
        offset_low_ms: value.host_ms - after, offset_high_ms: value.host_ms - before });
    }
    clockOffsetHigh = samples.reduce((best, item) => item.rtt_ms < best.rtt_ms ? item : best).offset_high_ms;
    await record("clock-sync", { samples });
  }
  frame.addEventListener("load", async () => {
    const win = frame.contentWindow, doc = frame.contentDocument;
    const currentVersion = ++version;
    observations.clear();
    const originalFetch = win.fetch.bind(win);
    win.fetch = async (...args) => {
      const started = epoch();
      const response = await originalFetch(...args);
      const responseAt = epoch();
      if (String(args[0]).endsWith("/api/nodes")) {
        response.clone().json().then(values => {
          const node = values.find(x => x.node_id === "node_01");
          if (!node?.telemetry) return;
          const key = node.telemetry.boot_id + "/" + node.telemetry.seq;
          observations.set(key, { node, started, responseAt });
          record("fetch-nodes", { key, node, request_start_ms: started, response_ms: responseAt }).catch(show);
        }).catch(show);
      }
      return response;
    };
    function readings() {
      return Object.fromEntries([...doc.querySelectorAll("#detailReadings .reading")].map(x => [
        x.querySelector("dt")?.textContent.trim(), x.querySelector("dd")?.textContent.trim()]));
    }
    function inspect() {
      win.requestAnimationFrame(() => win.requestAnimationFrame(() => {
        if (version !== currentVersion) return;
        const values = readings();
        const key = values["Boot / sequence"]?.replace(/\s+/g, "");
        const api = observations.get(key);
        const ui = { badge: doc.getElementById("detailBadge")?.textContent.trim(),
          apiBadge: doc.getElementById("apiBadge")?.textContent.trim(),
          feedback: doc.getElementById("commandFeedback")?.textContent.trim(),
          locked: doc.getElementById("applyCommand")?.disabled,
          lockReason: doc.getElementById("controlLock")?.textContent.trim(),
          key, readings: values, visibility: doc.visibilityState,
          frame_visible: frame.getBoundingClientRect().height > 0 };
        const signature = JSON.stringify(ui);
        if (signature !== lastUi) { lastUi = signature; record("ui-state", ui).catch(show); }
        if (!trial.id || completed.has(trial.id) || !api || doc.visibilityState !== "visible") return;
        if (trial.require_marker && markedTrial !== trial.id + "/" + trial.revision) return;
        const t = api.node.telemetry;
        if (trial.require_marker && (!marker || t.boot_id !== marker.baseline.boot_id
          || BigInt(t.seq) <= BigInt(marker.baseline.seq)
          || Date.parse(api.node.last_seen) <= marker.host_upper_ms)) return;
        if (t.boot_id !== trial.boot_at_arm || BigInt(t.seq) <= BigInt(trial.seq_at_arm)) return;
        const distance = t.distance_cm;
        if (typeof distance !== "number" || Math.abs(distance - trial.target_cm) > Math.max(2, trial.target_cm * 0.05)) return;
        const expected = new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 1 }).format(distance) + " cm";
        if (values["Khoảng cách"] !== expected) return;
        completed.add(trial.id);
        const value = { trial: { ...trial }, key, telemetry: t, api_received_at: api.node.last_seen,
          render_ms: epoch(), paint_method: "MutationObserver + two requestAnimationFrame, matching boot/seq/distance",
          ui, marker, request_start_ms: api.started, response_ms: api.responseAt };
        record("render-match", value).then(() => { status.textContent = "Đã ghi lượt " + trial.id; show(value); }).catch(show);
      }));
    }
    new MutationObserver(inspect).observe(doc.documentElement, { subtree: true, childList: true, characterData: true, attributes: true });
    inspectFrame = inspect;
    win.addEventListener("error", event => record("page-error", { message: event.message }).catch(show));
    document.addEventListener("visibilitychange", () => record("visibility", { visibility: document.visibilityState }).catch(show));
    await sync();
    await record("page-ready", { url: location.href, frame_url: win.location.href, visibility: doc.visibilityState });
    status.textContent = "Bộ ghi sẵn sàng · dữ liệu live";
    inspect();
  });
  setInterval(async () => {
    try {
      const value = await (await fetch(receiver + "/state", { cache: "no-store" })).json();
      const changed = value.trial?.id && (value.trial.id !== trial.id || value.trial.revision !== trial.revision);
      trial = value.trial || {};
      if (changed) {
        await record("trial-ready", { trial });
        markStart.disabled = false;
        markStart.textContent = "Bắt đầu lượt " + trial.id;
        trialHint.textContent = "Chưa đổi Distance. Bấm bắt đầu trước khi đổi về khoảng " + trial.target_cm + " cm.";
        inspectFrame();
      }
    }
    catch (error) { status.textContent = "Chưa nối được bộ ghi18765"; show(String(error)); }
  }, 250);
})();
