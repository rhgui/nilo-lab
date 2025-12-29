import * as THREE from "three"

export type PlayerControllerOptions = {
  domElement: HTMLElement
  /** Units per second (roughly) on a flat plane. */
  moveSpeed?: number
  /** Higher = slows down faster after releasing keys. */
  damping?: number
  /** Mouse sensitivity while pointer-locked. */
  mouseSensitivity?: number
  /** Clamp camera pitch to avoid flipping over. */
  pitchLimit?: number
  /** Jump force (units/sec upward velocity). */
  jumpForce?: number
}

/**
 * Minimal player controller:
 * - Click canvas to enter pointer lock
 * - Mouse changes yaw/pitch (stored here)
 * - WASD moves the given Object3D on the XZ plane relative to yaw
 *
 * Note: this does NOT do collision/physics; that's a later layer.
 */
export class PlayerController {
  private readonly domElement: HTMLElement
  private readonly keys = { w: false, a: false, s: false, d: false, space: false }

  private enabled = true
  private yaw = 0
  private pitch = 0

  private readonly velocity = new THREE.Vector3()
  private readonly moveSpeed: number
  private readonly damping: number
  private readonly mouseSensitivity: number
  private readonly pitchLimit: number
  private readonly jumpForce: number

  private readonly _forward = new THREE.Vector3(0, 0, -1)
  private readonly _right = new THREE.Vector3(1, 0, 0)
  private readonly _wish = new THREE.Vector3()
  private readonly _up = new THREE.Vector3(0, 1, 0)

  constructor(options: PlayerControllerOptions) {
    this.domElement = options.domElement
    this.moveSpeed = options.moveSpeed ?? 20.0
    this.damping = options.damping ?? 10.0
    this.mouseSensitivity = options.mouseSensitivity ?? 0.0022
    this.pitchLimit = options.pitchLimit ?? Math.PI / 2.2
    this.jumpForce = options.jumpForce ?? 7.0

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

  setEnabled(enabled: boolean) {
    this.enabled = enabled

    // When disabling input, stop movement immediately and clear held keys.
    if (!enabled) {
      this.keys.w = false
      this.keys.a = false
      this.keys.s = false
      this.keys.d = false
      this.keys.space = false
      this.velocity.set(0, 0, 0)
    }
  }

  getEnabled() {
    return this.enabled
  }

  getYaw() {
    return this.yaw
  }

  getPitch() {
    return this.pitch
  }

  getVelocity() {
    return this.velocity.clone()
  }

  setVelocityY(y: number) {
    this.velocity.y = y
  }

  update(dt: number, player: THREE.Object3D, isGrounded: boolean = true) {
    if (!this.enabled) return

    player.rotation.y = this.yaw

    // WASD movement on XZ plane, relative to facing (yaw).
    // We intentionally ignore pitch for movement so the player doesn't fly.
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
    
    // Jump (only when grounded) - check if space was just pressed
    let justJumped = false
    if (this.keys.space && isGrounded) {
      // Only jump if not already moving up significantly
      if (this.velocity.y <= 0.1) {
        this.velocity.y = this.jumpForce
        justJumped = true
      }
    }
    
    // Y velocity damping only when not grounded (falling)
    if (!isGrounded) {
      // Don't damp Y, let gravity handle it
    } else if (this.velocity.y > 0 && !justJumped) {
      // If grounded and moving up, stop upward movement
      // BUT: don't reset if we just jumped this frame
      this.velocity.y = 0
    }

    // Only apply XZ movement here, Y is handled by caller (physics or gravity)
    player.position.x += this.velocity.x * dt
    player.position.z += this.velocity.z * dt
  }

  private readonly requestPointerLock = () => {
    if (!this.enabled) return
    this.domElement.requestPointerLock?.()
  }

  private readonly onKeyDown = (e: KeyboardEvent) => {
    if (!this.enabled) return
    if (e.code === "KeyW") this.keys.w = true
    if (e.code === "KeyA") this.keys.a = true
    if (e.code === "KeyS") this.keys.s = true
    if (e.code === "KeyD") this.keys.d = true
    if (e.code === "Space") this.keys.space = true
  }

  private readonly onKeyUp = (e: KeyboardEvent) => {
    if (!this.enabled) return
    if (e.code === "KeyW") this.keys.w = false
    if (e.code === "KeyA") this.keys.a = false
    if (e.code === "KeyS") this.keys.s = false
    if (e.code === "KeyD") this.keys.d = false
    if (e.code === "Space") this.keys.space = false
  }

  private readonly onMouseMove = (e: MouseEvent) => {
    if (!this.enabled) return
    // Pointer lock hides the OS cursor and provides movementX/Y deltas.
    if (document.pointerLockElement !== this.domElement) return

    this.yaw -= e.movementX * this.mouseSensitivity
    this.pitch -= e.movementY * this.mouseSensitivity
    this.pitch = THREE.MathUtils.clamp(this.pitch, -this.pitchLimit, this.pitchLimit)
  }
}
