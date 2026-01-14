import * as THREE from "three"

export type FreeCameraControllerOptions = {
  camera: THREE.PerspectiveCamera
  domElement: HTMLElement
  moveSpeed?: number
  mouseSensitivity?: number
  isMoveToolSelected?: () => boolean
  isEditingToolSelected?: () => boolean
}

/**
 * Free camera controller for terrain editor mode:
 * - WASD moves the camera
 * - Mouse drag rotates the camera
 * - No pointer lock needed
 */
export class FreeCameraController {
  private readonly camera: THREE.PerspectiveCamera
  private readonly domElement: HTMLElement
  private readonly keys = { w: false, a: false, s: false, d: false, q: false, e: false }
  private readonly moveSpeed: number
  private readonly mouseSensitivity: number
  private readonly isMoveToolSelected?: () => boolean
  private readonly isEditingToolSelected?: () => boolean

  private enabled = true
  private yaw = 0
  private pitch = 0
  private isDragging = false
  private lastMouseX = 0
  private lastMouseY = 0

  constructor(options: FreeCameraControllerOptions) {
    this.camera = options.camera
    this.domElement = options.domElement
    this.moveSpeed = options.moveSpeed ?? 20.0
    this.mouseSensitivity = options.mouseSensitivity ?? 0.002
    this.isMoveToolSelected = options.isMoveToolSelected
    this.isEditingToolSelected = options.isEditingToolSelected

    // Initialize camera position only if not already set (preserve existing position when switching tools)
    if (this.camera.position.lengthSq() < 0.01) {
      this.camera.position.set(0, 10, 10)
      this.yaw = Math.PI / 4
      this.pitch = -Math.PI / 6
    } else {
      // Preserve existing camera rotation by calculating from current look direction
      const direction = new THREE.Vector3()
      this.camera.getWorldDirection(direction)
      this.yaw = Math.atan2(direction.x, direction.z)
      this.pitch = Math.asin(-direction.y)
    }

    this.domElement.style.cursor = "grab"

    window.addEventListener("keydown", this.onKeyDown)
    window.addEventListener("keyup", this.onKeyUp)
    this.domElement.addEventListener("mousedown", this.onMouseDown)
    this.domElement.addEventListener("mousemove", this.onMouseMove)
    this.domElement.addEventListener("mouseup", this.onMouseUp)
    // Don't handle wheel here - World.tsx handles it for brush size
  }

  dispose() {
    window.removeEventListener("keydown", this.onKeyDown)
    window.removeEventListener("keyup", this.onKeyUp)
    this.domElement.removeEventListener("mousedown", this.onMouseDown)
    this.domElement.removeEventListener("mousemove", this.onMouseMove)
    this.domElement.removeEventListener("mouseup", this.onMouseUp)
  }

  setEnabled(enabled: boolean) {
    this.enabled = enabled
    if (!enabled) {
      this.isDragging = false
      this.domElement.style.cursor = "default"
    } else {
      this.domElement.style.cursor = "grab"
    }
  }

  update(dt: number) {
    if (!this.enabled) return

    // Calculate camera direction vectors in 3D space (relative to where camera is looking)
    // Forward direction (where camera is looking)
    const forward = new THREE.Vector3(0, 0, -1)
    forward.applyAxisAngle(new THREE.Vector3(1, 0, 0), this.pitch)
    forward.applyAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw)
    
    // Right direction (perpendicular to forward, horizontal)
    const right = new THREE.Vector3(1, 0, 0)
    right.applyAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw)
    
    // Up direction (world up, not camera up)
    const up = new THREE.Vector3(0, 1, 0)

    // Move camera relative to camera direction
    // Only move when move tool is selected
    // Inverted WASD: W=backward, S=forward, A=right, D=left
    const move = new THREE.Vector3(0, 0, 0)
    if (this.isMoveToolSelected && this.isMoveToolSelected()) {
      if (this.keys.w) move.sub(forward) // Move backward (inverted)
      if (this.keys.s) move.add(forward) // Move forward (inverted)
      if (this.keys.a) move.add(right) // Move right (inverted)
      if (this.keys.d) move.sub(right) // Move left (inverted)
      if (this.keys.q) move.sub(up) // Move down (world down)
      if (this.keys.e) move.add(up) // Move up (world up)

      // Normalize only if there's movement to prevent division by zero
      if (move.length() > 0) {
        move.normalize()
        move.multiplyScalar(this.moveSpeed * dt)
        this.camera.position.add(move)
      }
    }
    
    // For editing tools, do NOT rotate camera automatically
    // Camera stays fixed so user can paint/edit terrain without unwanted movement
    // Camera rotation only happens when move tool is selected and user drags mouse

    // Update camera rotation
    const offset = new THREE.Vector3(0, 0, 1)
    offset.applyAxisAngle(new THREE.Vector3(1, 0, 0), this.pitch)
    offset.applyAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw)
    
    const target = new THREE.Vector3().copy(this.camera.position).add(offset)
    this.camera.lookAt(target)
  }

  private readonly onKeyDown = (e: KeyboardEvent) => {
    if (!this.enabled) return
    if (e.code === "KeyW") this.keys.w = true
    if (e.code === "KeyA") this.keys.a = true
    if (e.code === "KeyS") this.keys.s = true
    if (e.code === "KeyD") this.keys.d = true
    if (e.code === "KeyQ") this.keys.q = true
    if (e.code === "KeyE") this.keys.e = true
  }

  private readonly onKeyUp = (e: KeyboardEvent) => {
    if (!this.enabled) return
    if (e.code === "KeyW") this.keys.w = false
    if (e.code === "KeyA") this.keys.a = false
    if (e.code === "KeyS") this.keys.s = false
    if (e.code === "KeyD") this.keys.d = false
    if (e.code === "KeyQ") this.keys.q = false
    if (e.code === "KeyE") this.keys.e = false
  }

  private readonly onMouseDown = (e: MouseEvent) => {
    if (!this.enabled) return
    // Only handle mouse dragging for move tool, not for editing tools
    if (this.isEditingToolSelected && this.isEditingToolSelected()) {
      return // Don't interfere with terrain editing tools
    }
    if (e.button === 0) { // Left mouse button
      this.isDragging = true
      this.lastMouseX = e.clientX
      this.lastMouseY = e.clientY
      this.domElement.style.cursor = "grabbing"
    }
  }

  private readonly onMouseMove = (e: MouseEvent) => {
    if (!this.enabled) return
    
    // Only handle dragging for move tool
    if (this.isDragging && this.isMoveToolSelected && this.isMoveToolSelected()) {
      const deltaX = e.clientX - this.lastMouseX
      const deltaY = e.clientY - this.lastMouseY

      this.yaw -= deltaX * this.mouseSensitivity
      this.pitch -= deltaY * this.mouseSensitivity
      this.pitch = THREE.MathUtils.clamp(this.pitch, -Math.PI / 2, Math.PI / 2)

      this.lastMouseX = e.clientX
      this.lastMouseY = e.clientY
    }
  }

  private readonly onMouseUp = (e: MouseEvent) => {
    if (!this.enabled) return
    // Only handle mouse up for move tool, not for editing tools
    if (this.isEditingToolSelected && this.isEditingToolSelected()) {
      return // Don't interfere with terrain editing tools
    }
    if (e.button === 0) { // Left mouse button
      this.isDragging = false
      this.domElement.style.cursor = "grab"
    }
  }

}
