const { Engine } = require('./engine.cjs');
let engine;
process.on('message', async ({ id, method, args }) => {
  try {
    let value;
    if (method === 'init') { engine = new Engine(...args); value = engine.status(); }
    else if (method === 'destroy') { engine?.destroy(); process.exit(0); }
    else if (!engine) throw new Error('Search engine is starting');
    else value = await engine[method](...args);
    process.send({ id, value });
  } catch (error) { process.send({ id, error: error.message }); }
});
