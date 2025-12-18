export type HoldKeyTrackerOptions = {
  code: string
  target?: Window | HTMLElement
}

export class HoldKeyTracker {
  private readonly code: string
  private readonly target: Window | HTMLElement
  private isDown = false
  private readonly listeners = new Set<(down: boolean) => void>()

  constructor(options: HoldKeyTrackerOptions) {
    this.code = options.code
    this.target = options.target ?? window

    this.onKeyDown = this.onKeyDown.bind(this)
    this.onKeyUp = this.onKeyUp.bind(this)

    this.target.addEventListener("keydown", this.onKeyDown as EventListener)
    this.target.addEventListener("keyup", this.onKeyUp as EventListener)
  }

  dispose() {
    this.target.removeEventListener("keydown", this.onKeyDown as EventListener)
    this.target.removeEventListener("keyup", this.onKeyUp as EventListener)
    this.listeners.clear()
  }

  getDown() {
    return this.isDown
  }

  subscribe(listener: (down: boolean) => void) {
    this.listeners.add(listener)
    listener(this.isDown)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private emit() {
    for (const l of this.listeners) l(this.isDown)
  }

  private onKeyDown(e: KeyboardEvent) {
    if (e.code !== this.code) return
    if (this.isDown) return
    this.isDown = true
    this.emit()
  }

  private onKeyUp(e: KeyboardEvent) {
    if (e.code !== this.code) return
    if (!this.isDown) return
    this.isDown = false
    this.emit()
  }
}
