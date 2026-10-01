import { Component } from 'react'
import type { ReactNode } from 'react'

export default class SceneBoundary extends Component<{ children: ReactNode; onFallback: () => void }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() {
    if (this.state.failed) return (
      <div className="scene-fallback" role="alert">
        <h2>星空暂时无法显示</h2><p>你仍然可以正常背词，学习记录会保留。</p>
        <button onClick={this.props.onFallback}>进入专注学习</button>
      </div>
    )
    return this.props.children
  }
}
