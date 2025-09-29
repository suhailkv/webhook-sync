// launcher.js
const { spawn } = require('child_process');
const path = require('path');

const workerScript = path.resolve(__dirname, 'worker.js');
const maxRestartsPerMinute = 6;
const restartWindowMs = 60_000;

let restarts = [];

function now() { return Date.now(); }

function spawnWorker() {
  const child = spawn(process.execPath, [workerScript], {
    stdio: 'inherit',
    env: process.env
  });

  child.on('exit', (code, signal) => {
    const ts = now();
    restarts.push(ts);
    // keep only those in window
    restarts = restarts.filter(t => ts - t < restartWindowMs);

    if (code === 0) {
      console.log('Worker exited normally. Launcher exiting.');
      process.exit(0);
    } else {
      console.error(`Worker exited with code ${code} signal ${signal}.`);
      if (restarts.length > maxRestartsPerMinute) {
        console.error('Too many restarts in the window — refusing to restart to avoid crash loop.');
        process.exit(1);
      } else {
        console.log('Restarting worker in 1s...');
        setTimeout(spawnWorker, 1000);
      }
    }
  });

  child.on('error', (err) => {
    console.error('Failed to spawn worker:', err);
    setTimeout(spawnWorker, 5000);
  });
}

console.log('Launcher starting worker...');
spawnWorker();
