"""Build and open a local Chinese copy, or reopen the Google-signed original."""

import fcntl
import hashlib
import json
import os
import plistlib
import re
import struct
import subprocess
import sys
import tempfile
import time
from pathlib import Path


HERE = Path(__file__).resolve().parent
APP_NAME = "Antigravity.app"
COPY_NAME = "Antigravity 中文.app"
PLIST = Path("Contents/Info.plist")
ARCHIVE = Path("Contents/Resources/app.asar")
MARKER = Path("Contents/Resources/antigravity-local-zh.json")
ARCHIVE_KEY = "Resources/app.asar"
GOOGLE_SIGNATURE = (
    'identifier "com.google.antigravity" and anchor apple generic '
    'and certificate leaf[subject.OU] = "EQHXZ8M8AV"'
)
MENU_LABELS = {
    "Actual Size": "实际大小",
    "Zoom In": "放大",
    "Zoom Out": "缩小",
    "New Window": "新建窗口",
    "Docs": "官方文档",
    "No agents running": "没有运行中的智能体",
    "Quit": "退出",
}


def run(*args):
    return subprocess.run(args, check=True, capture_output=True, text=True, timeout=120).stdout


def verify_signature(app, official=False):
    args = ["/usr/bin/codesign", "--verify", "--deep", "--strict"]
    if official:
        args.append("-R=" + GOOGLE_SIGNATURE)
    run(*args, str(app))


def find_original():
    for path in (Path("/Applications") / APP_NAME, Path.home() / "Applications" / APP_NAME):
        if (path / ARCHIVE).is_file() and (path / PLIST).is_file():
            return path.resolve(strict=True)
    raise ValueError("在「应用程序」中找不到 Antigravity 桌面版。")


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def leaves(files, prefix=""):
    for name, entry in files.items():
        path = prefix + name
        if "files" in entry:
            yield from leaves(entry["files"], path + "/")
        elif "offset" in entry and not entry.get("unpacked"):
            yield path, entry


class Asar:
    """Read app resources and rebuild only the archive's packed entries."""

    def __init__(self, data):
        outer_size, header_size, payload_size, json_size = struct.unpack_from("<4I", data)
        if (outer_size != 4 or header_size != payload_size + 4
                or not 0 < json_size <= payload_size - 4
                or 8 + header_size > len(data)):
            raise ValueError("应用资源包格式已变化。")
        self.header = data[16:16 + json_size]
        self.directory = json.loads(self.header)
        self.entries = dict(leaves(self.directory["files"]))
        self.data = data[8 + header_size:]

    def read(self, name):
        entry = self.entries[name]
        offset = int(entry["offset"])
        end = offset + entry["size"]
        if not 0 <= offset <= end <= len(self.data):
            raise ValueError(f"应用资源文件范围异常：{name}")
        return self.data[offset:end]

    def rebuild(self, replacements):
        # Keep links, unpacked files and executable bits in the original directory.
        payload = bytearray()
        for name, entry in self.entries.items():
            if name in replacements:
                content = replacements[name]
                integrity = entry["integrity"]
                block_size = integrity["blockSize"]
                if integrity["algorithm"] != "SHA256" or block_size <= 0:
                    raise ValueError(f"应用资源校验格式已变化：{name}")
                integrity["hash"] = sha256(content)
                integrity["blocks"] = [
                    sha256(content[start:start + block_size])
                    for start in range(0, len(content), block_size)
                ]
            else:
                content = self.read(name)
            entry["offset"] = str(len(payload))
            entry["size"] = len(content)
            payload.extend(content)

        header = json.dumps(self.directory, ensure_ascii=False, separators=(",", ":")).encode()
        padding = bytes(-len(header) % 4)
        payload_size = 4 + len(header) + len(padding)
        preface = struct.pack("<4I", 4, payload_size + 4, payload_size, len(header))
        return preface + header + padding + payload, sha256(header)


