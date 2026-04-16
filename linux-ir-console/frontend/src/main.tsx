import React from 'react'
import {createRoot} from 'react-dom/client'
import './style.css'
import App from './App'
import { waitForWailsApp } from './wailsReady'

/** 捕获首屏渲染期异常，避免 WebView 内仅黑屏无提示 */
class RootErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { err: Error | null }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props)
    this.state = { err: null }
  }

  static getDerivedStateFromError(err: Error) {
    return { err }
  }

  render() {
    if (this.state.err) {
      return (
        <div
          style={{
            padding: 24,
            color: '#fecaca',
            background: '#0f172a',
            fontFamily: 'ui-monospace, Consolas, monospace',
            whiteSpace: 'pre-wrap',
            minHeight: '100vh',
            boxSizing: 'border-box',
          }}
        >
          <h2 style={{ marginTop: 0, color: '#f87171' }}>界面渲染失败</h2>
          <p>{String(this.state.err.message)}</p>
          <p style={{ opacity: 0.75 }}>
            若使用 exe：请用 <code>wails build -devtools</code> 重新打包后按 F12 查看 Console 完整堆栈。
          </p>
        </div>
      )
    }
    return this.props.children
  }
}

const container = document.getElementById('root')
if (!container) {
  throw new Error('index.html 缺少 #root')
}

function mountApp() {
  if (!container) return
  const root = createRoot(container)
  root.render(
    <React.StrictMode>
      <RootErrorBoundary>
        <App />
      </RootErrorBoundary>
    </React.StrictMode>
  )
}

waitForWailsApp()
  .then(mountApp)
  .catch((e: unknown) => {
    const msg = e instanceof Error ? e.message : String(e)
    container.innerHTML = `<div style="padding:24px;color:#fecaca;background:#0f172a;font-family:ui-monospace,Consolas,monospace;white-space:pre-wrap;min-height:100vh;box-sizing:border-box;">
<h2 style="margin-top:0;color:#f87171">Wails 未就绪</h2>
<p>${msg.replace(/</g, '&lt;')}</p>
<p style="opacity:.75">若在浏览器中直接打开 dist 的 index.html，不会出现 window.go；请运行打包后的 exe 或 <code>wails dev</code>。</p>
</div>`
  })
