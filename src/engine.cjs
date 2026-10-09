const { FileFinder } = require('@ff-labs/fff-node');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { fuzzyScore, usageBoost } = require('./ranking.cjs');
class Engine {
  constructor(roots, dataPath, apps = [], usage = {}) {
    this.apps = apps; this.usage = usage; this.indexes = []; this.errors = [];
    fs.mkdirSync(dataPath, { recursive: true });
    for (const root of roots) {
      try {
        const key = crypto.createHash('sha256').update(root.toLowerCase()).digest('hex').slice(0, 16);
        const db = path.join(dataPath, key); fs.mkdirSync(db, { recursive: true });
        const result = FileFinder.create({ basePath: root,
          frecencyDbPath: path.join(db, 'frecency'), historyDbPath: path.join(db, 'queries'),
          enableHomeDirScanning: true, enableFsRootScanning: true, followSymlinks: false,
          disableMmapCache: true, cacheBudgetMaxBytes: 32 * 1024 * 1024, cacheBudgetMaxFileSize: 1024 * 1024 });
        if (!result.ok) throw new Error(result.error);
        this.indexes.push({ root, finder: result.value });
      } catch (error) { this.errors.push(`${root}: ${error.message}`); }
    }
  }
  status() {
    return { errors: this.errors, apps: this.apps.length, roots: this.indexes.map(({root, finder}) => {
      const p = finder.getScanProgress(); return { root, ...(p.ok ? p.value : { error: p.error }) };
    }) };
  }
  search(query, mode = 'all', cursors = null) {
    const start = performance.now(), results = [], errors = [], next = {};
    if (mode === 'all' || mode === 'apps') {
      for (const app of this.apps) {
        const score = fuzzyScore(query, app.name);
        if (score) results.push({ ...app, kind: 'app', score: score + usageBoost(this.usage[app.id]) });
      }
    }
    for (const {root, finder} of this.indexes) {
      if (mode === 'all' || mode === 'files') {
        const r = finder.mixedSearch(query, { pageSize: 40, maxThreads: 2 });
        if (!r.ok) { errors.push(r.error); continue; }
        r.value.items.forEach((entry, i) => {
          const item = entry.item, target = path.resolve(root, item.relativePath);
          results.push({ id: target, path: target, root, relativePath: item.relativePath,
            name: item.fileName || item.dirName, kind: entry.type === 'directory' ? 'folder' : 'file',
            score: (r.value.scores[i]?.total || 0) + usageBoost(this.usage[target]), size: item.size });
        });
      }
      if (mode === 'content' && query.trim().length >= 2) {
        if (cursors && !cursors[root]) continue;
        const r = finder.grep(query, { mode: 'plain', pageSize: 30, maxMatchesPerFile: 3,
          maxFileSize: 5 * 1024 * 1024, timeBudgetMs: 25,
          enforceTimeBudget: true, cursor: cursors?.[root] || undefined });
        if (!r.ok) { errors.push(r.error); continue; }
        if (r.value.nextCursor) next[root] = r.value.nextCursor;
        for (const item of r.value.items) {
          const target = path.resolve(root, item.relativePath);
          results.push({ id: `${target}:${item.lineNumber}`, path: target, root,
            relativePath: item.relativePath, name: item.fileName, kind: 'content',
            line: item.lineNumber, snippet: item.lineContent, score: 100 + usageBoost(this.usage[target]) });
        }
      }
    }
    const unique = [...new Map(results.map(r => [r.id, r])).values()];
    unique.sort((a,b) => (mode === 'all' ? ({app:0,file:1,folder:1,content:2}[a.kind] - {app:0,file:1,folder:1,content:2}[b.kind]) : 0) || b.score - a.score || a.name.localeCompare(b.name));
    const visible = mode === 'all' ? [
      ...unique.filter(r => r.kind === 'app').slice(0, 12),
      ...unique.filter(r => r.kind === 'file' || r.kind === 'folder').slice(0, 55),
      ...unique.filter(r => r.kind === 'content').slice(0, 30)
    ] : unique.slice(0, 100);
    return { results: visible, ms: performance.now() - start, cursors: next,
      partial: Object.keys(next).length > 0, errors, status: this.status() };
  }
  track(item, query) {
    const key = item.path || item.id;
    this.usage[key] = { count: (this.usage[key]?.count || 0) + 1, last: Date.now() };
    const index = this.indexes.find(x => x.root === item.root);
    if (index) index.finder.trackQuery(query, item.relativePath);
    return this.usage;
  }
  destroy() { for (const {finder} of this.indexes) finder.destroy(); }
}
module.exports = { Engine };
