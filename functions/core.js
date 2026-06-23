function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function randInt(min, max) {
  min = Math.round(Number(min));
  max = Math.round(Number(max));
  if (!Number.isFinite(min)) min = 0;
  if (!Number.isFinite(max)) max = min;
  if (max < min) [min, max] = [max, min];
  return min + Math.floor(Math.random() * (max - min + 1));
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, m => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  }[m]));
}

function numberWithDefault(value, fallback) {
  if (value === null || value === undefined || value === "") return fallback;
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function weightedPick(items) {
  const total = items.reduce((sum, i) => sum + Math.max(0, Number(i.weight || 0)), 0);
  if (total <= 0) return items[Math.floor(Math.random() * items.length)];
  let r = Math.random() * total;
  for (const item of items) {
    r -= Math.max(0, Number(item.weight || 0));
    if (r <= 0) return item;
  }
  return items[items.length - 1];
}

function rollPercent(percent) {
  return Math.random() * 100 < Math.max(0, Math.min(100, Number(percent || 0)));
}

function getPercent(id) {
  return Math.max(0, Math.min(100, Number(document.getElementById(id)?.value || 0)));
}