def patch_updater(updater, original, update_script):
    # A locally signed copy can check versions, but installation belongs to the
    # Google-signed original. Keep the existing menu and renderer action IDs.
    edits = (
        ('MenuUpdateStep["CheckForUpdates"] = "Check for Updates";',
         'MenuUpdateStep["CheckForUpdates"] = "检查更新…";'),
        ('MenuUpdateStep["CheckingForUpdates"] = "Checking for Updates...";',
         'MenuUpdateStep["CheckingForUpdates"] = "正在检查更新…";'),
        ('MenuUpdateStep["RestartToUpdate"] = "Restart to Update";',
         'MenuUpdateStep["RestartToUpdate"] = "用官方版更新…";'),
        ("autoUpdater.autoDownload = true;", "autoUpdater.autoDownload = false;"),
        ("autoUpdater.autoInstallOnAppQuit =\n        electron_1.app.isPackaged && process.platform !== 'win32';",
         "autoUpdater.autoInstallOnAppQuit = false;"),
        ("type: types_1.UpdateState.AvailableForDownload,\n"
         "            update: { version: info.version },\n"
         "        });\n        updateMenuState(MenuUpdateStep.DownloadingUpdate);",
         "type: types_1.UpdateState.Ready,\n"
         "            update: { version: info.version },\n"
         "        });\n        updateMenuState(MenuUpdateStep.RestartToUpdate);"),
        ("title: 'Check for Updates',\n                message: 'No updates available',\n                buttons: ['OK'],",
         "title: '检查更新',\n                message: '当前已是最新版。',\n                buttons: ['好'],"),
    )
    for before, after in edits:
        if updater.count(before) != 1:
            raise ValueError("这一版的 Antigravity 更新方式已变化，请使用英文原版。")
        updater = updater.replace(before, after, 1)

    source = json.dumps({"bundle": str(original), "requirement": GOOGLE_SIGNATURE})
    handoff = f"const officialUpdateSource = {source};\n" + update_script.decode().rstrip()
    updater, count = re.subn(
        r"^async function quitAndInstall\(isSilent = false\) \{\n.*?^\}",
        lambda _: handoff, updater, flags=re.MULTILINE | re.DOTALL,
    )
    if count != 1:
        raise ValueError("找不到 Antigravity 的安装更新入口，请使用英文原版。")
    return updater.encode()


def make_replacements(archive, original, dictionary, runtime, update_script):
    preload_name = "dist/preload.js"
    preload = archive.read(preload_name).decode()
    constants = archive.read("dist/constants.js").decode()
    if ("contextBridge.exposeInMainWorld('electronNative'" not in preload
            or "WINDOW_ORIGIN = 'https://127.0.0.1'" not in constants
            or "__AGY_I18N_DATA__" in preload):
        raise ValueError("这一版的 Antigravity 界面加载方式已变化，请使用英文原版。")

    # The existing isolated preload may update display text on the local app page.
    translations = json.loads(dictionary)
    translations["exact"]["Restart to Update"] = "用官方版更新"
    data = json.dumps(translations, ensure_ascii=True, separators=(",", ":"))
    preload += (
        "\n;(() => {\n"
        "  if (window.top !== window || window.location.protocol !== 'https:' ||\n"
        "      window.location.hostname !== '127.0.0.1') return;\n"
        f"  window.__AGY_I18N_DATA__ = {data};\n"
        + runtime.decode() + "\n})();\n"
    )
    updater_name = "dist/updater.js"
    replacements = {
        preload_name: preload.encode(),
        updater_name: patch_updater(archive.read(updater_name).decode(), original, update_script),
    }

    # Translate label literals only. Menu roles, IDs and update actions stay valid.
    labels = "|".join(re.escape(label) for label in MENU_LABELS)
    pattern = re.compile(r"\blabel:\s*(?:item\.label\s*\|\|\s*)?(['\"])(" + labels + r")\1")
    for name in ("dist/menu.js", "dist/main.js"):
        original = archive.read(name).decode()
        translated = pattern.sub(lambda match: match[0].replace(match[2], MENU_LABELS[match[2]]), original)
        if translated != original:
            replacements[name] = translated.encode()
    return replacements


def snapshot(app):
    info_data = (app / PLIST).read_bytes()
    info = plistlib.loads(info_data)
    archive_data = (app / ARCHIVE).read_bytes()
    archive = Asar(archive_data)
    package = json.loads(archive.read("package.json"))
    version = info["CFBundleShortVersionString"]
    integrity = info["ElectronAsarIntegrity"][ARCHIVE_KEY]
    if (not re.fullmatch(r"2\.\d+\.\d+", version) or package.get("version") != version
            or package.get("main") != "dist/main.js"):
        raise ValueError("版本识别失败。请使用 Antigravity 2.x 桌面版。")
    if integrity["algorithm"] != "SHA256" or integrity["hash"] != sha256(archive.header):
        raise ValueError("原版资源校验失败，请通过 Google 官方安装包修复。")
    return info, archive, version, sha256(info_data + archive_data)


def copy_spec(app, state_dir):
    _, _, version, source_hash = snapshot(app)
    dictionary = (HERE / "zh-CN.json").read_bytes()
    runtime = (HERE / "i18n-runtime.js").read_bytes()
    update_script = (HERE / "desktop-update.js").read_bytes()
    patch_hash = sha256(dictionary + runtime + update_script + Path(__file__).read_bytes())
    fingerprint = sha256((source_hash + patch_hash).encode() + os.fsencode(app))
    target = state_dir / f"{version}-{fingerprint[:16]}" / COPY_NAME
    marker = {"version": version, "source_sha256": source_hash, "patch_sha256": patch_hash}
    return target, marker, dictionary, runtime, update_script


