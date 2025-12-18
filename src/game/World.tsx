import { useEffect, useRef } from "react"
import * as THREE from "three"
import { createGridMaterial } from "./gridMaterial"
import { PlayerController } from "./PlayerController"
import { ThirdPersonCamera } from "./ThirdPersonCamera"

export type WorldProps = {
  controlsEnabled: boolean
  skyboxUrl: string
  playerName: string
}

function createNameSprite(name: string) {
  const canvas = document.createElement("canvas")
  canvas.width = 512
  canvas.height = 128
  const ctx = canvas.getContext("2d")
  if (!ctx) throw new Error("2D canvas context not available")

  ctx.clearRect(0, 0, canvas.width, canvas.height)
  // Fit text to the available width by reducing font size for longer names.
  const maxTextWidth = 460
  let fontSize = 56
  const minFontSize = 22
  const setFont = () => {
    ctx.font = `700 ${fontSize}px system-ui, -apple-system, Segoe UI, Roboto, Arial`
  }
  setFont()
  while (fontSize > minFontSize && ctx.measureText(name).width > maxTextWidth) {
    fontSize -= 2
    setFont()
  }
  ctx.textAlign = "center"
  ctx.textBaseline = "middle"

  // subtle stroke for readability
  ctx.lineWidth = Math.max(6, Math.round(fontSize * 0.18))
  ctx.strokeStyle = "rgba(0,0,0,0.55)"
  ctx.strokeText(name, canvas.width / 2, canvas.height / 2)

  ctx.fillStyle = "rgba(255,255,255,0.92)"
  ctx.fillText(name, canvas.width / 2, canvas.height / 2)

  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.needsUpdate = true

  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false })
  const sprite = new THREE.Sprite(mat)
  sprite.scale.set(2.2, 0.55, 1)

  return { sprite, texture: tex }
}

export default function World({ controlsEnabled, skyboxUrl, playerName }: WorldProps) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const controllerRef = useRef<PlayerController | null>(null)
  const rendererDomRef = useRef<HTMLCanvasElement | null>(null)
  const sceneRef = useRef<THREE.Scene | null>(null)
  const skyboxTexRef = useRef<THREE.Texture | null>(null)
  const texLoaderRef = useRef<THREE.TextureLoader | null>(null)
  const nameSpriteRef = useRef<{ sprite: THREE.Sprite; texture: THREE.Texture } | null>(null)

  useEffect(() => {
    controllerRef.current?.setEnabled(controlsEnabled)

    // If UI is blocking input, ensure pointer lock is released.
    if (!controlsEnabled && document.pointerLockElement) document.exitPointerLock()
  }, [controlsEnabled])

  useEffect(() => {
    const scene = sceneRef.current
    const loader = texLoaderRef.current
    if (!scene || !loader) return

    const prev = skyboxTexRef.current
    const tex = loader.load(skyboxUrl)
    tex.colorSpace = THREE.SRGBColorSpace
    tex.mapping = THREE.EquirectangularReflectionMapping
    scene.background = tex
    skyboxTexRef.current = tex
    prev?.dispose()
  }, [skyboxUrl])

  useEffect(() => {
    const scene = sceneRef.current
    if (!scene) return

    // Replace tag on name change.
    const prev = nameSpriteRef.current
    prev?.sprite.removeFromParent()
    ;(prev?.sprite.material as THREE.Material | undefined)?.dispose?.()
    prev?.texture.dispose()

    const created = createNameSprite(playerName)
    nameSpriteRef.current = created
    scene.add(created.sprite)
  }, [playerName])

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
    rendererDomRef.current = renderer.domElement

    const scene = new THREE.Scene()
    sceneRef.current = scene

    const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 2000)
    camera.position.set(0, 2, 6)

    // Background skybox (updates via skyboxUrl prop).
    const texLoader = new THREE.TextureLoader()
    texLoaderRef.current = texLoader
    const initialSkybox = texLoader.load(skyboxUrl)
    initialSkybox.colorSpace = THREE.SRGBColorSpace
    initialSkybox.mapping = THREE.EquirectangularReflectionMapping
    scene.background = initialSkybox
    skyboxTexRef.current = initialSkybox

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

    // Name tag
    const nameTag = createNameSprite(playerName)
    nameSpriteRef.current = nameTag
    scene.add(nameTag.sprite)

    const playerController = new PlayerController({ domElement: renderer.domElement })
    playerController.setEnabled(controlsEnabled)
    controllerRef.current = playerController
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

      // Keep name tag above player head
      if (nameSpriteRef.current) {
        nameSpriteRef.current.sprite.position.set(player.position.x, player.position.y + 1.1, player.position.z)
      }

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
      skyboxTexRef.current?.dispose()
      if (nameSpriteRef.current) {
        nameSpriteRef.current.sprite.removeFromParent()
        ;(nameSpriteRef.current.sprite.material as THREE.Material).dispose()
        nameSpriteRef.current.texture.dispose()
        nameSpriteRef.current = null
      }
      renderer.dispose()
      host.removeChild(renderer.domElement)
      controllerRef.current = null
      rendererDomRef.current = null
      sceneRef.current = null
      texLoaderRef.current = null
      skyboxTexRef.current = null
    }
  }, [])

  return <div ref={hostRef} style={{ width: "100vw", height: "100vh" }} />
}
