export const NODE_IDS = ["node_01", "node_02", "node_03"];
export const escapeHtml = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
export const number = (value, digits = 1) =>
  typeof value === "number" && Number.isFinite(value)
    ? new Intl.NumberFormat("vi-VN", { maximumFractionDigits: digits }).format(
        value,
      )
    : "—";
export const dateTime = (value) =>
  value && Number.isFinite(Date.parse(value))
    ? new Intl.DateTimeFormat("vi-VN", {
        timeZone: "Asia/Ho_Chi_Minh",
        dateStyle: "short",
        timeStyle: "medium",
      }).format(new Date(value))
    : "—";
export const shortTime = (value) =>
  new Intl.DateTimeFormat("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
export const localInput = (date) => {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("sv-SE", {
      timeZone: "Asia/Ho_Chi_Minh",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
};
export function utcFromInput(value) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(value))
    throw new Error("Chọn ngày và giờ hợp lệ.");
  const date = new Date(`${value}+07:00`);
  if (
    !Number.isFinite(date.getTime()) ||
    localInput(date) !== value.slice(0, 16)
  )
    throw new Error("Ngày giờ không hợp lệ.");
  return date.toISOString();
}
export function uint64(value) {
  if (typeof value !== "string" || !/^(0|[1-9]\d*)$/.test(value))
    throw new Error("Giá trị 64 bit không hợp lệ.");
  const n = BigInt(value);
  if (n > 18446744073709551615n) throw new Error("Giá trị vượt uint64.");
  return n;
}
export function duration(value) {
  try {
    const s = uint64(value) / 1000n;
    return `${s / 3600n} giờ ${(s % 3600n) / 60n} phút ${s % 60n} giây`;
  } catch {
    return "—";
  }
}
export function commandBody(mode, brightness) {
  if (mode === "AUTO") return { mode };
  const text = String(brightness);
  if (mode !== "MANUAL" || !/^\d{1,3}$/.test(text) || Number(text) > 100)
    throw new Error("Độ sáng cần là số nguyên từ 0 đến 100.");
  return { mode, brightness: Number(text) };
}
export function canConnect(a, b) {
  if (
    !a ||
    !b ||
    a.quality !== "ACCEPTED" ||
    b.quality !== "ACCEPTED" ||
    typeof a.continuity !== "string" ||
    !a.continuity ||
    a.continuity !== b.continuity ||
    a.telemetry.boot_id !== b.telemetry.boot_id
  )
    return false;
  try {
    const delta = uint64(b.telemetry.uptime_ms) - uint64(a.telemetry.uptime_ms);
    return (
      delta > 0n &&
      delta <= 6000n &&
      uint64(b.telemetry.seq) > uint64(a.telemetry.seq) &&
      Date.parse(b.received_at) > Date.parse(a.received_at)
    );
  } catch {
    return false;
  }
}
export function series(items, field) {
  const groups = [];
  let current = null,
    previous = null;
  for (const item of items) {
    const value = item.telemetry?.[field],
      x = Date.parse(item.received_at);
    if (
      item.quality !== "ACCEPTED" ||
      !Number.isFinite(value) ||
      !Number.isFinite(x)
    ) {
      current = null;
      previous = null;
      continue;
    }
    if (!current || !canConnect(previous, item)) {
      current = [];
      groups.push(current);
    }
    current.push({ x, y: value });
    previous = item;
  }
  return groups;
}
export class CommandTracker {
  states = new Map();
  get(node) {
    return (
      this.states.get(node) ?? { kind: "IDLE", id: null, reconciled: false }
    );
  }
  set(node, state) {
    const next = { ...this.get(node), ...state };
    this.states.set(node, next);
    return next;
  }
  locked(node) {
    const s = this.get(node);
    return (
      ["SUBMITTING", "PENDING"].includes(s.kind) ||
      (s.kind === "UNCERTAIN" && !s.reconciled)
    );
  }
  begin(node) {
    if (this.locked(node)) return false;
    this.set(node, {
      kind: "SUBMITTING",
      id: null,
      reconciled: false,
      detail: "",
    });
    return true;
  }
  accepted(node, value) {
    this.set(node, {
      kind: value.result,
      id: value.command_id,
      reconciled: false,
      detail: value.reason ?? "",
    });
  }
  failed(node, error) {
    this.set(node, {
      kind: error.status === 0 || error.status >= 500 ? "UNCERTAIN" : "ERROR",
      reconciled: false,
      detail: error.message,
    });
  }
  observe(node) {
    if (this.get(node.node_id).kind === "SUBMITTING") return;
    if (node.pending_command_id)
      this.set(node.node_id, {
        kind: "PENDING",
        id: node.pending_command_id,
        reconciled: false,
      });
    else if (
      this.get(node.node_id).kind === "UNCERTAIN" &&
      node.freshness === "FRESH"
    )
      this.set(node.node_id, { reconciled: true });
  }
}
export function commandLabel(state) {
  const labels = {
    IDLE: "Chọn chế độ và bấm Áp dụng để gửi lệnh.",
    SUBMITTING: "Đang gửi yêu cầu…",
    PENDING: "Đang chờ node xác nhận. Máy chủ chờ ACK tối đa 10 giây.",
    APPLIED:
      "Node đã chấp nhận chế độ và mục tiêu. PWM có thể còn đang chuyển dần.",
    REJECTED: "Node từ chối lệnh.",
    TIMEOUT: "Máy chủ hết thời gian chờ xác nhận.",
    ERROR: "Yêu cầu chưa được tiếp nhận.",
    UNCERTAIN: "Chưa xác định được kết quả yêu cầu. Không tự gửi lại.",
  };
  return (
    (labels[state.kind] ?? labels.UNCERTAIN) +
    (state.detail ? ` ${state.detail}` : "") +
    (state.kind === "UNCERTAIN" && state.reconciled
      ? " Đã đồng bộ trạng thái hiện tại; bạn có thể chủ động gửi lệnh mới."
      : "")
  );
}
