// Copied into the Windows Chinese app with the verified official executable path.
async function quitAndInstall(isSilent = false) {
    if (installingUpdate || isSilent) return;
    installingUpdate = true;
    let scheduled = false;
    const window = (0, utils_1.getFocusedHubWindow)() ?? (0, utils_1.getHubWindows)()[0];
    const show = options => window && !window.isDestroyed()
        ? electron_1.dialog.showMessageBox(window, options)
        : electron_1.dialog.showMessageBox(options);

    try {
        const { response } = await show({
            type: 'question',
            title: '用官方版更新',
            message: '打开 Google 官方版来安装更新？',
            detail: '请先保存工作。确认后将退出中文副本并打开官方版。完成更新后，再双击 App 一键切换中文.cmd。',
            buttons: ['打开官方版', '取消'],
            defaultId: 1,
            cancelId: 1,
        });
        if (response !== 0) return;
        const sum = require('node:crypto').createHash('sha256');
        for await (const chunk of require('node:fs').createReadStream(officialUpdatePath)) {
            sum.update(chunk);
        }
        if (sum.digest('hex') !== officialUpdateSha256) {
            throw new Error('The official application has changed.');
        }
        electron_1.app.relaunch({ execPath: officialUpdatePath, args: [] });
        scheduled = true;
        (0, utils_1.setShowQuitConfirmation)(false);
        electron_1.app.quit();
    } catch (error) {
        console.error('[Antigravity localization] Could not open the official app:', error.message);
        await show({
            type: 'error',
            title: '无法打开官方版',
            message: '请双击 App 一键恢复英文.cmd 打开官方版并检查更新。',
            buttons: ['好'],
        });
    } finally {
        if (!scheduled) installingUpdate = false;
    }
}
