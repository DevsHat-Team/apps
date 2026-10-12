// Types text into whatever window currently has focus (like a real keyboard).
let nut = null;
let loadError = null;

function load() {
  if (nut || loadError) return nut;
  try {
    nut = require('@nut-tree-fork/nut-js');
    nut.keyboard.config.autoDelayMs = 0; // fastest possible typing
  } catch (e) {
    loadError = e.message;
  }
  return nut;
}

let chain = Promise.resolve();

// Jobs run one at a time so two quick scans never interleave.
function typeText(text, { pressEnter = true } = {}) {
  const job = chain.then(async () => {
    const n = load();
    if (!n) throw new Error('Keyboard module unavailable: ' + loadError);
    await n.keyboard.type(text);
    if (pressEnter) await n.keyboard.type(n.Key.Enter);
  });
  chain = job.catch(() => {});
  return job;
}

module.exports = { typeText, isReady: () => !!load(), error: () => loadError };
