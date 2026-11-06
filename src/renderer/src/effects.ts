/** 轻量粒子特效：点击宠物时在点击位置爆发一圈彩色粒子 */

type Particle = {
  x: number
  y: number
  vx: number
  vy: number
  life: number
  maxLife: number
  size: number
  color: string
  gravity: number
}

const COLORS = ['#F5A25D', '#FF9E9E', '#FFD3B6', '#FFF1D6', '#FFC96B', '#F78CA0']

export class ParticleBurst {
  private canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private particles: Particle[] = []
  private raf = 0
  private running = false

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
    this.ctx = canvas.getContext('2d')!
    this.resize()
    window.addEventListener('resize', () => this.resize())
  }

  private resize(): void {
    const dpr = window.devicePixelRatio || 1
    this.canvas.width = this.canvas.clientWidth * dpr
    this.canvas.height = this.canvas.clientHeight * dpr
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  }

  /** 在指定位置爆发粒子（client 坐标，相对窗口） */
  burst(x: number, y: number, count = 18): void {
    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count + Math.random() * 0.6
      const speed = 1.5 + Math.random() * 3.2
      this.particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 1.2,
        life: 0,
        maxLife: 40 + Math.random() * 30,
        size: 2.5 + Math.random() * 3.5,
        color: COLORS[Math.floor(Math.random() * COLORS.length)],
        gravity: 0.12
      })
    }
    this.start()
  }

  private start(): void {
    if (this.running) return
    this.running = true
    const loop = (): void => {
      const ctx = this.ctx
      ctx.clearRect(0, 0, this.canvas.clientWidth, this.canvas.clientHeight)
      const w = this.canvas.clientWidth
      const h = this.canvas.clientHeight

      this.particles = this.particles.filter((p) => p.life < p.maxLife)
      for (const p of this.particles) {
        p.life++
        p.vy += p.gravity
        p.x += p.vx
        p.y += p.vy
        p.vx *= 0.98

        const t = 1 - p.life / p.maxLife
        ctx.globalAlpha = Math.max(0, t)
        ctx.fillStyle = p.color
        ctx.beginPath()
        ctx.arc(p.x, p.y, p.size * t + 0.4, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.globalAlpha = 1

      if (this.particles.length > 0) {
        this.raf = requestAnimationFrame(loop)
      } else {
        this.running = false
        ctx.clearRect(0, 0, w, h)
      }
    }
    this.raf = requestAnimationFrame(loop)
  }

  destroy(): void {
    cancelAnimationFrame(this.raf)
    this.particles = []
    this.running = false
  }
}
