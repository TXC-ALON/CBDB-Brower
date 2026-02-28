function escapeHtml(input) {
  return String(input || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function highlightText(text, keyword) {
  const source = String(text || "");
  const trimmedKeyword = String(keyword || "").trim();

  if (!trimmedKeyword) {
    return escapeHtml(source);
  }

  const escaped = escapeHtml(source);
  const safeKeyword = escapeHtml(trimmedKeyword).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  return escaped.replace(new RegExp(safeKeyword, "ig"), (match) => `<mark>${match}</mark>`);
}

export function formatYear(year) {
  if (year === null || year === undefined || Number(year) === 0) {
    return "未详";
  }
  return String(year);
}

export function formatYearRange(start, end) {
  if (!start && !end) {
    return "未详";
  }
  if (start && end) {
    return `${start} - ${end}`;
  }
  return String(start || end);
}

