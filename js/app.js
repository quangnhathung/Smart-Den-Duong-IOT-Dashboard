import { request, query, Poller } from "./api.js";
import {
  NODE_IDS,
  escapeHtml as e,
  number as n,
  dateTime as dt,
  localInput,
  utcFromInput,
  duration,
  commandBody,
  CommandTracker,
  commandLabel,
} from "./core.js";
import { chart } from "./charts.js";
const $ = (id) => document.getElementById(id),
  text = (id, value) => {
    $(id).textContent = value;
  };
const tracker = new CommandTracker(),
  drafts = new Map();
const state = {
  view: "overview",
  node: "node_01",
  nodes: [],
  health: null,
  healthOk: false,
  nodesOk: false,
  lastUpdate: null,
  slowError: "",
  stats: null,
  recent: [],
  recentLoaded: false,
  alerts: { items: [], total: 0, offset: 0 },
  experiments: { items: [], total: 0, offset: 0 },
  activeExperiment: null,
  experimentDetail: null,
  experimentBusy: false,
  history: { items: [], total: 0, offset: 0, rawPage: 0, filters: null },
  routeVersion: 0,
};
let historyController,
  experimentController,
  detailVersion = 0;
const modeName = (value) =>
  ({ AUTO: "Tự động", MANUAL: "Thủ công" })[value] ?? "—";
const environmentName = (value) =>
  ({
    DAY: "Ban ngày",
    TWILIGHT: "Hoàng hôn",
    NIGHT: "Ban đêm",
    UNKNOWN: "Chưa xác định",
  })[value] ?? "—";
const motionName = (value) =>
  ({
    NONE: "Không chuyển động",
    PEDESTRIAN: "Người giả lập",
    VEHICLE: "Xe giả lập",
    UNKNOWN: "Chưa phân loại",
  })[value] ?? "—";
