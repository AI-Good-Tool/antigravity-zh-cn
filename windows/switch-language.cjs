const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { spawn } = require('node:child_process');
const builds = require('./official-builds.json');

// The switcher reads ASAR bytes. The launched application uses Electron's normal loader.
process.noAsar = true;

const root = path.resolve(__dirname, '..');
const appArchive = 'resources/app.asar';
const ideMain = 'resources/app/out/main.js';
const ideExtension = 'resources/app/extensions/agy/vscode/extension.js';
const ideProduct = 'resources/app/product.json';
const ideLocal = 'resources/app/out/antigravity-localization';
const markerName = 'antigravity-local-language.json';
const menuLabels = {
    'Actual Size': '实际大小',
    'Zoom In': '放大',
    'Zoom Out': '缩小',
    'New Window': '新建窗口',
    Docs: '官方文档',
    'No agents running': '没有运行中的智能体',
    Quit: '退出',
};

function hash(parts) {
    const sum = createHash('sha256');
    for (const part of parts) sum.update(part);
    return sum.digest('hex');
}

function* packedFiles(files, prefix = '') {
    for (const [name, entry] of Object.entries(files)) {
        const relative = prefix + name;
        if (entry.files) yield* packedFiles(entry.files, relative + '/');
        else if (entry.offset !== undefined && !entry.unpacked) yield [relative, entry];
    }
}

class Asar {
    constructor(bytes) {
        const outer = bytes.readUInt32LE(0);
        const header = bytes.readUInt32LE(4);
        const payload = bytes.readUInt32LE(8);
        const length = bytes.readUInt32LE(12);
        if (outer !== 4 || header !== payload + 4 || !length ||
            length > payload - 4 || 8 + header > bytes.length) {
            throw new Error('无法识别桌面版的资源包。');
        }
        this.directory = JSON.parse(bytes.toString('utf8', 16, 16 + length));
        this.entries = new Map(packedFiles(this.directory.files));
        this.data = bytes.subarray(8 + header);
    }

    read(name) {
        const entry = this.entries.get(name);
        if (!entry) throw new Error('资源包缺少 ' + name);
        const offset = Number(entry.offset);
        const end = offset + entry.size;
        if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(end) ||
            offset < 0 || end < offset || end > this.data.length) {
            throw new Error('资源范围异常 ' + name);
        }
        return this.data.subarray(offset, end);
    }

    replace(replacements) {
        let offset = 0;
        const chunks = [];
        for (const [name, entry] of this.entries) {
            const content = replacements.get(name) ?? this.read(name);
            if (replacements.has(name) && entry.integrity) {
                const { algorithm, blockSize } = entry.integrity;
                if (algorithm !== 'SHA256' || !Number.isSafeInteger(blockSize) || blockSize <= 0) {
                    throw new Error('资源校验格式已变化 ' + name);
                }
                const blocks = [];
                for (let start = 0; start < content.length; start += blockSize) {
                    blocks.push(hash([content.subarray(start, start + blockSize)]));
                }
                entry.integrity = { algorithm, blockSize, hash: hash([content]), blocks };
            }
            entry.offset = String(offset);
            entry.size = content.length;
            chunks.push(content);
            offset += content.length;
        }

        const json = Buffer.from(JSON.stringify(this.directory));
        const padding = Buffer.alloc((4 - json.length % 4) % 4);
        const prefix = Buffer.alloc(16);
        prefix.writeUInt32LE(4, 0);
        prefix.writeUInt32LE(8 + json.length + padding.length, 4);
        prefix.writeUInt32LE(4 + json.length + padding.length, 8);
        prefix.writeUInt32LE(json.length, 12);
        return Buffer.concat([prefix, json, padding, ...chunks]);
    }
}

function replaceOnce(source, before, after, label) {
    const index = source.indexOf(before);
    if (index < 0 || source.indexOf(before, index + before.length) >= 0) {
        throw new Error('这一版的界面结构已变化 ' + label);
    }
    return source.slice(0, index) + after + source.slice(index + before.length);
}

