// Boots the built app exactly as the container does, then triggers the shutdown path.
//
// Why `process.emit('SIGTERM')` instead of a real signal: on win32 `process.kill(pid,
// 'SIGTERM')` calls TerminateProcess, so the handler chain never runs and there is nothing
// to observe (measured: the child dies with exit 1 and not one log line). Emitting the
// event exercises the listeners Nest registered — `enableShutdownHooks` uses
// `process.on(...)` — which is the part this project owns. Real signal *delivery* is a
// Linux-only concern and is covered by scripts/ci/assert-image.sh in CI.
const { bootstrap } = require('../../dist/main.js');

bootstrap()
  .then(() => {
    // One tick after `listen()` resolves, so the startup record is already written and the
    // assertion on log order cannot race the boot.
    // The signal name is passed explicitly: Node hands it to the listener on real delivery,
    // but `emit()` supplies no arguments, and without it the "which signal" suffix on the
    // shutdown line could regress unnoticed.
    setTimeout(() => process.emit('SIGTERM', 'SIGTERM'), Number(process.env.HARNESS_SIGNAL_DELAY_MS ?? 250));
  })
  .catch((error) => {
    console.error('harness: bootstrap rejected', error);
    process.exit(1);
  });
