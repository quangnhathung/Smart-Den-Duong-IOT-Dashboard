import { API_BASE_URL, REQUEST_TIMEOUT_MS } from "../config.js";
export class ApiError extends Error {
  constructor(message, status = 0) {
    super(message);
    this.status = status;
  }
}
export async function request(
  path,
  {
    method = "GET",
    body,
    signal,
    fetcher = globalThis.fetch,
    blob = false,
  } = {},
) {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  if (signal?.aborted) controller.abort();
  else signal?.addEventListener("abort", cancel, { once: true });
  const timer = setTimeout(cancel, REQUEST_TIMEOUT_MS);
  try {
    const response = await fetcher(API_BASE_URL + path, {
      method,
      signal: controller.signal,
      headers: body ? { "Content-Type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
    });
    if (blob) {
      if (!response.ok)
        throw new ApiError(
          "Không tải được CSV. Hãy thử lại khi máy chủ sẵn sàng.",
          response.status,
        );
      return await response.blob();
    }
    const data = await response.json();
    if (
      !response.ok &&
      !(
        path === "/api/health" &&
        response.status === 503 &&
        data.status === "DEGRADED"
      )
    ) {
      const detail =
        typeof data.detail === "string"
          ? data.detail
          : response.status === 422
            ? "Dữ liệu nhập không hợp lệ. Kiểm tra lại các trường."
            : "Yêu cầu không thành công.";
      throw new ApiError(detail, response.status);
    }
    return data;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (signal?.aborted)
      throw new DOMException("Request cancelled", "AbortError");
    throw new ApiError(
      "Không kết nối được máy chủ hoặc yêu cầu quá thời gian. Dữ liệu cuối được giữ lại.",
    );
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", cancel);
  }
}
export const query = (values) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(values))
    if (v !== "" && v != null) p.set(k, v);
  return p.toString();
};
export class Poller {
  constructor(
    task,
    interval,
    { onError = () => {}, visible = () => !document.hidden } = {},
  ) {
    this.task = task;
    this.interval = interval;
    this.onError = onError;
    this.visible = visible;
    this.running = false;
    this.timer = null;
    this.active = false;
    this.controller = null;
  }
  start() {
    if (this.active) return;
    this.active = true;
    this.run();
  }
  stop() {
    this.active = false;
    clearTimeout(this.timer);
    this.controller?.abort();
  }
  async run() {
    if (!this.active) return;
    if (this.running) {
      this.wake = true;
      return;
    }
    clearTimeout(this.timer);
    if (!this.visible()) {
      this.timer = setTimeout(() => this.run(), this.interval);
      return;
    }
    this.running = true;
    const controller = new AbortController();
    this.controller = controller;
    try {
      await this.task(controller.signal);
    } catch (error) {
      if (error.name !== "AbortError") this.onError(error);
    } finally {
      this.running = false;
      if (this.active)
        this.timer = setTimeout(
          () => this.run(),
          this.wake ? 0 : this.interval,
        );
      this.wake = false;
    }
  }
}
