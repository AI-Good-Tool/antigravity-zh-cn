import { app, webFrameMain } from 'electron';
import { readFileSync } from 'node:fs';

const workbench = '../vs/code/electron-browser/workbench/';
const editorPath = new URL(workbench + 'workbench.html', import.meta.url).pathname;
const managerPath = new URL(workbench + 'workbench-jetski-agent.html', import.meta.url).pathname;
const renderer = readFileSync(new URL('./renderer.js', import.meta.url), 'utf8');

function parseUrl(value) {
  return URL.canParse(value) ? new URL(value) : null;
}

function isLocalAgentPanel(url, frame) {
  if (!url || !['http:', 'https:'].includes(url.protocol) ||
      !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) return false;

  const params = url.searchParams;
  if (params.get('extensionView') !== 'true' ||
      params.get('extensionVariant') !== 'vs-code' ||
      params.get('platform') !== 'electron' ||
      (params.get('hostVariant') !== 'antigravity-ide' &&
       params.get('appName') !== 'Antigravity IDE')) return false;
  if (url.pathname !== '/' && url.pathname !== '/settings-standalone' &&
      !url.pathname.startsWith('/c/')) return false;

  for (let parent = frame.parent; parent; parent = parent.parent) {
    if (parseUrl(parent.url)?.protocol === 'vscode-webview:') return true;
  }
  return false;
}

app.on('web-contents-created', (_event, contents) => {
  contents.on('did-frame-finish-load', (_finish, isMainFrame, processId, routingId) => {
    const top = parseUrl(contents.getURL());
    if (top?.protocol !== 'vscode-file:' || top.hostname !== 'vscode-app') return;
    if (top.pathname !== editorPath && top.pathname !== managerPath) return;

    const frame = webFrameMain.fromId(processId, routingId);
    if (!frame || frame.isDestroyed()) return;
    const url = parseUrl(frame.url);
    if (isMainFrame ? top.pathname !== managerPath : !isLocalAgentPanel(url, frame)) return;

    // Check navigation again in the frame in case it changed before execution.
    const check = isMainFrame
      ? `location.protocol === 'vscode-file:' && location.hostname === 'vscode-app' &&
          location.pathname === ${JSON.stringify(managerPath)}`
      : `window !== window.top && location.origin === ${JSON.stringify(url.origin)}`;
    const script = `(() => {
      if (!(${check}) || window.__AGY_I18N_INITIALIZED__) return;
      ${renderer}
    })()`;
    // An iframe that disappears during navigation no longer needs translation.
    frame.executeJavaScript(script).catch(() => {});
  });
});
