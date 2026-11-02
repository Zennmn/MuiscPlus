import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, rmSync, lstatSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { extname, resolve, relative, isAbsolute } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const args = new Set(process.argv.slice(2));
const browser = args.has('--firefox') ? 'firefox' : 'chrome';
const miuixOnly = args.has('--miuix-only');
const skipMiuix = args.has('--skip-miuix');
const miuixRoot = resolve(root, 'ui/miuix');
const miuixBuild = resolve(miuixRoot, 'build/dist/wasmJs/productionExecutable');
const miuixStage = resolve(root, 'src/miuix');
const dist = resolve(root, 'dist');
const destination = resolve(dist, `youlyplus-amll-${browser}`);
const withinDist = relative(dist, destination);
const isJavaScriptOrCssSourceMap = path => /\.(?:js|css)\.map$/i.test(path);
const sourceLogo = resolve(root, 'icons/logo.png');

function buildMiuix() {
    if (process.platform === 'win32') {
        if (!existsSync(resolve(miuixRoot, 'gradlew.bat'))) throw new Error('Missing ui/miuix/gradlew.bat.');
    }
    const wrapper = process.platform === 'win32' ? 'gradlew.bat' : './gradlew';
    const result = spawnSync(wrapper, [':wasmJsBrowserDistribution', '--no-daemon', '--console=plain'], {
        cwd: miuixRoot,
        env: process.env,
        stdio: 'inherit',
        shell: process.platform === 'win32'
    });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`Miuix Wasm build failed with exit code ${result.status}.`);
    if (!existsSync(miuixBuild)) throw new Error(`Miuix output is missing: ${miuixBuild}`);

    const withinSource = relative(resolve(root, 'src'), miuixStage);
    if (!withinSource || withinSource.startsWith('..') || isAbsolute(withinSource)) {
        throw new Error('Invalid Miuix staging path');
    }
    rmSync(miuixStage, { recursive: true, force: true });
    mkdirSync(miuixStage, { recursive: true });
    cpSync(miuixBuild, miuixStage, { recursive: true });
}

function walkFiles(directory) {
    return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
        const path = resolve(directory, entry.name);
        return entry.isDirectory() ? walkFiles(path) : [path];
    });
}

function assertLocalWebEntry() {
    if (!existsSync(miuixStage)) throw new Error('Miuix was not staged under src/miuix.');
    if (!existsSync(resolve(miuixStage, 'muiscMiuix.js'))) {
        throw new Error('Miuix output is missing muiscMiuix.js.');
    }
    const hasWasm = walkFiles(miuixStage).some(path => extname(path).toLowerCase() === '.wasm');
    if (!hasWasm) throw new Error('Miuix output does not contain a Wasm module.');
    const remoteResource = /<(?:script|link|img|iframe|object|embed)\b[^>]*(?:src|href)\s*=\s*["'](?:https?:)?\/\//i;
    const remoteImport = /(?:@import\s+|import\s*\(?\s*)["'](?:https?:)?\/\//i;
    for (const path of walkFiles(miuixStage)) {
        if (!['.html', '.css'].includes(extname(path).toLowerCase())) continue;
        const content = readFileSync(path, 'utf8');
        if (remoteResource.test(content) || remoteImport.test(content)) {
            throw new Error(`Miuix web entry references a remote resource: ${relative(root, path)}`);
        }
    }
}

if (!skipMiuix) buildMiuix();
assertLocalWebEntry();
if (miuixOnly) {
    console.log(`Miuix unpacked assets: ${miuixStage}`);
    process.exit(0);
}

if (!withinDist || withinDist.startsWith('..') || isAbsolute(withinDist)) throw new Error('Invalid package directory');
try { if (lstatSync(dist).isSymbolicLink()) throw new Error('Package parent must not be a symlink'); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
rmSync(destination, { recursive: true, force: true });
mkdirSync(destination, { recursive: true });
for (const path of ['src', 'icons', '_locales', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'readme.md', 'docs']) {
  cpSync(resolve(root, path), resolve(destination, path), {
    recursive: true,
    filter: source => !isJavaScriptOrCssSourceMap(source) && resolve(source) !== sourceLogo
  });
}
// The README displays this at 96px. Keep the original artwork in the repository
// and reuse the extension icon in the installed package.
cpSync(resolve(root, 'icons/icon128.png'), resolve(destination, 'icons/logo.png'));
mkdirSync(resolve(destination, 'scripts'), { recursive: true });
cpSync(resolve(root, 'scripts/ttml-translate.py'), resolve(destination, 'scripts/ttml-translate.py'));
const manifest = JSON.parse(readFileSync(resolve(root, 'manifest.json'), 'utf8'));
if (browser === 'chrome') {
  delete manifest.browser_specific_settings;
  delete manifest.background.scripts;
} else {
  delete manifest.background.service_worker;
}
writeFileSync(resolve(destination, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`${browser} unpacked extension: ${destination}`);
