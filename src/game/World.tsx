import { useEffect, useRef } from "react"
import * as THREE from "three"
import { createGridMaterial } from "./gridMaterial"
import { PlayerController } from "./PlayerController"
import { ThirdPersonCamera } from "./ThirdPersonCamera"

export default function World() {
  const hostRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    // Basic Three.js bootstrap (renderer/scene/camera) owned by this component.
    // Keep cleanup here so hot-reloads don't leak WebGL contexts or listeners.
    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: "high-performance",
    })
    renderer.setClearColor(0x0b0b0b, 1)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    host.appendChild(renderer.domElement)

    const scene = new THREE.Scene()

    const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 2000)
    camera.position.set(0, 2, 6)

    // Lights (subtle, mostly for future objects)
    scene.add(new THREE.AmbientLight(0xffffff, 0.35))
    const dir = new THREE.DirectionalLight(0xffffff, 0.65)
    dir.position.set(10, 20, 10)
    scene.add(dir)

    // 10x10 grid ground
    const gridMat = createGridMaterial({ scale: 1.0, lineWidth: 1.0 })

    const ground = new THREE.Mesh(new THREE.PlaneGeometry(10, 10, 1, 1), gridMat)
    ground.rotation.x = -Math.PI / 2
    scene.add(ground)

    // Player capsule
    const playerRadius = 0.35
    const playerHeight = 0.5
    const playerGeo = new THREE.CapsuleGeometry(playerRadius, playerHeight, 8, 16)
    const playerMat = new THREE.MeshStandardMaterial({ color: 0x4aa3ff, roughness: 0.4, metalness: 0.0 })
    const player = new THREE.Mesh(playerGeo, playerMat)
    player.castShadow = false
    player.receiveShadow = false
    player.position.set(0, playerRadius + playerHeight * 0.5, 0)
    scene.add(player)

    const playerController = new PlayerController({ domElement: renderer.domElement })
    const followCam = new ThirdPersonCamera({ camera })

    const resize = () => {
      const w = host.clientWidth
      const h = host.clientHeight
      renderer.setSize(w, h, false)
      camera.aspect = w / h
      camera.updateProjectionMatrix()
    }
    resize()

    const clock = new THREE.Clock()

    let raf = 0
    const tick = () => {
      raf = window.requestAnimationFrame(tick)
      const dt = Math.min(clock.getDelta(), 0.05)

      playerController.update(dt, player)

      // Clamp player to 10x10 ground ([-5,5] in x and z)
      const half = 5 - playerRadius * 0.75
      player.position.x = THREE.MathUtils.clamp(player.position.x, -half, half)
      player.position.z = THREE.MathUtils.clamp(player.position.z, -half, half)

      // Keep player centered in view
      followCam.update(player, playerController.getYaw(), playerController.getPitch())

      renderer.render(scene, camera)
    }
    tick()

    window.addEventListener("resize", resize)
    return () => {
      window.removeEventListener("resize", resize)
      window.cancelAnimationFrame(raf)
      playerController.dispose()
      ground.geometry.dispose()
      gridMat.dispose()
      playerGeo.dispose()
      playerMat.dispose()
      renderer.dispose()
      host.removeChild(renderer.domElement)
    }
  }, [])

  return <div ref={hostRef} style={{ width: "100vw", height: "100vh" }} />
}
