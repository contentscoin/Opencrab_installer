const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const desktopDir = path.resolve(__dirname, '..');
const rootDir = path.resolve(desktopDir, '..', '..');
const archiveDir = path.join(desktopDir, 'runtime-archives');
const archivePath = path.join(archiveDir, 'venv.tar.gz');
const venvDir = path.join(rootDir, '.venv');

if (!fs.existsSync(venvDir)) {
  throw new Error(`Python virtualenv not found: ${venvDir}`);
}

fs.rmSync(archiveDir, { recursive: true, force: true });
fs.mkdirSync(archiveDir, { recursive: true });

const args = [
  '-czf',
  archivePath,
  '--exclude=.venv/**/__pycache__',
  '--exclude=.venv/**/*.pyc',
  '--exclude=.venv/**/*.pyo',
  '-C',
  rootDir,
  '.venv',
];

const result = spawnSync('tar', args, { stdio: 'inherit', windowsHide: true });
if (result.status !== 0) {
  throw new Error(`Failed to create runtime archive with tar, exit code ${result.status}`);
}

const sizeMb = (fs.statSync(archivePath).size / 1024 / 1024).toFixed(1);
console.log(`Created ${archivePath} (${sizeMb} MB)`);
