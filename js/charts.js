import { series, number, shortTime, escapeHtml } from "./core.js";
export function chart(items, field, { label, unit, color, max } = {}) {
  const groups = series(items, field),
    points = groups.flat();
  if (!points.length)
    return '<div class="chart-empty">Chưa có mẫu hợp lệ trong trang này.</div>';
  const width = 720,
    height = 210,
    left = 48,
    right = 18,
    top = 16,
    bottom = 36;
  const minX = Math.min(...points.map((p) => p.x)),
    maxX = Math.max(...points.map((p) => p.x));
  const ceiling = max ?? Math.max(24, ...points.map((p) => p.y));
  const x = (v) =>
      left + ((v - minX) / (maxX - minX || 1)) * (width - left - right),
    y = (v) => height - bottom - (v / (ceiling || 1)) * (height - top - bottom);
  const grid = [0, 0.25, 0.5, 0.75, 1]
    .map(
      (f) =>
        `<line x1="${left}" x2="${width - right}" y1="${y(ceiling * f)}" y2="${y(ceiling * f)}" class="chart-grid-line"/><text x="${left - 9}" y="${y(ceiling * f) + 4}" text-anchor="end">${number(ceiling * f)}</text>`,
    )
    .join("");
  const paths = groups
    .map((group) => {
      if (group.length === 1)
        return `<circle cx="${x(group[0].x)}" cy="${y(group[0].y)}" r="3" fill="${color}"/>`;
      const d = group
        .map((p, i) =>
          !i
            ? `M${x(p.x)},${y(p.y)}`
            : field === "brightness_applied"
              ? `H${x(p.x)}V${y(p.y)}`
              : `L${x(p.x)},${y(p.y)}`,
        )
        .join(" ");
      return `<path d="${d}" stroke="${color}" stroke-width="2.5" fill="none"/>`;
    })
    .join("");
  return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(label)} (${unit}), ${points.length} mẫu hợp lệ; các đoạn rời là khoảng thiếu dữ liệu."><g class="chart-labels">${grid}<text x="${left}" y="${height - 10}">${shortTime(minX)}</text><text x="${width - right}" y="${height - 10}" text-anchor="end">${shortTime(maxX)}</text></g>${paths}</svg>`;
}
