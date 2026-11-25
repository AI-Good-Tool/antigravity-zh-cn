"""Build a Chinese Antigravity IDE copy and open either language."""

import fcntl
import json
import os
import plistlib
import subprocess
import sys
import tempfile
import time
from pathlib import Path

from switch_language import PLIST, run, sha256, verify_signature


HERE = Path(__file__).resolve().parent
APP = "Antigravity IDE.app"
COPY = "Antigravity IDE 中文.app"
EXECUTABLE = Path("Contents/MacOS/Electron")
RESOURCES = Path("Contents/Resources/app")
MAIN = RESOURCES / "out/main.js"
EXTENSION = RESOURCES / "extensions/agy/vscode/extension.js"
LOCALIZATION = RESOURCES / "out/antigravity-localization"
MARKER = LOCALIZATION / "version.json"
CODE_RESOURCES = Path("Contents/_CodeSignature/CodeResources")
GOOGLE_SIGNATURE = (
    'identifier "com.google.antigravity-ide" and anchor apple generic '
    'and certificate leaf[subject.OU] = "EQHXZ8M8AV"'
)
PATCH_FILES = ("zh-CN.json", "ide-zh-CN.json", "i18n-runtime.js", "ide-localization.mjs")


def find_original():
    for base in (Path("/Applications"), Path.home() / "Applications"):
        candidate = base / APP
        if (candidate / MAIN).is_file() and (candidate / EXECUTABLE).is_file():
            return candidate.resolve(strict=True)
    raise ValueError("在「应用程序」中找不到 Antigravity IDE。")


def verify_original(app):
    run("/usr/bin/codesign", "--verify", "--deep", "--strict", "-R=" + GOOGLE_SIGNATURE, str(app))
    if plistlib.loads((app / PLIST).read_bytes())["CFBundleExecutable"] != EXECUTABLE.name:
        raise ValueError("Antigravity IDE 的启动方式已变化。")


def source_digest(app):
    return sha256((app / PLIST).read_bytes() + (app / CODE_RESOURCES).read_bytes())


def patch_copy(app, files, marker):
    dictionary = json.loads(files["zh-CN.json"])
    ide_dictionary = json.loads(files["ide-zh-CN.json"])
    dictionary["exact"].update(ide_dictionary["exact"])
    dictionary["officialSkillDescriptions"] = ide_dictionary["officialSkillDescriptions"]

    entrypoint = app / MAIN
    source = entrypoint.read_bytes()
    title_file = app / EXTENSION
    extension = title_file.read_bytes()
    original_title = b'b.title=`${m} Settings`'
    if (b'import.meta.dirname' not in source or source.startswith(b"#!") or
            extension.count(original_title) != 1 or (app / LOCALIZATION).exists()):
        raise ValueError("这一版的 IDE 界面加载方式已变化。")

    local = app / LOCALIZATION
    local.mkdir()
    (local / "ide-localization.mjs").write_bytes(files["ide-localization.mjs"])
    data = json.dumps(dictionary, ensure_ascii=True, separators=(",", ":")).encode()
    (local / "renderer.js").write_bytes(
        b"window.__AGY_I18N_DATA__ = " + data + b";\n" + files["i18n-runtime.js"]
    )
    title_file.write_bytes(extension.replace(original_title, 'b.title=`${m} 设置`'.encode()))
    entrypoint.write_bytes(b'import "./antigravity-localization/ide-localization.mjs";\n' + source)
    (app / MARKER).write_text(json.dumps(marker) + "\n", encoding="utf-8")


