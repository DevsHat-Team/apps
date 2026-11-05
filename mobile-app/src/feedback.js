import { Vibration } from 'react-native';
import { createAudioPlayer, setAudioModeAsync } from 'expo-audio';

// Scanner beeps (high = taken, low double = not saved) and a vibration. The beep plays on silent / vibrate too,
// like a real scanner; it can be turned off in the ⋯ menu.
let pools = null;
let soundOn = true;

const SOURCES = {
  ok: require('../assets/beep-ok.wav'),
  error: require('../assets/beep-error.wav'),
  warn: require('../assets/beep-warn.wav'),
};

function load() {
  if (pools) return pools;
  pools = {};
  try {
    setAudioModeAsync({ playsInSilentMode: true, interruptionMode: 'mixWithOthers', shouldPlayInBackground: false }).catch(() => {});
    // 3 players per sound: fast scans each get their own beep instead of cutting the last one off
    for (const k of Object.keys(SOURCES)) {
      pools[k] = { i: 0, list: [0, 1, 2].map(() => {
        const p = createAudioPlayer(SOURCES[k]);
        p.volume = 1;
        // No rewind-on-finish listener: on Android a rewind after the end starts the sound again, which made the beep
        // repeat without stopping. Each play below stops, rewinds and then plays exactly once.
        return p;
      }) };
    }
  } catch {}
  return pools;
}

export function setSound(on) {
  soundOn = !!on;
  if (soundOn) load();
}

function play(kind) {
  if (!soundOn) return;
  const pool = load()[kind];
  if (!pool) return;
  const p = pool.list[pool.i];
  pool.i = (pool.i + 1) % pool.list.length;
  try {
    if (p.playing || p.currentTime > 0.01) {
      p.pause();
      p.seekTo(0).then(() => { try { p.play(); } catch {} }).catch(() => {});
    } else {
      p.play();
    }
  } catch {}
}

/** ok: the scan was taken · error: not saved / unknown label · warn: undone · select: a tap */
export function feedback(kind) {
  play(kind);
  try {
    if (kind === 'ok') Vibration.vibrate(45);
    else if (kind === 'error') Vibration.vibrate([0, 140, 90, 140]);
    else if (kind === 'warn') Vibration.vibrate(25);
    else Vibration.vibrate(12);
  } catch {}
}
