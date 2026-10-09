const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Engine } = require('../src/engine.cjs');
const { fuzzyScore, usageBoost } = require('../src/ranking.cjs');
test('app matching and frecency decay', () => {
  assert.ok(fuzzyScore('visual','Visual Studio Code') > fuzzyScore('vsc','Visual Studio Code'));
  assert.equal(fuzzyScore('zzzz','Calculator'),0);
  assert.ok(usageBoost({count:2,last:Date.now()}) > usageBoost({count:2,last:0}));
});
test('native fff searches filenames, directories and content, and watches changes', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(),'searcher-test-'));
  const root = path.join(temp,'files'); fs.mkdirSync(root); fs.mkdirSync(path.join(root,'Reports'));
  fs.writeFileSync(path.join(root,'Reports','quarterly-budget.txt'),'uniquesearchneedle budget forecast\n');
  fs.writeFileSync(path.join(root,'notes.txt'),'nothing here\n');
  const engine = new Engine([root],path.join(temp,'db'),[{name:'Calculator',id:'calc-app'}]);
  try {
    assert.deepEqual(engine.errors,[]);
    const finder = engine.indexes[0].finder;
    const ready = await finder.waitForIndexReady(15000); assert.ok(ready.ok && ready.value);
    assert.ok(engine.search('quarterly','files').results.some(r => r.name==='quarterly-budget.txt'));
    assert.ok(engine.search('Reports','files').results.some(r => r.kind==='folder'));
    const content = engine.search('uniquesearchneedle','content');
    assert.ok(content.results.some(r => r.line===1 && r.snippet.includes('uniquesearchneedle')));
    const app = engine.search('calc','apps').results[0]; assert.equal(app.id,'calc-app');
    engine.track(app,'calc'); assert.equal(engine.usage['calc-app'].count,1);
    fs.writeFileSync(path.join(root,'new-watched-file.txt'),'watch me');
    const end = Date.now()+6000; let found=false;
    while(Date.now()<end) { if(engine.search('new-watched-file','files').results.length) {found=true;break;} await new Promise(r=>setTimeout(r,100)); }
    assert.ok(found,'new file appeared through native watcher');
  } finally { engine.destroy(); fs.rmSync(temp,{recursive:true,force:true}); }
});
