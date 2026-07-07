import { useEffect, useRef } from 'react'

interface Star { x: number; y: number; r: number; baseA: number; tw: number; layer: number }

// 背景视差星空：多层星点缓慢漂移 + 闪烁，鼠标轻微视差 → 2.5D 景深
export default function Starfield() {
  const ref = useRef<HTMLCanvasElement>(null)
  const mouse = useRef({ x: 0, y: 0 })

  useEffect(() => {
    const canvas = ref.current!
    const ctx = canvas.getContext('2d')!
    let raf = 0
    let stars: Star[] = []
    let w = 0
    let h = 0

    function resize() {
      w = canvas.width = window.innerWidth
      h = canvas.height = window.innerHeight
      const count = Math.floor((w * h) / 4500)
      stars = Array.from({ length: count }, () => {
        const layer = Math.random() < 0.6 ? 1 : Math.random() < 0.5 ? 2 : 3
        return {
          x: Math.random() * w,
          y: Math.random() * h,
          r: layer === 3 ? Math.random() * 1.6 + 0.8 : Math.random() * 1 + 0.3,
          baseA: layer === 3 ? 0.8 : layer === 2 ? 0.5 : 0.3,
          tw: Math.random() * Math.PI * 2,
          layer,
        }
      })
    }
    resize()
    window.addEventListener('resize', resize)

    function onMove(e: MouseEvent) {
      mouse.current.x = (e.clientX / window.innerWidth - 0.5) * 2
      mouse.current.y = (e.clientY / window.innerHeight - 0.5) * 2
    }
    window.addEventListener('mousemove', onMove)

    let t = 0
    function frame() {
      t += 0.012
      ctx.clearRect(0, 0, w, h)
      for (const s of stars) {
        // 视差：远层位移大一点
        const px = mouse.current.x * s.layer * 4
        const py = mouse.current.y * s.layer * 4
        // 缓慢上飘
        s.y -= s.layer * 0.02
        if (s.y < -2) s.y = h + 2
        const a = s.baseA * (0.6 + 0.4 * Math.sin(t + s.tw))
        ctx.beginPath()
        ctx.arc(s.x + px, s.y + py, s.r, 0, Math.PI * 2)
        ctx.fillStyle = `rgba(200,215,255,${a})`
        ctx.fill()
      }
      raf = requestAnimationFrame(frame)
    }
    frame()

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', resize)
      window.removeEventListener('mousemove', onMove)
    }
  }, [])

  return <canvas ref={ref} className="starfield" />
}
