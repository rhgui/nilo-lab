import * as THREE from "three"

export type PlayerControllerOptions = {
  domElement: HTMLElement
  moveSpeed?: number
  damping?: number
  mouseSensitivity?: number
  pitchLimit?: number
}

export class PlayerController {
  private readonly domElement: HTMLElement
  private readonly keys = { w: false, a: false, s: false, d: false }

  private yaw = 0
  private pitch = 0

  private readonly velocity = new THREE.Vector3()
  private readonly moveSpeed: number
  private readonly damping: number
  private readonly mouseSensitivity: number
  private readonly pitchLimit: number

  private readonly _forward = new THREE.Vector3(0, 0, -1)
  private readonly _right = new THREE.Vector3(1, 0, 0)
  private readonly _wish = new THREE.Vector3()
  private readonly _up = new THREE.Vector3(0, 1, 0)

  constructor(options: PlayerControllerOptions) {
    this.domElement = options.domElement
    this.moveSpeed = options.moveSpeed ?? 2.5
    this.damping = options.damping ?? 10.0
    this.mouseSensitivity = options.mouseSensitivity ?? 0.0022
    this.pitchLimit = options.pitchLimit ?? Math.PI / 2.2

    this.domElement.style.cursor = "crosshair"

    this.domElement.addEventListener("click", this.requestPointerLock)
    window.addEventListener("keydown", this.onKeyDown)
    window.addEventListener("keyup", this.onKeyUp)
    window.addEventListener("mousemove", this.onMouseMove)
  }

  dispose() {
    this.domElement.removeEventListener("click", this.requestPointerLock)
    window.removeEventListener("keydown", this.onKeyDown)
    window.removeEventListener("keyup", this.onKeyUp)
    window.removeEventListener("mousemove", this.onMouseMove)
  }

  getYaw() {
    return this.yaw
  }

  getPitch() {
    return this.pitch
  }

  update(dt: number, player: THREE.Object3D) {
    player.rotation.y = this.yaw

    // WASD movement on XZ plane, relative to facing (yaw)
    const forward = this._forward.clone().applyAxisAngle(this._up, this.yaw)
    const right = this._right.clone().applyAxisAngle(this._up, this.yaw)

    this._wish.set(0, 0, 0)
    if (this.keys.w) this._wish.add(forward)
    if (this.keys.s) this._wish.sub(forward)
    if (this.keys.d) this._wish.add(right)
    if (this.keys.a) this._wish.sub(right)
    if (this._wish.lengthSq() > 0) this._wish.normalize()

    this.velocity.x += this._wish.x * this.moveSpeed * dt
    this.velocity.z += this._wish.z * this.moveSpeed * dt

    const damp = Math.exp(-this.damping * dt)
    this.velocity.x *= damp
    this.velocity.z *= damp

    player.position.x += this.velocity.x
    player.position.z += this.velocity.z
  }

  private readonly requestPointerLock = () => {
    this.domElement.requestPointerLock?.()
  }

  private readonly onKeyDown = (e: KeyboardEvent) => {
    if (e.code === "KeyW") this.keys.w = true
    if (e.code === "KeyA") this.keys.a = true
    if (e.code === "KeyS") this.keys.s = true
    if (e.code === "KeyD") this.keys.d = true
  }

  private readonly onKeyUp = (e: KeyboardEvent) => {
    if (e.code === "KeyW") this.keys.w = false
    if (e.code === "KeyA") this.keys.a = false
    if (e.code === "KeyS") this.keys.s = false
    if (e.code === "KeyD") this.keys.d = false
  }

  private readonly onMouseMove = (e: MouseEvent) => {
    if (document.pointerLockElement !== this.domElement) return

    this.yaw -= e.movementX * this.mouseSensitivity
    this.pitch -= e.movementY * this.mouseSensitivity
    this.pitch = THREE.MathUtils.clamp(this.pitch, -this.pitchLimit, this.pitchLimit)
  }
}
