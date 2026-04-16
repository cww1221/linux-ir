/**
 * Wails 会在页面中注入 window.go.main.App；Vite 的 ES module 可能早于注入执行。
 * 在挂载 React 之前轮询，避免 GetSettings 等尚为 undefined。
 */
export function wailsAppBindingsReady(): boolean {
  const app = (window as unknown as { go?: { main?: { App?: Record<string, unknown> } } }).go?.main
    ?.App;
  if (!app) return false;
  return typeof app.GetSettings === "function" && typeof app.GetPlaybookCatalog === "function";
}

export function waitForWailsApp(maxMs = 12000): Promise<void> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      if (wailsAppBindingsReady()) {
        resolve();
        return;
      }
      if (Date.now() - start > maxMs) {
        reject(
          new Error(
            "Wails 绑定超时：window.go.main.App.GetSettings 不可用。请确认使用「wails build」完整打包（勿单独 go build），并执行 wails generate module 后重新 npm run build。"
          )
        );
        return;
      }
      window.setTimeout(tick, 16);
    };
    tick();
  });
}