function badge(label, kind = "neutral") {
  return `<span class="badge ${kind}">${e(label)}</span>`;
}
function effective(node) {
  return node && (!state.nodesOk || !state.healthOk)
    ? { ...node, freshness: "STALE", can_command: false }
    : node;
}
function nodeStatus(node) {
  if (!node?.telemetry) return ["Chưa có dữ liệu", "neutral"];
  if (node.freshness !== "FRESH")
    return [
      node.connection === "OFFLINE" ? "Offline · dữ liệu cũ" : "Dữ liệu cũ",
      "warn",
    ];
  return ["Online", "good"];
}
function replaceContent(id, html) {
  const target = $(id);
  if (target.innerHTML === html) return;
  const focused = target.contains(document.activeElement)
    ? document.activeElement.closest("a")
    : null;
  const href = focused?.getAttribute("href");
  target.innerHTML = html;
  if (href)
    [...target.querySelectorAll("a")]
      .find((link) => link.getAttribute("href") === href)
      ?.focus({ preventScroll: true });
}
function nodeBadge(node) {
  return badge(...nodeStatus(node));
}
function stamp() {
  return state.lastUpdate
    ? `Nhận gần nhất: ${dt(state.lastUpdate)}`
    : "Chưa nhận dữ liệu";
}
function renderConnection() {
  const good = state.healthOk && state.nodesOk;
  $("apiBadge").className =
    `badge ${good ? "good" : state.health ? "warn" : "neutral"}`;
  text(
    "apiBadge",
    good
      ? "Máy chủ sẵn sàng"
      : state.health
        ? "Kết nối suy giảm"
        : "Chưa kết nối API",
  );
  const message =
    !state.nodesOk || !state.health
      ? "Chưa đồng bộ được với máy chủ. Giữ dữ liệu cuối và khóa gửi lệnh."
      : !state.healthOk
        ? "Hệ thống đang suy giảm. Hãy kiểm tra kết nối máy chủ, MQTT hoặc lưu trữ; gửi lệnh tạm khóa."
        : state.slowError;
  $("connectionNotice").hidden = !message;
  text("connectionNotice", message);
  text("lastUpdated", stamp());
}
function lamp(node, index) {
  const applied = node?.telemetry?.brightness_applied,
    known = typeof applied === "number",
    fresh = node?.freshness === "FRESH";
  const opacity =
    known && fresh ? Math.max(0, Math.min(1, applied / 100)) * 0.7 : 0;
  return `<a class="road-node" href="#nodes/${NODE_IDS[index]}" aria-label="Xem ${NODE_IDS[index]}, ${known ? applied + " phần trăm" : "chưa có dữ liệu"}"><span class="lamp-tag">${known ? n(applied, 0) + "%" : "—"}${known && !fresh ? " · cũ" : ""}</span><svg class="lamp-svg" viewBox="0 0 100 150" aria-hidden="true"><path d="M55 54 15 131h77L67 54Z" fill="#f7d665" opacity="${opacity}"/><path d="M31 139h42M48 139V36q0-17 16-17h16" stroke="${fresh ? "#3d6958" : "#8ca198"}" fill="none" stroke-width="4" stroke-linecap="round"/><path d="M61 20h23v11H61Z" fill="${fresh && known && applied > 0 ? "#f6ce58" : "#c3cec8"}" stroke="${fresh ? "#3d6958" : "#8ca198"}" stroke-width="2.5"/><path d="M44 139h9v-9h-9Z" fill="#8ca198"/></svg><span class="lamp-caption">${NODE_IDS[index]} <i class="dot ${fresh ? "green" : "grey"}"></i></span></a>`;
}
function renderOverview() {
  const nodes = NODE_IDS.map((id) =>
    effective(state.nodes.find((x) => x.node_id === id)),
  );
  text(
    "onlineCount",
    state.nodes.length
      ? nodes.filter(
          (x) => x?.connection === "ONLINE" && x.freshness === "FRESH",
        ).length
      : "—",
  );
  text(
    "nodeSummary",
    state.nodes.length
      ? `${nodes.filter((x) => x?.telemetry).length} node có dữ liệu · ${nodes.filter((x) => !x?.telemetry).length} chưa ghi nhận`
      : "Đang chờ dữ liệu từ máy chủ",
  );
  text(
    "faultCount",
    state.nodes.length
      ? state.nodes.filter((x) => x.faults?.includes("OPEN_LOAD")).length
      : "—",
  );
  const count =
    state.stats?.nodes?.reduce((sum, v) => sum + v.sample_count, 0) ?? 0;
  text("energyValue", count ? n(state.stats.total_energy_wh, 3) : "—");
  text("coverageValue", state.stats ? n(state.stats.coverage_percent, 1) : "—");
  replaceContent("roadNodes", nodes.map(lamp).join(""));
  replaceContent(
    "nodeCards",
    nodes
      .map((node, i) => {
        const data = node?.telemetry;
        return `<article class="card node-card"><div class="node-heading"><span class="node-name"><span class="node-number">0${i + 1}</span>${NODE_IDS[i]}</span>${nodeBadge(node)}</div><div class="node-meta">${data ? `${e(modeName(data.mode))} · ${e(environmentName(data.environment))}` : "Chưa nhận telemetry"}</div><div class="node-light"><span>Độ sáng áp dụng</span><strong>${data ? n(data.brightness_applied, 0) + "<small>%</small>" : "—"}</strong></div><div class="progress" aria-hidden="true"><span style="width:${data ? Math.max(0, Math.min(100, data.brightness_applied)) : 0}%"></span></div><div class="node-stats"><span>Mục tiêu <b>${data ? n(data.brightness_target, 0) + "%" : "—"}</b></span><span>Công suất <b>${data ? n(data.power_sim_w) + " W" : "—"}</b></span></div><div class="node-foot"><span>${node?.faults?.length ? "Lỗi tải: OPEN_LOAD" : data ? e(motionName(data.motion)) : "Chờ kết nối"}</span><a href="#nodes/${NODE_IDS[i]}">Chi tiết <svg class="icon"><use href="#i-arrow"/></svg></a></div></article>`;
      })
      .join(""),
  );
  $("healthRows").innerHTML = [
    ["Máy chủ API", state.nodesOk],
    ["Kết nối MQTT", state.health?.broker],
    ["Lưu trữ dữ liệu", state.health?.database],
    ["Xử lý sự kiện", state.health?.queue],
  ]
    .map(
      ([label, value]) =>
        `<div class="health-row"><span>${label}</span>${badge(value === true ? "Hoạt động" : value === false ? "Chưa sẵn sàng" : "Đang kiểm tra", value === true ? "good" : value === false ? "warn" : "neutral")}</div>`,
    )
    .join("");
  $("recentAlerts").innerHTML = state.recent.length
    ? state.recent
        .slice(0, 4)
        .map(
          (value) =>
            `<div class="event-row"><span class="event-symbol"><svg class="icon"><use href="#i-bell"/></svg></span><div>${e(value.node_id)} · ${value.kind === "OPEN_LOAD" ? "Lỗi tải mô phỏng" : "Mất kết nối"}<small>${dt(value.started_at)}</small></div>${badge(value.ended_at ? "Đã kết thúc" : "Đang mở", value.ended_at ? "neutral" : "warn")}</div>`,
        )
        .join("")
    : state.recentLoaded
      ? '<p class="empty">Chưa có cảnh báo được ghi nhận.</p>'
      : '<p class="empty">Đang chờ dữ liệu cảnh báo từ máy chủ.</p>';
}
function detailNode() {
  return effective(state.nodes.find((x) => x.node_id === state.node));
}
function draftFor(node) {
  if (!drafts.has(node.node_id))
    drafts.set(node.node_id, {
      mode: "AUTO",
      brightness: "80",
      initialized: false,
      dirty: false,
    });
  const draft = drafts.get(node.node_id);
  if (node.telemetry && !draft.initialized && !draft.dirty) {
    draft.mode = node.telemetry.mode;
    draft.brightness = String(node.telemetry.brightness_target);
    draft.initialized = true;
    if (state.node === node.node_id) {
      $("controlMode").value = draft.mode;
      $("brightness").value = draft.brightness;
      $("brightnessNumber").value = draft.brightness;
    }
  }
  return draft;
}
function renderDetail() {
  const node = detailNode(),
    data = node?.telemetry,
    draft = draftFor(node ?? { node_id: state.node });
  $("detailBadge").outerHTML =
    `<span id="detailBadge" class="badge ${nodeStatus(node)[1]}">${e(nodeStatus(node)[0])}</span>`;
  const readings = [
    ["Chế độ đang chạy", modeName(data?.mode)],
    ["Môi trường", environmentName(data?.environment)],
    [
      "Mục tiêu / đang áp dụng",
      data
        ? `${n(data.brightness_target, 0)}% / ${n(data.brightness_applied, 0)}%`
        : "—",
    ],
    ["Chuyển động", motionName(data?.motion)],
    ["LDR · ADC raw", n(data?.ldr_adc, 0)],
    ["Tải · ADC raw", n(data?.current_adc, 0)],
    [
      "Khoảng cách",
      data?.distance_cm == null ? "—" : n(data.distance_cm) + " cm",
    ],
    [
      "Dòng / công suất mô phỏng",
      data ? `${n(data.current_ma_sim)} mA / ${n(data.power_sim_w)} W` : "—",
    ],
    [
      "Fault tải",
      data
        ? data.faults.length
          ? "OPEN_LOAD"
          : "Không có lỗi tải"
        : "Chưa có dữ liệu",
    ],
    ["Nhận dữ liệu lần cuối", dt(node?.last_seen)],
    ["Uptime node", duration(data?.uptime_ms)],
    ["Boot / sequence", data ? `${data.boot_id} / ${data.seq}` : "—"],
  ];
  $("detailReadings").innerHTML = readings
    .map(
      ([label, value]) =>
        `<div class="reading"><dt>${e(label)}</dt><dd>${e(value)}</dd></div>`,
    )
    .join("");
  const lock =
    !state.healthOk || !state.nodesOk
      ? "Máy chủ chưa sẵn sàng hoặc dữ liệu chưa đồng bộ."
      : !node?.telemetry
        ? "Node chưa có dữ liệu."
        : node.freshness !== "FRESH"
          ? "Dữ liệu đã cũ hoặc node đang offline."
          : tracker.locked(state.node) || node.pending_command_id
            ? "Đang gửi hoặc chờ xác nhận; chưa thể gửi lệnh mới."
            : !node.can_command
              ? "Node chưa cho phép điều khiển: dữ liệu có thể quá 3 giây hoặc đang có lệnh chờ."
              : "";
  text("controlLock", lock || "Sẵn sàng gửi yêu cầu đến " + state.node + ".");
  $("controlLock").style.color = lock ? "#92400e" : "#047857";
  $("applyCommand").disabled = !!lock;
  $("controlMode").disabled = !!lock;
  $("brightness").disabled = !!lock || draft.mode !== "MANUAL";
  $("brightnessNumber").disabled = !!lock || draft.mode !== "MANUAL";
  const feedback = commandLabel(tracker.get(state.node));
  if ($("commandFeedback").textContent !== feedback)
    text("commandFeedback", feedback);
}
function syncDraft() {
  const draft = draftFor(detailNode() ?? { node_id: state.node });
  $("controlMode").value = draft.mode;
  $("brightness").value = draft.brightness;
  $("brightnessNumber").value = draft.brightness;
}
async function fast(signal) {
  const values = await Promise.allSettled([
    request("/api/health", { signal }),
    request("/api/nodes", { signal }),
  ]);
  if (signal.aborted) return;
  state.healthOk =
    values[0].status === "fulfilled" && values[0].value.status === "OK";
  if (values[0].status === "fulfilled") state.health = values[0].value;
  state.nodesOk = values[1].status === "fulfilled";
  if (state.nodesOk) {
    state.nodes = values[1].value;
    state.lastUpdate = new Date().toISOString();
    for (const node of state.nodes) tracker.observe(node);
  }
  await Promise.all(
    state.nodes.map(async (node) => {
      const current = tracker.get(node.node_id);
      if (!current.id || !["PENDING", "UNCERTAIN"].includes(current.kind))
        return;
      try {
        const result = await request(
          "/api/commands/" + encodeURIComponent(current.id),
          { signal },
        );
        if (!signal.aborted && tracker.get(node.node_id).id === current.id)
          tracker.accepted(node.node_id, result);
      } catch (error) {
        if (
          error.name !== "AbortError" &&
          !signal.aborted &&
          tracker.get(node.node_id).id === current.id
        )
          tracker.set(node.node_id, {
            kind: "UNCERTAIN",
            detail: error.message,
            reconciled: false,
          });
      }
    }),
  );
  if (signal.aborted) return;
  renderConnection();
  if (state.view === "overview") renderOverview();
  if (state.view === "nodes") renderDetail();
}
function statsStrip(value) {
  if (!value) return "";
  const count = value.nodes?.reduce((sum, x) => sum + x.sample_count, 0) ?? 0;
  return [
    [
      "Tổng điện năng mô phỏng",
      count ? n(value.total_energy_wh, 3) + " Wh" : "—",
    ],
    ["AUTO đủ điều kiện", count ? n(value.auto_energy_wh, 3) + " Wh" : "—"],
    ["Baseline cùng khoảng", count ? n(value.baseline_wh, 3) + " Wh" : "—"],
    [
      "Tiết kiệm AUTO",
      value.saving_percent == null ? "—" : n(value.saving_percent) + "%",
    ],
    ["Độ phủ · thời gian nhận", n(value.coverage_percent) + "%"],
    ["Uptime hợp lệ", n(value.valid_uptime_s, 0) + " s"],
  ]
    .map(
      ([label, result]) =>
        `<div class="stat-item">${e(label)}<strong>${e(result)}</strong></div>`,
    )
    .join("");
}
async function loadAlerts(signal) {
  const node = $("alertNode").value;
  const page = await request(
    "/api/alerts?" +
      query({ node_id: node, limit: 100, offset: state.alerts.offset }),
    { signal },
  );
  if (signal?.aborted || node !== $("alertNode").value) return;
  state.alerts = { ...page, offset: state.alerts.offset };
  $("alertRows").innerHTML = page.items.length
    ? page.items
        .map(
          (v) =>
            `<tr><td>${e(v.node_id)}</td><td>${v.kind === "OPEN_LOAD" ? "Lỗi tải mô phỏng" : "Mất kết nối"}</td><td>${badge(v.ended_at ? "Đã kết thúc" : "Đang mở", v.ended_at ? "neutral" : "warn")}</td><td>${dt(v.started_at)}</td><td>${dt(v.ended_at)}</td></tr>`,
        )
        .join("")
    : '<tr><td colspan="5" class="empty">Chưa có cảnh báo trong trang này.</td></tr>';
  text(
    "alertPageLabel",
    `${page.total} cảnh báo · trang ${Math.floor(page.offset / 100) + 1}`,
  );
  text("alertsMessage", "");
  $("alertsPrevious").disabled = page.offset === 0;
  $("alertsNext").disabled = page.offset + page.limit >= page.total;
}
async function loadExperiments(signal) {
  const offset = state.experiments.offset;
  const [page, activePage] = await Promise.all([
    request("/api/experiments?" + query({ limit: 100, offset }), { signal }),
    offset
      ? request("/api/experiments?limit=100&offset=0", { signal })
      : Promise.resolve(null),
  ]);
  if (signal?.aborted || offset !== state.experiments.offset) return;
  state.experiments = { ...page, offset };
  state.activeExperiment =
    (activePage ?? page).items.find((x) => x.ended_at == null) ?? null;
  const current = $("historyExperiment").value,
    oldOption = [...$("historyExperiment").options].find(
      (o) => o.value === current,
    );
  const options =
    '<option value="">Khoảng thời gian</option>' +
    page.items
      .map((v) => `<option value="${v.id}">${e(v.name)} · #${v.id}</option>`)
      .join("");
  if (document.activeElement !== $("historyExperiment")) {
    if ($("historyExperiment").innerHTML !== options)
      $("historyExperiment").innerHTML = options;
    if (
      current &&
      ![...$("historyExperiment").options].some((o) => o.value === current) &&
      oldOption
    )
      $("historyExperiment").append(oldOption);
    $("historyExperiment").value = current;
  }
  $("experimentList").innerHTML = page.items.length
    ? page.items
        .map(
          (v) =>
            `<div class="experiment-item"><button type="button" data-experiment="${v.id}"><strong>${e(v.name)}</strong><small>#${v.id} · ${dt(v.started_at)}</small></button>${badge(v.ended_at ? "Đã dừng" : "Đang đo", v.ended_at ? "neutral" : "good")}</div>`,
        )
        .join("")
    : '<p class="empty">Chưa có phiên thực nghiệm. Tạo phiên khi đã sẵn sàng đo.</p>';
  text(
    "experimentPageLabel",
    `${page.total} phiên · trang ${Math.floor(offset / 100) + 1}`,
  );
  $("experimentsPrevious").disabled = offset === 0;
  $("experimentsNext").disabled = offset + 100 >= page.total;
  $("startExperiment").disabled =
    state.experimentBusy || !!state.activeExperiment;
  text(
    "experimentMessage",
    state.activeExperiment
      ? `Phiên đang mở: ${state.activeExperiment.name} (#${state.activeExperiment.id}).`
      : "Chưa có phiên đang mở.",
  );
  if (state.view === "experiments" && state.experimentDetail)
    await loadExperimentDetail(state.experimentDetail.id, signal);
}
async function slow(signal) {
  const version = state.routeVersion;
  try {
    if (state.view === "overview") {
      const [stats, recent] = await Promise.all([
        request("/api/stats", { signal }),
        request("/api/alerts?limit=4", { signal }),
      ]);
      if (signal.aborted || version !== state.routeVersion) return;
      state.stats = stats;
      state.recent = recent.items;
      state.recentLoaded = true;
      text("alertCount", recent.total);
      renderOverview();
    } else if (state.view === "alerts") await loadAlerts(signal);
    else if (["experiments", "history"].includes(state.view))
      await loadExperiments(signal);
    if (!signal.aborted) {
      state.slowError = "";
      renderConnection();
    }
  } catch (error) {
    if (error.name === "AbortError") return;
    state.slowError =
      "Một số dữ liệu chưa cập nhật được. Giá trị cuối đang được giữ lại.";
    renderConnection();
    if (state.view === "alerts") text("alertsMessage", error.message);
    if (state.view === "experiments") text("experimentMessage", error.message);
  }
}
async function loadHistory(filters, offset = 0) {
  historyController?.abort();
  const controller = new AbortController();
  historyController = controller;
  text("historyMessage", "Đang tải dữ liệu…");
  try {
    const queryValues = { ...filters, limit: 1000, offset };
    delete queryValues.node;
    const [page, stats] = await Promise.all([
      request(
        `/api/nodes/${encodeURIComponent(filters.node)}/history?${query(queryValues)}`,
        { signal: controller.signal },
      ),
      request(
        "/api/stats?" +
          query({
            ...queryValues,
            node_id: filters.node,
            limit: undefined,
            offset: undefined,
          }),
        { signal: controller.signal },
      ),
    ]);
    if (controller.signal.aborted) return;
    state.history = { ...page, offset, rawPage: 0, filters };
    text(
      "historyMessage",
      `${filters.node} · Đang xem ${page.items.length ? offset + 1 : 0}–${offset + page.items.length}/${page.total} mẫu. Biểu đồ chỉ thể hiện trang này${page.items.length ? " · " + dt(page.items[0].received_at) + " → " + dt(page.items.at(-1).received_at) : ""}.`,
    );
    $("historyStats").innerHTML = statsStrip(stats);
    $("brightnessChart").innerHTML = chart(page.items, "brightness_applied", {
      label: "Độ sáng áp dụng",
      unit: "%",
      color: "#047857",
      max: 100,
    });
    $("powerChart").innerHTML = chart(page.items, "power_sim_w", {
      label: "Công suất mô phỏng",
      unit: "W",
      color: "#2563eb",
    });
    text("historyPageLabel", `Trang ${Math.floor(offset / 1000) + 1}`);
    $("historyPrevious").disabled = offset === 0;
    $("historyNext").disabled = offset + 1000 >= page.total;
    $("sampleIndex").max = Math.max(0, page.items.length - 1);
    $("sampleIndex").value = 0;
    $("sampleIndex").disabled = !page.items.length;
    renderSample();
    renderRaw();
  } catch (error) {
    if (error.name !== "AbortError")
      text(
        "historyMessage",
        error.message +
          (state.history.filters
            ? ` Vẫn hiển thị dữ liệu đã tải của ${state.history.filters.node}.`
            : ""),
      );
  }
}
function renderRaw() {
  const h = state.history,
    offset = h.rawPage * 100,
    rows = h.items.slice(offset, offset + 100);
  $("historyRows").innerHTML = rows.length
    ? rows
        .map((v) => {
          const t = v.telemetry;
          return `<tr><td>${dt(v.received_at)}</td><td>${e(modeName(t.mode))}<small>${e(environmentName(t.environment))}</small></td><td>${n(t.brightness_target, 0)}% / ${n(t.brightness_applied, 0)}%</td><td>${n(t.power_sim_w)} W</td><td>${t.distance_cm == null ? "—" : n(t.distance_cm) + " cm"}</td><td>${badge(v.quality, v.quality === "ACCEPTED" ? "good" : "warn")}</td></tr>`;
        })
        .join("")
    : '<tr><td colspan="6" class="empty">Không có mẫu trong khoảng đã chọn.</td></tr>';
  text(
    "rawPageLabel",
    `Dòng ${rows.length ? offset + 1 : 0}–${offset + rows.length}/${h.items.length} của trang đang tải`,
  );
  $("rawPrevious").disabled = h.rawPage === 0;
  $("rawNext").disabled = offset + 100 >= h.items.length;
}
function renderSample() {
  const row = state.history.items[Number($("sampleIndex").value)];
  text(
    "sampleValue",
    row
      ? `${dt(row.received_at)} · applied ${n(row.telemetry.brightness_applied, 0)}% · ${n(row.telemetry.power_sim_w)} W · ${row.quality}`
      : "Chưa có mẫu để xem.",
  );
}
async function loadExperimentDetail(id, signal) {
  const version = ++detailVersion;
  if (!signal) {
    experimentController?.abort();
    experimentController = new AbortController();
    signal = experimentController.signal;
  }
  try {
    const [value, stats] = await Promise.all([
      request("/api/experiments/" + id, { signal }),
      request("/api/stats?experiment_id=" + id, { signal }),
    ]);
    if (signal.aborted || version !== detailVersion) return;
    state.experimentDetail = value;
    $("experimentDetail").hidden = false;
    text("experimentDetailTitle", `${value.name} · #${value.id}`);
    text(
      "experimentDetailTime",
      `${dt(value.started_at)} → ${value.ended_at ? dt(value.ended_at) : "Đang đo"}`,
    );
    text("experimentDetailNotes", value.notes || "Chưa có ghi chú.");
    text(
      "experimentDetailConfig",
      JSON.stringify(value.configuration, null, 2),
    );
    $("experimentStats").innerHTML = statsStrip(stats);
    $("stopExperiment").disabled = !!value.ended_at || state.experimentBusy;
    $("exportExperiment").disabled = state.experimentBusy;
  } catch (error) {
    if (error.name !== "AbortError")
      text("experimentActionMessage", error.message);
  }
}
async function submitCommand(event) {
  event.preventDefault();
  const node = state.node;
  let body;
  try {
    body = commandBody(
      draftFor(detailNode() ?? { node_id: node }).mode,
      $("brightnessNumber").value,
    );
  } catch (error) {
    text("commandFeedback", error.message);
    $("brightnessNumber").focus();
    return;
  }
  if ($("applyCommand").disabled || !tracker.begin(node)) return;
  renderDetail();
  try {
    const result = await request(`/api/nodes/${node}/commands`, {
      method: "POST",
      body,
    });
    tracker.accepted(node, result);
  } catch (error) {
    tracker.failed(node, error);
  } finally {
    if (state.view === "nodes" && state.node === node) renderDetail();
    fastPoll.run();
  }
}
async function mutateExperiment(event) {
  event.preventDefault();
  if (state.experimentBusy) return;
  let config;
  try {
    config = JSON.parse($("experimentConfig").value);
    if (!config || Array.isArray(config) || typeof config !== "object")
      throw new Error();
  } catch {
    text("experimentMessage", "Cấu hình phải là một JSON object hợp lệ.");
    $("experimentConfig").focus();
    return;
  }
  state.experimentBusy = true;
  $("startExperiment").disabled = true;
  try {
    const result = await request("/api/experiments", {
      method: "POST",
      body: {
        name: $("experimentName").value,
        configuration: config,
        notes: $("experimentNotes").value,
      },
    });
    state.experiments.offset = 0;
    await loadExperiments();
    await loadExperimentDetail(result.id);
    text("experimentMessage", "Đã bắt đầu phiên " + result.name + ".");
  } catch (error) {
    text("experimentMessage", error.message);
    if (error.status === 409) {
      await loadExperiments().catch(() => {});
      if (state.activeExperiment)
        await loadExperimentDetail(state.activeExperiment.id);
    }
  } finally {
    state.experimentBusy = false;
    $("startExperiment").disabled = !!state.activeExperiment;
    if (state.experimentDetail) {
      $("stopExperiment").disabled = !!state.experimentDetail.ended_at;
      $("exportExperiment").disabled = false;
    }
  }
}
async function stopExperiment() {
  const id = state.experimentDetail?.id;
  if (!id || state.experimentBusy) return;
  state.experimentBusy = true;
  $("stopExperiment").disabled = true;
  try {
    await request(`/api/experiments/${id}/stop`, { method: "POST" });
    await loadExperiments();
    await loadExperimentDetail(id);
    text(
      "experimentActionMessage",
      "Phiên đã dừng. Dữ liệu vẫn được lưu trên máy chủ.",
    );
  } catch (error) {
    text("experimentActionMessage", error.message + " Không tự gửi lại.");
  } finally {
    state.experimentBusy = false;
    $("stopExperiment").disabled = !!state.experimentDetail?.ended_at;
    $("exportExperiment").disabled = false;
    $("startExperiment").disabled = !!state.activeExperiment;
  }
}
async function exportExperiment() {
  const id = state.experimentDetail?.id;
  if (!id || state.experimentBusy) return;
  $("exportExperiment").disabled = true;
  try {
    const data = await request(`/api/experiments/${id}/export.csv`, {
      blob: true,
    });
    const url = URL.createObjectURL(data),
      link = document.createElement("a");
    link.href = url;
    link.download = `experiment-${id}.csv`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    text("experimentActionMessage", "Đã tải CSV của phiên #" + id + ".");
  } catch (error) {
    text("experimentActionMessage", error.message);
  } finally {
    $("exportExperiment").disabled = false;
  }
}
const pages = {
  overview: [
    "Tổng quan hệ thống",
    "Theo dõi hoạt động của tuyến đèn từ một nơi.",
  ],
  nodes: [
    "Điều khiển node",
    "Đồng bộ trạng thái thực và gửi yêu cầu có xác nhận.",
  ],
  history: [
    "Lịch sử dữ liệu",
    "Tra cứu telemetry, biểu đồ và chất lượng dữ liệu.",
  ],
  alerts: [
    "Cảnh báo hệ thống",
    "Phân biệt lỗi tải, offline và các sự kiện đã kết thúc.",
  ],
  experiments: [
    "Phiên thực nghiệm",
    "Lưu cấu hình, theo dõi khoảng đo và xuất dữ liệu.",
  ],
};
function route() {
  const parts = location.hash.replace(/^#/, "").split("/");
  if (parts[0] === "main") {
    $("main").focus();
    return;
  }
  state.view = Object.hasOwn(pages, parts[0]) ? parts[0] : "overview";
  state.routeVersion++;
  window.scrollTo(0, 0);
  if (state.routeVersion > 1) $("pageTitle").focus({ preventScroll: true });
  if (state.view === "nodes")
    state.node = NODE_IDS.includes(parts[1]) ? parts[1] : "node_01";
  historyController?.abort();
  experimentController?.abort();
  for (const [key, [title]] of Object.entries(pages)) {
    $("view-" + key).hidden = key !== state.view;
    const nav = document.querySelector(`[data-nav="${key}"]`);
    if (key === state.view) nav.setAttribute("aria-current", "page");
    else nav.removeAttribute("aria-current");
  }
  text("pageTitle", pages[state.view][0]);
  text("pageDescription", pages[state.view][1]);
  text(
    "breadcrumb",
    document
      .querySelector(`[data-nav="${state.view}"]`)
      .textContent.trim()
      .replace(/—$/, ""),
  );
  document.title = pages[state.view][0] + " · SmartLight";
  if (state.view === "overview") renderOverview();
  if (state.view === "nodes") {
    $("selectedNode").value = state.node;
    syncDraft();
    renderDetail();
  }
  slowPoll.stop();
  slowPoll.start();
  if (state.view === "history" && !state.history.filters)
    loadHistory(readHistoryFilters());
}
function readHistoryFilters() {
  const experiment = $("historyExperiment").value;
  if (experiment)
    return { node: $("historyNode").value, experiment_id: experiment };
  const start = utcFromInput($("historyFrom").value),
    end = utcFromInput($("historyTo").value);
  if (start >= end) throw new Error("Thời điểm bắt đầu phải trước kết thúc.");
  return { node: $("historyNode").value, from: start, to: end };
}
const fastPoll = new Poller(fast, 1000, {
  onError: () => {
    state.nodesOk = false;
    state.healthOk = false;
    renderConnection();
    if (state.view === "nodes") renderDetail();
  },
});
const slowPoll = new Poller(slow, 5000);
$("historyFrom").value = localInput(new Date(Date.now() - 3600000));
$("historyTo").value = localInput(new Date());
$("commandForm").addEventListener("submit", submitCommand);
$("controlMode").addEventListener("change", () => {
  const draft = draftFor(detailNode() ?? { node_id: state.node });
  draft.mode = $("controlMode").value;
  draft.dirty = true;
  renderDetail();
});
for (const id of ["brightness", "brightnessNumber"])
  $(id).addEventListener("input", () => {
    const draft = draftFor(detailNode() ?? { node_id: state.node });
    draft.brightness = $(id).value;
    draft.dirty = true;
    $(id === "brightness" ? "brightnessNumber" : "brightness").value =
      draft.brightness;
  });
$("selectedNode").addEventListener(
  "change",
  () => (location.hash = "nodes/" + $("selectedNode").value),
);
$("historyFilter").addEventListener("submit", (event) => {
  event.preventDefault();
  try {
    loadHistory(readHistoryFilters());
  } catch (error) {
    text("historyMessage", error.message);
  }
});
$("historyExperiment").addEventListener("change", () => {
  $("historyFrom").disabled = $("historyTo").disabled =
    !!$("historyExperiment").value;
});
$("historyPrevious").onclick = () =>
  loadHistory(state.history.filters, Math.max(0, state.history.offset - 1000));
$("historyNext").onclick = () =>
  loadHistory(state.history.filters, state.history.offset + 1000);
$("rawPrevious").onclick = () => {
  state.history.rawPage--;
  renderRaw();
};
$("rawNext").onclick = () => {
  state.history.rawPage++;
  renderRaw();
};
$("sampleIndex").addEventListener("input", renderSample);
$("alertNode").addEventListener("change", () => {
  state.alerts.offset = 0;
  loadAlerts().catch((error) => text("alertsMessage", error.message));
});
$("alertsPrevious").onclick = () => {
  state.alerts.offset = Math.max(0, state.alerts.offset - 100);
  loadAlerts().catch((error) => text("alertsMessage", error.message));
};
$("alertsNext").onclick = () => {
  state.alerts.offset += 100;
  loadAlerts().catch((error) => text("alertsMessage", error.message));
};
$("experimentForm").addEventListener("submit", mutateExperiment);
$("experimentList").addEventListener("click", (event) => {
  const button = event.target.closest("[data-experiment]");
  if (button) loadExperimentDetail(Number(button.dataset.experiment));
});
$("experimentsPrevious").onclick = () => {
  state.experiments.offset = Math.max(0, state.experiments.offset - 100);
  loadExperiments().catch((error) => text("experimentMessage", error.message));
};
$("experimentsNext").onclick = () => {
  state.experiments.offset += 100;
  loadExperiments().catch((error) => text("experimentMessage", error.message));
};
$("stopExperiment").onclick = stopExperiment;
$("exportExperiment").onclick = exportExperiment;
$("refresh").onclick = () => {
  fastPoll.run();
  slowPoll.run();
  if (state.view === "history") {
    try {
      loadHistory(readHistoryFilters(), 0);
    } catch (error) {
      text("historyMessage", error.message);
    }
  }
};
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    fastPoll.stop();
    slowPoll.stop();
    historyController?.abort();
    experimentController?.abort();
    state.nodesOk = false;
    state.healthOk = false;
  } else {
    renderConnection();
    if (state.view === "nodes") renderDetail();
    fastPoll.start();
    slowPoll.start();
  }
});
window.addEventListener("hashchange", route);
window.addEventListener("pagehide", () => {
  fastPoll.stop();
  slowPoll.stop();
  historyController?.abort();
  experimentController?.abort();
});
route();
fastPoll.start();