function patchDesktopUpdater(source, official, handoff) {
    const changes = [
        ['MenuUpdateStep["CheckForUpdates"] = "Check for Updates";',
            'MenuUpdateStep["CheckForUpdates"] = "检查更新…";'],
        ['MenuUpdateStep["CheckingForUpdates"] = "Checking for Updates...";',
            'MenuUpdateStep["CheckingForUpdates"] = "正在检查更新…";'],
        ['MenuUpdateStep["RestartToUpdate"] = "Restart to Update";',
            'MenuUpdateStep["RestartToUpdate"] = "用官方版更新…";'],
        ['autoUpdater.autoDownload = true;', 'autoUpdater.autoDownload = false;'],
        ["autoUpdater.autoInstallOnAppQuit =\n        electron_1.app.isPackaged && process.platform !== 'win32';",
            'autoUpdater.autoInstallOnAppQuit = false;'],
        ['type: types_1.UpdateState.AvailableForDownload,\n' +
            '            update: { version: info.version },\n' +
            '        });\n        updateMenuState(MenuUpdateStep.DownloadingUpdate);',
        'type: types_1.UpdateState.Ready,\n' +
            '            update: { version: info.version },\n' +
            '        });\n        updateMenuState(MenuUpdateStep.RestartToUpdate);'],
        ["title: 'Check for Updates',\n                message: 'No updates available',\n                buttons: ['OK'],",
            "title: '检查更新',\n                message: '当前已是最新版。',\n                buttons: ['好'],"],
    ];
    for (const [before, after] of changes) {
        source = replaceOnce(source, before, after, '桌面版更新入口');
    }
    const entry = source.match(/^async function quitAndInstall\(isSilent = false\) \{\n[\s\S]*?^\}/m);
    if (!entry) throw new Error('无法识别桌面版的更新入口。');
    return replaceOnce(source, entry[0],
        'const officialUpdatePath = ' + JSON.stringify(official) + ';\n' +
        'const officialUpdateSha256 = ' + JSON.stringify(builds.app.executable) + ';\n' +
        handoff.trimEnd(),
        '桌面版重启更新');
}

function desktopPatch(source, official, dictionary, runtime, handoff) {
    const archive = new Asar(source[appArchive]);
    const pkg = JSON.parse(archive.read('package.json'));
    if (pkg.name !== 'antigravity' || pkg.main !== 'dist/main.js' ||
        !/^2\.\d+\.\d+$/.test(pkg.version)) {
        throw new Error('无法识别 Antigravity App 2.x 的版本。');
    }

    const preloadName = 'dist/preload.js';
    const preload = archive.read(preloadName).toString();
    if (!preload.includes("contextBridge.exposeInMainWorld('electronNative'") ||
        !archive.read('dist/constants.js').includes("WINDOW_ORIGIN = 'https://127.0.0.1'") ||
        preload.includes('__AGY_I18N_DATA__')) {
        throw new Error('这一版桌面版的界面加载方式已变化。');
    }
    dictionary.exact['Restart to Update'] = '用官方版更新';
    const launcher = '\n;(() => {\n' +
        "  if (window.top !== window || window.location.protocol !== 'https:' ||\n" +
        "      window.location.hostname !== '127.0.0.1') return;\n" +
        '  window.__AGY_I18N_DATA__ = ' + JSON.stringify(dictionary) + ';\n' +
        runtime + '\n})();\n';
    const changes = new Map([[preloadName, Buffer.from(preload + launcher)]]);
    const updaterName = 'dist/updater.js';
    changes.set(updaterName, Buffer.from(
        patchDesktopUpdater(archive.read(updaterName).toString(), official, handoff)
    ));

    const labels = new RegExp("\\blabel:\\s*(?:item\\.label\\s*\\|\\|\\s*)?(['\"])(" +
        Object.keys(menuLabels).join('|') + ')\\1', 'g');
    for (const name of ['dist/menu.js', 'dist/main.js']) {
        let text = archive.read(name).toString();
        if (name === 'dist/main.js') {
            // Links still launch the vendor executable and reach the running instance.
            const args = text.match(/const protocolClientArgs = process\.defaultApp[\s\S]*?\n    : \[\];/);
            if (!args) throw new Error('无法识别桌面版的登录回调。');
            text = replaceOnce(text, args[0],
                'const protocolClientArgs = [' + JSON.stringify(official) + '];',
                '桌面版登录回调');
        }
        changes.set(name, Buffer.from(text.replace(labels, (match, _, label) =>
            match.replace(label, menuLabels[label]))));
    }
    return { version: pkg.version, files: { [appArchive]: archive.replace(changes) } };
}

