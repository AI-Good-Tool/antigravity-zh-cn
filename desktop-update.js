// Included in the desktop copy's Electron main process with a verified source path.
async function quitAndInstall() {
    if (installingUpdate) return;
    installingUpdate = true;
    let scheduled = false;
    const window = (0, utils_1.getFocusedHubWindow)() ?? (0, utils_1.getHubWindows)()[0];
    const show = options => window && !window.isDestroyed()
        ? electron_1.dialog.showMessageBox(window, options)
        : electron_1.dialog.showMessageBox(options);

    try {
        const { response } = await show({
            type: "question",
            title: "用官方版更新",
            message: "打开 Google 官方版来安装更新？",
            detail: "请先保存工作。确认后将退出中文副本并打开官方版。完成更新后，再双击「一键切换中文.command」。",
            buttons: ["打开官方版", "取消"],
            defaultId: 1,
            cancelId: 1,
        });
        if (response !== 0) return;

        const { bundle, requirement } = officialUpdateSource;
        const verify = require("node:util").promisify(child_process_1.execFile);
        await verify("/usr/bin/codesign", ["--verify", "--deep", "--strict", "-R=" + requirement, bundle],
            { timeout: 30000 });
        electron_1.app.relaunch({ execPath: path.join(bundle, "Contents/MacOS/Antigravity"), args: [] });
        scheduled = true;
        // The update prompt already confirmed a normal quit. Let the app clean up.
        (0, utils_1.setShowQuitConfirmation)(false);
        electron_1.app.quit();
    } catch (error) {
        console.error("[Antigravity localization] Could not open the official app:", error.message);
        await show({
            type: "error",
            title: "无法打开官方版",
            message: "请检查「应用程序」里的 Google 官方 Antigravity。",
            detail: "原版移到其他位置后，可以重新运行「一键切换中文.command」来生成副本。",
            buttons: ["好"],
        });
    } finally {
        if (!scheduled) installingUpdate = false;
    }
}
