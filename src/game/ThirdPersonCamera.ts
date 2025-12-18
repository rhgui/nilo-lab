import * as THREE from "three"

export type ThirdPersonCameraOptions = {
  camera: THREE.PerspectiveCamera
  /** Added to player.position for look-at target (e.g. head height). */
  targetOffset?: THREE.Vector3
  /** Distance behind the target. */
  distance?: number
  /** Height above the target. */
  height?: number
}

/**
 * Simple third-person follow camera that keeps the player centered.
 * Camera orbits around the target using controller yaw/pitch.
 */
export class ThirdPersonCamera {
  private readonly camera: THREE.PerspectiveCamera
  private readonly targetOffset: THREE.Vector3
  private readonly distance: number
  private readonly height: number

  private readonly _target = new THREE.Vector3()
  private readonly _offset = new THREE.Vector3()

  constructor(options: ThirdPersonCameraOptions) {
    this.camera = options.camera
    this.targetOffset = options.targetOffset?.clone() ?? new THREE.Vector3(0, 0.6, 0)
    this.distance = options.distance ?? 5.5
    this.height = options.height ?? 1.6
  }

  update(player: THREE.Object3D, yaw: number, pitch: number) {
    this._target.copy(player.position).add(this.targetOffset)

    // Offset is rotated by yaw/pitch so camera orbits around target.
    this._offset.set(0, this.height, this.distance)
    this._offset.applyAxisAngle(new THREE.Vector3(1, 0, 0), pitch)
    this._offset.applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw)

    this.camera.position.copy(this._target).add(this._offset)

    // Keep player centered.
    this.camera.lookAt(this._target)
  }
}
