const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const desktopDir = path.resolve(__dirname, '..');
const rootDir = path.resolve(desktopDir, '..', '..');
const archiveDir = path.join(desktopDir, 'runtime-archives');
const archivePath = path.join(archiveDir, 'venv.tar.gz');
const venvDir = path.join(rootDir, '.venv');
const pythonPath = process.platform === 'win32'
  ? path.join(venvDir, 'Scripts', 'python.exe')
  : path.join(venvDir, 'bin', 'python');
const researchDeps = ['curl_cffi', 'beautifulsoup4', 'pyyaml', 'feedparser', 'yt-dlp'];

function runPython(args, options = {}) {
  return spawnSync(
    pythonPath,
    args,
    { stdio: 'inherit', windowsHide: true, ...options },
  );
}

if (!fs.existsSync(venvDir)) {
  throw new Error(`Python virtualenv not found: ${venvDir}`);
}

if (!fs.existsSync(pythonPath)) {
  throw new Error(`Python executable not found: ${pythonPath}`);
}

if (process.env.OPENCRAB_SKIP_RESEARCH_DEPS !== '1') {
  console.log(`Installing research runtime dependencies: ${researchDeps.join(', ')}`);
  let pipResult = runPython(['-m', 'pip', 'install', '--upgrade', '--quiet', ...researchDeps]);
  if (pipResult.status !== 0) {
    console.log('pip is unavailable or failed; attempting to bootstrap pip with ensurepip.');
    const ensurePipResult = runPython(['-m', 'ensurepip', '--upgrade']);
    if (ensurePipResult.status !== 0) {
      throw new Error(`Failed to bootstrap pip with ensurepip, exit code ${ensurePipResult.status}`);
    }
    pipResult = runPython(['-m', 'pip', 'install', '--upgrade', '--quiet', ...researchDeps]);
  }
  if (pipResult.status !== 0) {
    throw new Error(`Failed to install research runtime dependencies, exit code ${pipResult.status}`);
  }
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