function idePatch(source, official, dictionary, runtime, ideDictionary, hook) {
    const product = JSON.parse(source[ideProduct]);
    if (product.applicationName !== 'antigravity-ide' || !/^2\.\d+\.\d+$/.test(product.ideVersion)) {
        throw new Error('无法识别 Antigravity IDE 2.x 的版本。');
    }
    let main = source[ideMain].toString();
    if (!main.includes('import.meta.dirname') || main.startsWith('#!') ||
        main.includes('antigravity-localization/ide-localization.mjs') ||
        !main.includes('"disable-updates"')) {
        throw new Error('这一版 IDE 的界面加载方式已变化。');
    }
    const handler = main.match(/\.setAsDefaultProtocolClient\([\w$]+\.urlProtocol,process\.execPath,/);
    if (!handler) throw new Error('无法识别 IDE 的登录回调。');
    main = replaceOnce(main, handler[0],
        handler[0].replace('process.execPath', JSON.stringify(official)), 'IDE 登录回调');
    const title = replaceOnce(source[ideExtension].toString(),
        'b.title=`${m} Settings`', 'b.title=`${m} 设置`', 'IDE 设置标题');
    Object.assign(dictionary.exact, ideDictionary.exact);
    dictionary.officialSkillDescriptions = ideDictionary.officialSkillDescriptions;

    return {
        version: product.ideVersion,
        files: {
            [ideMain]: 'import "./antigravity-localization/ide-localization.mjs";\n' + main,
            [ideExtension]: title,
            [ideLocal + '/ide-localization.mjs']: hook,
            [ideLocal + '/renderer.js']: 'window.__AGY_I18N_DATA__ = ' +
                JSON.stringify(dictionary) + ';\n' + runtime,
        },
    };
}

function checkedAssets(folder, names) {
    return Object.fromEntries(names.map(name => [name, fs.readFileSync(path.join(folder, name))]));
}

function checkedExe(binary, desktop) {
    const sentinel = Buffer.from('dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX');
    const at = binary.indexOf(sentinel) + sentinel.length;
    // Read the vendor's Electron build flags. The binary is copied verbatim.
    if (at < sentinel.length || binary[at] !== 1 || binary[at + 2] !== 49 ||
        (desktop && (binary[at + 1] < 5 || binary[at + 6] !== 48))) {
        throw new Error('这一版 Electron 的启动或资源校验方式已变化，请打开英文原版。');
    }
}

function prepare(official, product) {
    const desktop = product === 'app';
    const build = builds[product];
    const original = path.dirname(official);
    const executable = path.basename(official);
    const originalNames = Object.keys(build.assets);
    const originalAssets = checkedAssets(original, originalNames);
    const binary = fs.readFileSync(official);
    const exeHash = hash([binary]);
    if (exeHash !== build.executable) throw new Error('官方应用已变更，请重新运行脚本。');
    for (const name of originalNames) {
        if (hash([originalAssets[name]]) !== build.assets[name]) {
            throw new Error('官方资源与已适配版本不一致 ' + name);
        }
    }
    checkedExe(binary, desktop);
    const sourceHash = hash(Object.values(originalAssets));
    const dictionary = JSON.parse(fs.readFileSync(path.join(root, 'zh-CN.json')));
    const runtime = fs.readFileSync(path.join(root, 'i18n-runtime.js'), 'utf8');
    const patch = desktop
        ? desktopPatch(originalAssets, official, dictionary, runtime,
            fs.readFileSync(path.join(__dirname, 'desktop-update.js'), 'utf8'))
        : idePatch(originalAssets, official, dictionary, runtime,
            JSON.parse(fs.readFileSync(path.join(root, 'ide-zh-CN.json'))),
            fs.readFileSync(path.join(root, 'ide-localization.mjs'), 'utf8'));

    const state = path.join(process.env.LOCALAPPDATA, 'AntigravityLocalLanguage', desktop ? 'App' : 'IDE');
    const patchHash = hash(Object.values(patch.files));
    const stamp = [patch.version, hash([exeHash, sourceHash, patchHash, official]).slice(0, 16)].join('-');
    const target = path.join(state, stamp);
    if (fs.existsSync(target)) {
        if (fs.lstatSync(target).isSymbolicLink() ||
            fs.readFileSync(path.join(target, markerName), 'utf8') !== stamp ||
            hash(Object.values(checkedAssets(target, Object.keys(patch.files)))) !== patchHash ||
            hash([fs.readFileSync(path.join(target, executable))]) !== exeHash) {
            throw new Error('中文副本校验失败，请检查此目录 ' + target);
        }
        return path.join(target, executable);
    }

    console.log('正在生成 ' + patch.version + ' 中文副本，首次可能需要一分钟。');
    fs.mkdirSync(state, { recursive: true });
    const stagingFolder = fs.mkdtempSync(path.join(state, '.prepare-'));
    const stage = path.join(stagingFolder, 'application');
    try {
        fs.cpSync(original, stage, {
            recursive: true,
            force: false,
            errorOnExist: true,
            filter: file => path.dirname(file) !== original ||
                !/^(?:unins\d+\.(?:exe|dat|msg)|Uninstall Antigravity\.exe)$/i.test(path.basename(file)),
        });
        if (!fs.lstatSync(stage).isDirectory()) {
            throw new Error('无法生成独立的中文副本。');
        }
        const realStage = fs.realpathSync(stage);
        const copiedExe = fs.readFileSync(path.join(stage, executable));
        if (hash([copiedExe]) !== exeHash ||
            hash(Object.values(checkedAssets(stage, originalNames))) !== sourceHash) {
            throw new Error('复制时官方应用已更新，请重新运行脚本。');
        }
        for (const [name, bytes] of Object.entries(patch.files)) {
            const file = path.join(stage, name);
            fs.mkdirSync(path.dirname(file), { recursive: true });
            const relative = path.relative(realStage, fs.realpathSync(path.dirname(file)));
            if (relative === '..' || relative.startsWith('..' + path.sep) ||
                path.isAbsolute(relative) || fs.lstatSync(file, { throwIfNoEntry: false })?.isSymbolicLink()) {
                throw new Error('中文副本的资源路径异常 ' + name);
            }
            fs.writeFileSync(file, bytes);
        }
        fs.writeFileSync(path.join(stage, markerName), stamp, { flag: 'wx' });
        fs.renameSync(stage, target);
    } finally {
        fs.rmSync(stagingFolder, { recursive: true, force: true });
    }
    return path.join(target, executable);
}

async function launch(executable, args) {
    const child = spawn(executable, args, {
        cwd: path.dirname(executable),
        detached: true,
        stdio: 'ignore',
    });
    await new Promise((resolve, reject) => {
        child.once('spawn', resolve);
        child.once('error', reject);
    });
    child.unref();
}

async function main() {
    const [product] = process.argv.slice(2);
    if (process.platform !== 'win32' || !process.versions.electron ||
        !Object.hasOwn(builds, product)) {
        throw new Error('请双击 Windows 对应的一键切换脚本。');
    }
    const official = fs.realpathSync(process.execPath);
    const desktop = product === 'app';
    if (!desktop && fs.existsSync(path.join(path.dirname(official), 'data'))) {
        throw new Error('检测到 IDE 便携模式。请使用 Google 安装版。');
    }

    const executable = prepare(official, product);
    const args = desktop ? ['--lang=zh-CN'] : ['--locale=zh-cn', '--disable-updates'];
    delete process.env.ELECTRON_RUN_AS_NODE;
    await launch(executable, args);
    console.log('已启动 ' + (desktop ? 'Antigravity App' : 'Antigravity IDE') + ' 中文副本。');
}

main().catch(error => {
    console.log('切换失败。' + error.message);
    process.exitCode = 1;
});
