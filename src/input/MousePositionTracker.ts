/**
 * Screen-space mouse position in CSS pixels (viewport coordinates).
 * Useful for UI overlays (e.g. custom cursor).
 */
export type MousePosition = { x: number; y: number }

/**
 * Small event-to-subscription adapter for mouse position tracking.
 * Keeps UI components free of raw event listeners.
 */
export class MousePositionTracker {
  private readonly target: Window | HTMLElement
  private pos: MousePosition = { x: 0, y: 0 }
  private readonly listeners = new Set<(pos: MousePosition) => void>()

  constructor(target: Window | HTMLElement = window) {
    this.target = target
    this.onMove = this.onMove.bind(this)
    this.target.addEventListener("mousemove", this.onMove as EventListener)
  }

  dispose() {
    this.target.removeEventListener("mousemove", this.onMove as EventListener)
    this.listeners.clear()
  }

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
