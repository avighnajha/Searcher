function fuzzyScore(query, name) {
  const q = query.toLowerCase(), n = name.toLowerCase();
  if (!q) return 1;
  if (n === q) return 1000;
  if (n.startsWith(q)) return 800 - n.length;
  if (n.includes(q)) return 600 - n.indexOf(q) - n.length;
  let p = -1, gaps = 0;
  for (const c of q) { const next = n.indexOf(c, p + 1); if (next < 0) return 0; gaps += next - p - 1; p = next; }
  return Math.max(1, 200 - gaps * 3 - n.length);
}
function usageBoost(record, now = Date.now()) {
  if (!record) return 0;
  return Math.log2(1 + record.count) * 30 + 70 * Math.exp(-(now - record.last) / (7 * 86400000));
}
module.exports = { fuzzyScore, usageBoost };