def build_copy(original, target, marker, dictionary, runtime, update_script):
    if target.exists() or target.is_symlink():
        if target.is_symlink() or not (target / MARKER).is_file():
            raise ValueError(f"中文副本路径已有其他文件：{target}")
        if json.loads((target / MARKER).read_bytes()) != marker:
            raise ValueError(f"现有副本的版本记录不匹配：{target}")
        verify_signature(target)
        return

    print(f"正在从官方 {marker['version']} 版生成本地中文副本……", flush=True)
    with tempfile.TemporaryDirectory(prefix=".prepare-", dir=target.parent.parent) as scratch:
        staged = Path(scratch) / COPY_NAME
        run("/usr/bin/ditto", str(original), str(staged))
        verify_signature(staged, official=True)
        info, archive, _, source_hash = snapshot(staged)
        if source_hash != marker["source_sha256"]:
            raise ValueError("复制期间官方应用有更新，请再运行一次。")
        replacements = make_replacements(archive, original, dictionary, runtime, update_script)
        data, header_hash = archive.rebuild(replacements)
        (staged / ARCHIVE).write_bytes(data)
        info["ElectronAsarIntegrity"][ARCHIVE_KEY]["hash"] = header_hash
        (staged / PLIST).write_bytes(plistlib.dumps(info))
        (staged / MARKER).write_text(json.dumps(marker) + "\n", encoding="utf-8")
        run("/usr/bin/codesign", "--force", "--sign", "-", "--options", "runtime",
            "--preserve-metadata=identifier,entitlements,runtime", str(staged))
        verify_signature(staged)
        snapshot(staged)
        target.parent.mkdir(mode=0o700, exist_ok=True)
        staged.rename(target)


def running_apps():
    # Both copies intentionally use Antigravity's existing profile. Only one opens.
    paths = set()
    prefix = re.compile(r"^\s*(\d+)\s+(.+\.app)/Contents/MacOS/Antigravity\s*$")
    for line in run("/bin/ps", "-Aww", "-o", "uid=,comm=").splitlines():
        match = prefix.fullmatch(line)
        if match and int(match[1]) == os.getuid():
            paths.add(Path(match[2]).resolve())
    return paths


def wait_for_exit(target):
    running = running_apps()
    if not running - {target}:
        return target in running
    if not sys.stdin.isatty():
        raise ValueError("请先保存工作，按 ⌘Q 退出正在运行的 Antigravity，再运行脚本。")
    print("请保存工作，按 ⌘Q 退出正在运行的 Antigravity。退出后会自动继续。", flush=True)
    for _ in range(120):
        time.sleep(0.5)
        running = running_apps()
        if not running - {target}:
            return target in running
    raise ValueError("Antigravity 还开着。退出后请再双击一次。")


def open_app(app, already_running):
    if already_running:
        run("/usr/bin/open", "-a", str(app))
        return
    run("/usr/bin/open", "-n", "-a", str(app))
    for _ in range(20):
        if app in running_apps():
            return
        time.sleep(0.5)
    raise ValueError("没有检测到 Antigravity 启动。请查看 macOS 的提示。")


def switch(mode):
    state_dir = (Path.home() / "Library" / "Application Support"
                 / "Antigravity 语言切换")
    state_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
    with (state_dir / "switch.lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        original = find_original()
        verify_signature(original, official=True)
        if mode == "english":
            open_app(original, wait_for_exit(original))
            print("已打开 Google 官方英文版。", flush=True)
            return

        target, *_ = copy_spec(original, state_dir)
        wait_for_exit(target)
        # A staged official update may have finished during the normal quit.
        verify_signature(original, official=True)
        target, marker, dictionary, runtime, update_script = copy_spec(original, state_dir)
        build_copy(original, target, marker, dictionary, runtime, update_script)
        open_app(target, wait_for_exit(target))
        print("已打开 Antigravity 中文版。恢复英文时请双击「一键恢复英文」。", flush=True)


if __name__ == "__main__":
    if len(sys.argv) != 2 or sys.argv[1] not in {"chinese", "english"}:
        sys.exit("用法：switch_language.py chinese | english")
    try:
        switch(sys.argv[1])
    except KeyboardInterrupt:
        sys.exit("已取消。")
    except BlockingIOError:
        sys.exit("另一个语言切换窗口正在运行，请先等它结束。")
    except subprocess.CalledProcessError as error:
        sys.exit(f"切换失败。{(error.stderr or '').strip() or Path(error.cmd[0]).name}")
    except (KeyError, OSError, ValueError, struct.error, subprocess.TimeoutExpired) as error:
        sys.exit(f"切换失败。{error}")
