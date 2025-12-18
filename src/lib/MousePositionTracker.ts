export type MousePosition = { x: number; y: number }

export class MousePositionTracker {
  private pos: MousePosition = { x: 0, y: 0 }
  private readonly listeners = new Set<(pos: MousePosition) => void>()

  constructor(target: Window | HTMLElement = window) {
    this.onMove = this.onMove.bind(this)
    target.addEventListener("mousemove", this.onMove as EventListener)
    this.dispose = () => {
      target.removeEventListener("mousemove", this.onMove as EventListener)
      this.listeners.clear()
    }
  }

  // Replaced in constructor to capture target.
  dispose() {}

  getPosition() {
    return this.pos
  }

  subscribe(listener: (pos: MousePosition) => void) {
    this.listeners.add(listener)
    listener(this.pos)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private emit() {
    for (const l of this.listeners) l(this.pos)
  }

  private onMove(e: MouseEvent) {
    this.pos = { x: e.clientX, y: e.clientY }
    this.emit()
  }
}