def prepare(original, state):
    info = plistlib.loads((original / PLIST).read_bytes())
    version = info["CFBundleShortVersionString"]
    if not version or not all(part.isdigit() for part in version.split(".")):
        raise ValueError("无法识别 Antigravity IDE 版本。")
    files = {name: (HERE / name).read_bytes() for name in PATCH_FILES}
    source = source_digest(original)
    patch = sha256(Path(__file__).read_bytes() + b"".join(files.values()))
    fingerprint = sha256((source + patch).encode())[:16]
    marker = {"version": version, "source_sha256": source, "patch_sha256": patch}
    target = state / f"{version}-{fingerprint}" / COPY

    if target.exists() or target.is_symlink():
        if (target.is_symlink() or not (target / MARKER).is_file() or
                json.loads((target / MARKER).read_bytes()) != marker):
            raise ValueError(f"中文副本路径已有其他文件：{target}")
        verify_signature(target)
        return target

    print(f"正在生成 Antigravity IDE {version} 中文副本……", flush=True)
    with tempfile.TemporaryDirectory(prefix=".prepare-", dir=state) as scratch:
        staged = Path(scratch) / COPY
        run("/usr/bin/ditto", str(original), str(staged))
        verify_original(staged)
        if source_digest(staged) != source:
            raise ValueError("复制期间原版 IDE 有更新，请再运行一次。")
        patch_copy(staged, files, marker)
        run("/usr/bin/codesign", "--force", "--sign", "-", "--options", "runtime",
            "--preserve-metadata=identifier,entitlements,runtime", str(staged))
        verify_signature(staged)
        target.parent.mkdir(mode=0o700, exist_ok=True)
        staged.rename(target)
    return target


def running_apps():
    result = set()
    suffix = "/" + str(EXECUTABLE)
    for line in run("/bin/ps", "-Aww", "-o", "uid=,comm=").splitlines():
        uid, *command = line.strip().split(None, 1)
        if not command or uid != str(os.getuid()) or not command[0].endswith(suffix):
            continue
        app = Path(command[0][:-len(suffix)])
        if app.name in (APP, COPY):
            result.add(app.resolve())
    return result


def wait_for_exit(keep):
    if not running_apps() - keep:
        return
    message = "请保存工作，按 ⌘Q 退出正在运行的 Antigravity IDE"
    if not sys.stdin.isatty():
        raise ValueError(message + "，再运行脚本。")
    print(message + "。退出后会自动继续。", flush=True)
    for _ in range(120):
        time.sleep(0.5)
        if not running_apps() - keep:
            return
    raise ValueError("Antigravity IDE 仍在运行。退出后请再双击脚本。")


def switch(mode):
    state = Path.home() / "Library/Application Support/Antigravity IDE 语言切换"
    state.mkdir(mode=0o700, parents=True, exist_ok=True)
    with (state / "switch.lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        original = find_original()
        verify_original(original)
        target = original if mode == "english" else prepare(original, state)
        if mode == "prepare":
            print(target)
            return

        wait_for_exit({target} if mode == "chinese" else set())
        if target in running_apps():
            run("/usr/bin/open", "-a", str(target))
        else:
            locale = "zh-cn" if mode == "chinese" else "en"
            run("/usr/bin/open", "-n", "-a", str(target), "--args", "--locale=" + locale)
            for _ in range(30):
                if target in running_apps():
                    break
                time.sleep(0.5)
            else:
                raise ValueError("没有检测到 Antigravity IDE 启动。请查看 macOS 的提示。")
        print("已打开 Antigravity IDE " + ("中文副本。" if mode == "chinese" else "英文原版。"))


if __name__ == "__main__":
    if len(sys.argv) != 2 or sys.argv[1] not in ("chinese", "english", "prepare"):
        sys.exit("用法：switch_ide_language.py chinese | english | prepare")
    try:
        switch(sys.argv[1])
    except BlockingIOError:
        sys.exit("另一个 IDE 语言切换窗口正在运行，请稍后再试。")
    except KeyboardInterrupt:
        sys.exit("已取消。")
    except subprocess.CalledProcessError as error:
        sys.exit(f"切换失败。{(error.stderr or '').strip() or Path(error.cmd[0]).name}")
    except (KeyError, OSError, ValueError, subprocess.TimeoutExpired) as error:
        sys.exit(f"切换失败。{error}")
