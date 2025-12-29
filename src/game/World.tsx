import { useEffect, useRef, useState } from "react"
import * as THREE from "three"
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js"
import { AnimationMixer, AnimationClip } from "three"
import { createGridMaterial } from "./gridMaterial"
import { PlayerController } from "./PlayerController"
import { ThirdPersonCamera } from "./ThirdPersonCamera"
import { useMyPresence, useOthers, useStorage } from "../liveblocks.config"

export type WorldProps = {
  controlsEnabled: boolean
  playerName: string
  selectedInventoryItem?: string
  onPlaceObject?: (itemId: string, position: THREE.Vector3, rotationY: number, scale: THREE.Vector3, color: number) => void
  onActionLog?: (label: string) => void
  onClearAllItems?: () => void
  onUiBlockingChange?: (blocking: boolean) => void
}

function getItemHeight(itemId: string, scale: THREE.Vector3 = new THREE.Vector3(1, 1, 1)): number {
  if (itemId === "cube") {
    return 0.2 * scale.y // Cube height
  } else if (itemId === "sphere") {
    return 0.2 * scale.x // Sphere diameter (radius * 2)
  }
  return 0.1 * scale.y // Default
}

function createItemMesh(itemId: string, scale: THREE.Vector3 = new THREE.Vector3(1, 1, 1), color: number = 0x4aa3ff, useScaleTransform: boolean = false): THREE.Mesh | null {
  if (itemId === "empty") return null

  let geometry: THREE.BufferGeometry
  // If useScaleTransform is true, create unit-sized geometry and use mesh.scale
  // Otherwise, bake scale into geometry (for preview items)
  if (useScaleTransform) {
    if (itemId === "cube") {
      geometry = new THREE.BoxGeometry(0.2, 0.2, 0.2)
    } else if (itemId === "sphere") {
      geometry = new THREE.SphereGeometry(0.1, 16, 16)
    } else {
      return null
    }
  } else {
    if (itemId === "cube") {
      geometry = new THREE.BoxGeometry(0.2 * scale.x, 0.2 * scale.y, 0.2 * scale.z)
    } else if (itemId === "sphere") {
      geometry = new THREE.SphereGeometry(0.1 * scale.x, 16, 16)
    } else {
      return null
    }
  }

  const material = new THREE.MeshStandardMaterial({
    color: color,
    roughness: 0.4,
    metalness: 0.0,
  })
  const mesh = new THREE.Mesh(geometry, material)
  if (useScaleTransform) {
    mesh.scale.set(scale.x, scale.y, scale.z)
  }
  return mesh
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

function createLoadingSprite(progress: number) {
  const canvas = document.createElement("canvas")
  canvas.width = 256
  canvas.height = 64
  const ctx = canvas.getContext("2d")
  if (!ctx) throw new Error("2D canvas context not available")

  ctx.clearRect(0, 0, canvas.width, canvas.height)
  
  // Background
  ctx.fillStyle = "rgba(0, 0, 0, 0.7)"
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  
  // Progress bar background
  ctx.fillStyle = "rgba(255, 255, 255, 0.2)"
  ctx.fillRect(10, 20, canvas.width - 20, 8)
  
  // Progress bar fill
  const progressWidth = ((canvas.width - 20) * progress) / 100
  ctx.fillStyle = "#4aa3ff"
  ctx.fillRect(10, 20, progressWidth, 8)
  
  // Text
  ctx.font = "600 20px system-ui, -apple-system, Segoe UI, Roboto, Arial"
  ctx.textAlign = "center"
  ctx.textBaseline = "middle"
  ctx.fillStyle = "rgba(255, 255, 255, 0.95)"
  ctx.fillText(`Loading ${Math.round(progress)}%`, canvas.width / 2, 10)

  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.needsUpdate = true

  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false })
  const sprite = new THREE.Sprite(mat)
  sprite.scale.set(1.5, 0.4, 1)

  return { sprite, texture: tex }
}

type RemoteVisual = {
  mesh: THREE.Mesh | THREE.Group | null
  name: string
  nameSprite: { sprite: THREE.Sprite; texture: THREE.Texture } | null
  loadingSprite: { sprite: THREE.Sprite; texture: THREE.Texture } | null
  loadingProgress: number
  modelUrl: string | null
}

export default function World({ controlsEnabled, playerName, selectedInventoryItem = "empty", onPlaceObject, onActionLog, onClearAllItems, onUiBlockingChange }: WorldProps) {
  // Get player model URL from sessionStorage
  const playerModelUrl = typeof window !== "undefined" ? sessionStorage.getItem("playerModelUrl") : null
  
  const skyboxUrl = useStorage((root) => root.skyboxUrl) ?? ""
  const placedItemsStorage = useStorage((root) => root.placedItems)
  const placedItemsRef = useRef<Map<string, THREE.Mesh>>(new Map())
  const placedItemsArrayRef = useRef<Array<{ id: string; itemId: string; x: number; y: number; z: number; rotationY?: number; scaleX?: number; scaleY?: number; scaleZ?: number; color?: number }>>([])
  const [, updateMyPresence] = useMyPresence()
  const others = useOthers()
  const othersRef = useRef(others)
  
  // Placement state
  const previewRotationRef = useRef(0)
  const previewScaleRef = useRef(new THREE.Vector3(1, 1, 1))
  const snapModeRef = useRef<"free" | "face" | "edge">("free")
  const onActionLogRef = useRef(onActionLog)
  
  // Helper to create snap mode label
  const createSnapLabel = (mode: string) => {
    const canvas = document.createElement("canvas")
    canvas.width = 256
    canvas.height = 64
    const ctx = canvas.getContext("2d")
    if (!ctx) return null

    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.font = "600 32px system-ui, -apple-system, Segoe UI, Roboto, Arial"
    ctx.textAlign = "center"
    ctx.textBaseline = "middle"
    ctx.fillStyle = "rgba(255, 157, 77, 0.95)"
    ctx.fillText(`Snap: ${mode}`, canvas.width / 2, canvas.height / 2)

    const tex = new THREE.CanvasTexture(canvas)
    tex.colorSpace = THREE.SRGBColorSpace
    tex.needsUpdate = true

    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false })
    const sprite = new THREE.Sprite(mat)
    sprite.scale.set(1.5, 0.4, 1)
    return { sprite, texture: tex }
  }
  const createSnapLabelRef = useRef(createSnapLabel)
  createSnapLabelRef.current = createSnapLabel

  const hostRef = useRef<HTMLDivElement | null>(null)
  const controllerRef = useRef<PlayerController | null>(null)
  const rendererDomRef = useRef<HTMLCanvasElement | null>(null)
  const sceneRef = useRef<THREE.Scene | null>(null)
  const skyboxTexRef = useRef<THREE.Texture | null>(null)
  const texLoaderRef = useRef<THREE.TextureLoader | null>(null)
  const nameSpriteRef = useRef<{ sprite: THREE.Sprite; texture: THREE.Texture } | null>(null)
  const remoteRef = useRef<Map<number, RemoteVisual>>(new Map())
  const myPlayerRef = useRef<THREE.Mesh | THREE.Group | null>(null)
  const myPlayerMixerRef = useRef<AnimationMixer | null>(null)
  const myPlayerAnimationsRef = useRef<{
    running?: AnimationClip
    walking?: AnimationClip
    idle?: AnimationClip
  }>({})
  const isMovingRef = useRef(false)
  const myLoadingSpriteRef = useRef<{ sprite: THREE.Sprite; texture: THREE.Texture } | null>(null)
  const groundMeshRef = useRef<THREE.Mesh | null>(null)
  const previewItemRef = useRef<THREE.Mesh | null>(null)
  const previewSnapLabelRef = useRef<THREE.Sprite | null>(null)
  const raycasterRef = useRef<THREE.Raycaster | null>(null)
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null)
  const clickListenerRef = useRef<((e: MouseEvent) => void) | null>(null)


  useEffect(() => {
    othersRef.current = others
  }, [others])

  useEffect(() => {
    onActionLogRef.current = onActionLog
  }, [onActionLog])

  // Keep placed items array in sync with storage for reactive updates
  useEffect(() => {
    if (placedItemsStorage) {
      placedItemsArrayRef.current = Array.from(placedItemsStorage)
    } else {
      placedItemsArrayRef.current = []
    }
  }, [placedItemsStorage])

  useEffect(() => {
    controllerRef.current?.setEnabled(controlsEnabled)

    // If UI is blocking input, ensure pointer lock is released.
    if (!controlsEnabled && document.pointerLockElement) document.exitPointerLock()
  }, [controlsEnabled])

  useEffect(() => {
    const scene = sceneRef.current
    const loader = texLoaderRef.current
    if (!scene || !loader || !skyboxUrl) return

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
    // Don't add to scene - we don't show our own name tag, only other players

    // Keep presence name in sync
    updateMyPresence({ name: playerName })
  }, [playerName])

  useEffect(() => {
    const scene = sceneRef.current
    if (!scene) return

    // Update placement preview - recreate when item changes
    if (previewItemRef.current) {
      previewItemRef.current.removeFromParent()
      previewItemRef.current.geometry.dispose()
      ;(previewItemRef.current.material as THREE.MeshStandardMaterial).dispose()
      previewItemRef.current = null
    }

    // Remove old snap label
    if (previewSnapLabelRef.current) {
      previewSnapLabelRef.current.removeFromParent()
      ;(previewSnapLabelRef.current.material as THREE.SpriteMaterial).map?.dispose()
      ;(previewSnapLabelRef.current.material as THREE.SpriteMaterial).dispose()
      previewSnapLabelRef.current = null
    }

    // Use default scale (1,1,1) and default color
    const defaultScale = new THREE.Vector3(1, 1, 1)
    const defaultColor = 0x4aa3ff

    const previewItem = createItemMesh(selectedInventoryItem, defaultScale, defaultColor)
    if (previewItem) {
      previewItem.rotation.y = previewRotationRef.current
      const mat = previewItem.material as THREE.MeshStandardMaterial
      const clonedMat = mat.clone()
      clonedMat.transparent = true
      clonedMat.opacity = 0.5
      clonedMat.emissive = new THREE.Color(0x00ff00)
      clonedMat.emissiveIntensity = 0.3
      previewItem.material = clonedMat
      previewItem.visible = false
      scene.add(previewItem)
      previewItemRef.current = previewItem

      // Add snap mode label
      const snapLabel = createSnapLabelRef.current?.(snapModeRef.current)
      if (snapLabel) {
        scene.add(snapLabel.sprite)
        previewSnapLabelRef.current = snapLabel.sprite
        snapLabel.sprite.visible = false
      }
    }
  }, [selectedInventoryItem])

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
    if (skyboxUrl) {
      const initialSkybox = texLoader.load(skyboxUrl)
      initialSkybox.colorSpace = THREE.SRGBColorSpace
      initialSkybox.mapping = THREE.EquirectangularReflectionMapping
      scene.background = initialSkybox
      skyboxTexRef.current = initialSkybox
    } else {
      // Set a default background color if no skybox
      scene.background = new THREE.Color(0x0b0b0b)
    }

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
    groundMeshRef.current = ground

    // Player mesh - load GLB model if available, otherwise use capsule
    const playerRadius = 0.25
    const playerHeight = 1.7 // Standard human height in meters
    const playerGeo = new THREE.CapsuleGeometry(playerRadius, playerHeight, 8, 16)
    const playerMat = new THREE.MeshStandardMaterial({ color: 0x4aa3ff, roughness: 0.4, metalness: 0.0 })
    const player = new THREE.Mesh(playerGeo, playerMat)
    player.castShadow = false
    player.receiveShadow = false
    player.position.set(0, playerRadius + playerHeight * 0.5, 0) // Capsule center is at radius + half height
    scene.add(player)
    myPlayerRef.current = player
    
    // Load GLB model if available (will replace capsule)
    if (playerModelUrl) {
      const loader = new GLTFLoader()
      // ALL Meshy URLs must go through proxy due to CORS restrictions (Meshy doesn't send CORS headers)
      // The proxy is designed to handle signed URLs by preserving the URL byte-for-byte
      const needsProxy = playerModelUrl.includes('assets.meshy.ai')
      const loadUrl = needsProxy 
        ? `/api/meshy/proxy?url=${encodeURIComponent(playerModelUrl)}`
        : playerModelUrl
      
      // Show loading indicator
      console.log("Loading player model from:", loadUrl)
      
      // Create initial loading sprite
      const initialLoading = createLoadingSprite(0)
      scene.add(initialLoading.sprite)
      initialLoading.sprite.position.set(0, playerRadius + playerHeight * 0.5 + 1.5, 0) // Above capsule center
      myLoadingSpriteRef.current = initialLoading
      
      loader.load(
        loadUrl,
        (gltf) => {
          // Remove loading sprite
          if (myLoadingSpriteRef.current) {
            scene.remove(myLoadingSpriteRef.current.sprite)
            myLoadingSpriteRef.current.texture.dispose()
            ;(myLoadingSpriteRef.current.sprite.material as THREE.Material).dispose()
            myLoadingSpriteRef.current = null
          }
          
          const model = gltf.scene
          // Center and scale the model
          const bbox = new THREE.Box3().setFromObject(model)
          const center = bbox.getCenter(new THREE.Vector3())
          const size = bbox.getSize(new THREE.Vector3())
          const height = size.y // Use actual height dimension
          const scaleFactor = playerHeight / height // Scale to match player height
          
          model.scale.set(scaleFactor, scaleFactor, scaleFactor)
          // Rotate 180 degrees on Y axis to face opposite direction (for gameplay)
          // Store rotation in userData to persist
          model.rotation.y = Math.PI
          model.userData.rotationY = Math.PI
          
          // Position on ground: place bottom of model at ground level
          // After scaling, the bottom of the model is at bbox.min.y * scaleFactor relative to origin
          // Ground level is at y = playerRadius (where the capsule bottom sits)
          // We need: position.y = playerRadius - (bbox.min.y * scaleFactor)
          const groundLevel = playerRadius // Ground level where bottom should sit
          const scaledMinY = bbox.min.y * scaleFactor
          model.position.set(-center.x * scaleFactor, groundLevel - scaledMinY, -center.z * scaleFactor)
          model.castShadow = false
          model.receiveShadow = false
          
          // Replace capsule with model
          if (myPlayerRef.current) {
            const oldPos = myPlayerRef.current.position.clone()
            scene.remove(myPlayerRef.current)
            if (myPlayerRef.current instanceof THREE.Mesh) {
              myPlayerRef.current.geometry.dispose()
              ;(myPlayerRef.current.material as THREE.Material).dispose()
            }
            model.position.copy(oldPos)
            // Ensure rotation persists
            model.rotation.y = Math.PI
          }
          scene.add(model)
          myPlayerRef.current = model as any
          console.log("Player model loaded successfully, rotation:", model.rotation.y)
          
          // Setup animations if available
          if (gltf.animations && gltf.animations.length > 0) {
            const mixer = new AnimationMixer(model)
            myPlayerMixerRef.current = mixer
            
            // Store animations by name
            for (const clip of gltf.animations) {
              if (clip.name.toLowerCase().includes("run")) {
                myPlayerAnimationsRef.current.running = clip
              } else if (clip.name.toLowerCase().includes("walk")) {
                myPlayerAnimationsRef.current.walking = clip
              } else if (clip.name.toLowerCase().includes("idle") || clip.name.toLowerCase().includes("t-pose") || clip.name.toLowerCase().includes("a-pose")) {
                myPlayerAnimationsRef.current.idle = clip
              }
            }
            
            // Play idle animation by default
            if (myPlayerAnimationsRef.current.idle) {
              const action = mixer.clipAction(myPlayerAnimationsRef.current.idle)
              action.play()
            }
            console.log("Player animations loaded:", Object.keys(myPlayerAnimationsRef.current))
          } else {
            // Try to load animations from sessionStorage if rigging was done
            const animationsJson = sessionStorage.getItem("playerAnimations")
            if (animationsJson) {
              try {
                const animations = JSON.parse(animationsJson)
                console.log("Found stored animation URLs:", animations)
                
                // Load running animation GLB if available
                if (animations.running) {
                  const animLoader = new GLTFLoader()
                  // ALL Meshy URLs must go through proxy due to CORS restrictions (Meshy doesn't send CORS headers)
                  // The proxy is designed to handle signed URLs by preserving the URL byte-for-byte
                  const needsProxy = animations.running.includes('assets.meshy.ai')
                  const loadUrl = needsProxy ? `/api/meshy/proxy?url=${encodeURIComponent(animations.running)}` : animations.running
                  console.log("Loading animation from:", loadUrl, needsProxy ? "(via proxy - required for CORS)" : "(direct)")
                  
                  animLoader.load(loadUrl, (animGltf) => {
                    if (animGltf.animations && animGltf.animations.length > 0) {
                      const mixer = new AnimationMixer(model)
                      myPlayerMixerRef.current = mixer
                      
                      // Find running animation
                      for (const clip of animGltf.animations) {
                        if (clip.name.toLowerCase().includes("run")) {
                          myPlayerAnimationsRef.current.running = clip
                        } else if (clip.name.toLowerCase().includes("walk")) {
                          myPlayerAnimationsRef.current.walking = clip
                        }
                      }
                      
                      // Play idle by default (a-pose/t-pose from rigged model)
                      // The rigged model should have a default pose
                      console.log("Loaded animations from separate GLB:", Object.keys(myPlayerAnimationsRef.current))
                    }
                  }, undefined, (error) => {
                    console.error("Failed to load running animation:", error)
                  })
                }
              } catch (e) {
                console.error("Failed to parse stored animations:", e)
              }
            }
          }
        },
        (progress) => {
          if (progress.lengthComputable && myLoadingSpriteRef.current) {
            const percent = (progress.loaded / progress.total) * 100
            console.log(`Loading player model: ${percent.toFixed(1)}%`)
            
            // Update loading sprite
            const oldSprite = myLoadingSpriteRef.current.sprite
            const oldPos = oldSprite.position.clone()
            scene.remove(oldSprite)
            oldSprite.material.dispose()
            myLoadingSpriteRef.current.texture.dispose()
            
            const newLoading = createLoadingSprite(percent)
            scene.add(newLoading.sprite)
            newLoading.sprite.position.copy(oldPos)
            myLoadingSpriteRef.current = newLoading
          }
        },
        (error) => {
          // Remove loading sprite on error
          if (myLoadingSpriteRef.current) {
            scene.remove(myLoadingSpriteRef.current.sprite)
            myLoadingSpriteRef.current.texture.dispose()
            ;(myLoadingSpriteRef.current.sprite.material as THREE.Material).dispose()
            myLoadingSpriteRef.current = null
          }
          console.error("Failed to load player model, keeping capsule:", error)
        }
      )
    }

    // Name tag - create but don't add to scene (we don't show our own name tag)
    const nameTag = createNameSprite(playerName)
    nameSpriteRef.current = nameTag
    // Don't add to scene - we only show other players' name tags

    const playerController = new PlayerController({ domElement: renderer.domElement })
    playerController.setEnabled(controlsEnabled)
    controllerRef.current = playerController
    const followCam = new ThirdPersonCamera({ camera })
    cameraRef.current = camera

    const raycaster = new THREE.Raycaster()
    raycasterRef.current = raycaster

    // Hand-held item and preview will be created/updated via useEffect

    // Mouse click to place (will be added in tick loop)

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

      // Simple controller with gravity (no physics)
      const player = myPlayerRef.current
      if (!player) return
      
      const groundY = playerRadius + playerHeight * 0.5 // Capsule center Y position
      const isGrounded = Math.abs(player.position.y - groundY) < 0.1
      
      // Update controller (handles XZ movement and jump input)
      playerController.update(dt, player, isGrounded)
      let finalVel = playerController.getVelocity()
      
      // Apply gravity to Y velocity if in air
      if (!isGrounded && finalVel.y > -20) {
        // Apply gravity (limit max fall speed)
        finalVel.y -= 9.81 * dt
        playerController.setVelocityY(finalVel.y)
      }
      
      // Apply movement
      player.position.x += finalVel.x * dt
      player.position.y += finalVel.y * dt
      player.position.z += finalVel.z * dt
      
      // Clamp to ground and reset velocity (only if falling, not jumping)
      if (player.position.y <= groundY) {
        player.position.y = groundY
        // Only reset velocity if falling or at rest, not if jumping upward
        if (finalVel.y <= 0) {
          playerController.setVelocityY(0)
        }
      }

      // Clamp player to 10x10 ground ([-5,5] in x and z)
      const half = 5 - playerRadius * 0.75
      player.position.x = THREE.MathUtils.clamp(player.position.x, -half, half)
      player.position.z = THREE.MathUtils.clamp(player.position.z, -half, half)

      // Keep player centered in view
      followCam.update(player, playerController.getYaw(), playerController.getPitch())
      
      // Ensure player model rotation persists (180 degrees base rotation for GLB models)
      if (player && !(player instanceof THREE.Mesh)) {
        // For GLB models, ensure 180-degree rotation is applied
        const playerObj = player as THREE.Object3D
        const baseRotation = (playerObj.userData?.rotationY as number | undefined) ?? Math.PI
        playerObj.rotation.y = playerController.getYaw() + baseRotation
        if (!playerObj.userData.rotationY) {
          playerObj.userData.rotationY = Math.PI
        }
      }
      
      // Update animations based on movement
      const isMoving = Math.abs(finalVel.x) > 0.1 || Math.abs(finalVel.z) > 0.1
      if (isMovingRef.current !== isMoving && myPlayerMixerRef.current) {
        isMovingRef.current = isMoving
        const mixer = myPlayerMixerRef.current
        const animations = myPlayerAnimationsRef.current
        
        // Stop all current actions
        mixer.stopAllAction()
        
        if (isMoving && animations.running) {
          // Play running animation when moving
          const action = mixer.clipAction(animations.running)
          action.reset().play()
          console.log("Playing running animation")
        } else if (!isMoving && animations.idle) {
          // Play idle (a-pose/t-pose) when stopped
          const action = mixer.clipAction(animations.idle)
          action.reset().play()
          console.log("Playing idle animation")
        } else if (isMoving && animations.walking) {
          // Fallback to walking if running not available
          const action = mixer.clipAction(animations.walking)
          action.reset().play()
          console.log("Playing walking animation")
        }
      }
      
      // Update animation mixer
      if (myPlayerMixerRef.current) {
        myPlayerMixerRef.current.update(dt)
      }
      
      // Update loading sprite position for local player
      if (myLoadingSpriteRef.current) {
        const player = myPlayerRef.current
        if (player) {
          myLoadingSpriteRef.current.sprite.position.set(
            player.position.x,
            player.position.y + 1.5,
            player.position.z
          )
        }
      }

      // Don't update our own name tag position - we don't show it

      // Update placement preview with raycasting (center of screen when pointer locked)
      // Use ref to get current selectedInventoryItem without adding to deps
      const currentSelectedItem = selectedInventoryItemRef.current
      if (previewItemRef.current && currentSelectedItem !== "empty" && document.pointerLockElement) {
        const mouse = new THREE.Vector2(0, 0)
        raycaster.setFromCamera(mouse, camera)
        
        // Raycast against ground and all placed items
        const objectsToIntersect: THREE.Object3D[] = [ground]
        for (const mesh of placedItemsRef.current.values()) {
          objectsToIntersect.push(mesh)
        }
        const intersects = raycaster.intersectObjects(objectsToIntersect, false)

        if (intersects.length > 0) {
          // Find the highest intersection point (topmost surface)
          let highestPoint = intersects[0].point
          let highestY = intersects[0].point.y
          for (const intersect of intersects) {
            if (intersect.point.y > highestY) {
              highestY = intersect.point.y
              highestPoint = intersect.point
            }
          }
          
          // Apply snap mode
          let snappedX = highestPoint.x
          let snappedZ = highestPoint.z
          const snapMode = snapModeRef.current
          if (snapMode === "edge") {
            snappedX = Math.round(highestPoint.x * 2) / 2
            snappedZ = Math.round(highestPoint.z * 2) / 2
          } else if (snapMode === "face") {
            snappedX = Math.round(highestPoint.x)
            snappedZ = Math.round(highestPoint.z)
          }
          // Place preview so bottom sits on the surface (position is center, so add half height)
          const currentScale = previewScaleRef.current
          const itemHeight = getItemHeight(currentSelectedItem, currentScale)
          const previewY = highestY + itemHeight * 0.5
          previewItemRef.current.position.set(snappedX, previewY, snappedZ)
          previewItemRef.current.rotation.y = previewRotationRef.current
          previewItemRef.current.visible = true
          
          // Update snap label position - always show it above the preview block
          if (previewSnapLabelRef.current) {
            // Position label above the preview item
            const labelY = previewY + itemHeight * 0.5 + 0.5
            previewSnapLabelRef.current.position.set(snappedX, labelY, snappedZ)
            previewSnapLabelRef.current.visible = true
          } else {
            // Create label if it doesn't exist
            const currentMode = snapModeRef.current
            const label = createSnapLabelRef.current?.(currentMode)
            if (label) {
              const labelY = previewY + itemHeight * 0.5 + 0.5
              scene.add(label.sprite)
              label.sprite.position.set(snappedX, labelY, snappedZ)
              label.sprite.visible = true
              previewSnapLabelRef.current = label.sprite
            }
          }
        } else {
          previewItemRef.current.visible = false
          if (previewSnapLabelRef.current) {
            previewSnapLabelRef.current.visible = false
          }
        }
      } else if (previewItemRef.current) {
        previewItemRef.current.visible = false
        if (previewSnapLabelRef.current) {
          previewSnapLabelRef.current.visible = false
        }
      }

      // Handle mouse click to place objects (listener added in useEffect)

      // Broadcast my presence (position + facing), throttled ~20Hz
      presenceAccumRef.current += dt
      if (presenceAccumRef.current >= 0.05) {
        presenceAccumRef.current = 0
        const player = myPlayerRef.current
        if (player) {
          const yaw = playerController.getYaw()
          const pitch = playerController.getPitch()
          updateMyPresence({
            x: player.position.x,
            y: player.position.y,
            z: player.position.z,
            yaw,
            pitch,
            name: playerNameRef.current,
            modelUrl: playerModelUrl || null,
          })
        }
      }

      // Update remote players
      const seen = new Set<number>()
      for (const other of othersRef.current) {
        const id = other.connectionId
        seen.add(id)
        const p = other.presence as any
        const x = typeof p?.x === "number" ? p.x : 0
        const y = typeof p?.y === "number" ? p.y : playerRadius + playerHeight * 0.5 // Default to capsule center
        const z = typeof p?.z === "number" ? p.z : 0
        const yawO = typeof p?.yaw === "number" ? p.yaw : 0
        const nameO = typeof p?.name === "string" ? p.name : "Player"
        const modelUrlO = typeof p?.modelUrl === "string" ? p.modelUrl : null

        let v = remoteRef.current.get(id)
        if (!v) {
          v = { mesh: null as any, name: nameO, nameSprite: null as any, loadingSprite: null, loadingProgress: 0, modelUrl: null }
          remoteRef.current.set(id, v)
        }

        // Update model if URL changed or not yet loaded
        if (modelUrlO !== v.modelUrl || !v.mesh) {
          if (v.mesh) {
            // Dispose old mesh
            v.mesh.removeFromParent()
            if (v.mesh instanceof THREE.Mesh) {
              v.mesh.geometry.dispose()
              ;(v.mesh.material as THREE.Material).dispose()
            } else if (v.mesh instanceof THREE.Group) {
              v.mesh.traverse((child) => {
                if (child instanceof THREE.Mesh) {
                  child.geometry.dispose()
                  if (Array.isArray(child.material)) {
                    child.material.forEach((mat) => mat.dispose())
                  } else {
                    (child.material as THREE.Material).dispose()
                  }
                }
              })
            }
          }

          if (modelUrlO) {
            // Remove old loading sprite if exists
            if (v.loadingSprite) {
              scene.remove(v.loadingSprite.sprite)
              v.loadingSprite.texture.dispose()
              ;(v.loadingSprite.sprite.material as THREE.Material).dispose()
              v.loadingSprite = null
            }
            
            // Create loading sprite
            const loadingSprite = createLoadingSprite(0)
            scene.add(loadingSprite.sprite)
            loadingSprite.sprite.position.set(x, y + 1.5, z)
            v.loadingSprite = loadingSprite
            v.loadingProgress = 0
            
            // Load remote player's custom model
            const loader = new GLTFLoader()
            // ALL Meshy URLs must go through proxy due to CORS restrictions (Meshy doesn't send CORS headers)
            // The proxy is designed to handle signed URLs by preserving the URL byte-for-byte
            const needsProxy = modelUrlO.includes('assets.meshy.ai')
            const loadUrl = needsProxy
              ? `/api/meshy/proxy?url=${encodeURIComponent(modelUrlO)}`
              : modelUrlO
            loader.load(
              loadUrl,
              (gltf) => {
                // Remove loading sprite
                if (v!.loadingSprite) {
                  scene.remove(v!.loadingSprite.sprite)
                  v!.loadingSprite.texture.dispose()
                  ;(v!.loadingSprite.sprite.material as THREE.Material).dispose()
                  v!.loadingSprite = null
                }
                
                const model = gltf.scene
                const bbox = new THREE.Box3().setFromObject(model)
                const center = bbox.getCenter(new THREE.Vector3())
                const size = bbox.getSize(new THREE.Vector3())
                const height = size.y // Use actual height dimension
                const scaleFactor = playerHeight / height // Scale to match player height

                model.scale.set(scaleFactor, scaleFactor, scaleFactor)
                // Rotate 180 degrees on Y axis to face opposite direction (for gameplay)
                model.rotation.y = Math.PI
                model.userData.rotationY = Math.PI // Store rotation to persist
                // Position on ground: place bottom of model at ground level
                // After scaling, the bottom of the model is at bbox.min.y * scaleFactor relative to origin
                // Ground level is at y = playerRadius (where the capsule bottom sits)
                // We need: position.y = playerRadius - (bbox.min.y * scaleFactor)
                const groundLevel = playerRadius // Ground level where bottom should sit
                const scaledMinY = bbox.min.y * scaleFactor
                model.position.set(-center.x * scaleFactor, groundLevel - scaledMinY, -center.z * scaleFactor)
                model.castShadow = false
                model.receiveShadow = false

                scene.add(model)
                v!.mesh = model as any
                v!.modelUrl = modelUrlO
                v!.loadingProgress = 100
              },
              (progress) => {
                if (progress.lengthComputable && v!.loadingSprite) {
                  const percent = (progress.loaded / progress.total) * 100
                  v!.loadingProgress = percent
                  
                  // Update loading sprite
                  const oldSprite = v!.loadingSprite!.sprite
                  const oldPos = oldSprite.position.clone()
                  scene.remove(oldSprite)
                  oldSprite.material.dispose()
                  v!.loadingSprite!.texture.dispose()
                  
                  const newLoading = createLoadingSprite(percent)
                  scene.add(newLoading.sprite)
                  newLoading.sprite.position.copy(oldPos)
                  v!.loadingSprite = newLoading
                }
              },
              (error) => {
                // Remove loading sprite on error
                if (v!.loadingSprite) {
                  scene.remove(v!.loadingSprite.sprite)
                  v!.loadingSprite.texture.dispose()
                  ;(v!.loadingSprite.sprite.material as THREE.Material).dispose()
                  v!.loadingSprite = null
                }
                console.error(`Failed to load remote player model for ${nameO}, using capsule:`, error)
                // Fallback to capsule on error
                const geo = new THREE.CapsuleGeometry(playerRadius, playerHeight, 8, 16)
                const mat = new THREE.MeshStandardMaterial({ color: 0xff7b1c, roughness: 0.5, metalness: 0.0 })
                const mesh = new THREE.Mesh(geo, mat)
                scene.add(mesh)
                v!.mesh = mesh
                v!.modelUrl = null
                v!.loadingProgress = 0
              }
            )
          } else {
            // Use default capsule if no model URL
            const geo = new THREE.CapsuleGeometry(playerRadius, playerHeight, 8, 16)
            const mat = new THREE.MeshStandardMaterial({ color: 0xff7b1c, roughness: 0.5, metalness: 0.0 })
            const mesh = new THREE.Mesh(geo, mat)
            scene.add(mesh)
            v.mesh = mesh
            v.modelUrl = null
          }
        }

        // Update name tag
        if (!v.nameSprite || v.name !== nameO) {
          if (v.nameSprite) {
            v.nameSprite.sprite.removeFromParent()
            ;(v.nameSprite.sprite.material as THREE.Material).dispose()
            v.nameSprite.texture.dispose()
          }
          const tag = createNameSprite(nameO)
          scene.add(tag.sprite)
          v.nameSprite = tag
          v.name = nameO
        }

        if (v.mesh) {
          v.mesh.position.set(x, y, z)
          v.mesh.rotation.y = yawO
        }
        if (v.nameSprite) {
          v.nameSprite.sprite.position.set(x, y + 1.1, z)
        }
      }

      // Cleanup players that left
      for (const [id, v] of remoteRef.current.entries()) {
        if (seen.has(id)) continue
        const mesh = v.mesh
        if (mesh) {
          mesh.removeFromParent()
          if (mesh instanceof THREE.Mesh) {
            const geo = mesh.geometry
            const mat = mesh.material
            geo.dispose()
            if (Array.isArray(mat)) {
              mat.forEach((m) => m.dispose())
            } else {
              mat.dispose()
            }
          } else if (mesh instanceof THREE.Group) {
            mesh.traverse((child) => {
              if (child instanceof THREE.Mesh) {
                child.geometry.dispose()
                if (Array.isArray(child.material)) {
                  child.material.forEach((mat) => mat.dispose())
                } else {
                  (child.material as THREE.Material).dispose()
                }
              }
            })
          }
        }
        const nameSprite = v.nameSprite
        if (nameSprite) {
          nameSprite.sprite.removeFromParent()
          const spriteMat = nameSprite.sprite.material as THREE.Material
          spriteMat.dispose()
          nameSprite.texture.dispose()
        }
        remoteRef.current.delete(id)
      }

      // Update placed items (use ref for reactive updates)
      const placedItems = placedItemsArrayRef.current
      const seenItems = new Set<string>()
      for (const item of placedItems) {
        seenItems.add(item.id)
        let mesh = placedItemsRef.current.get(item.id)
        const scale = new THREE.Vector3(item.scaleX ?? 1, item.scaleY ?? 1, item.scaleZ ?? 1)
        const color = item.color ?? 0x4aa3ff
        if (!mesh) {
          // Create mesh with scale transform
          const newMesh = createItemMesh(item.itemId, scale, color, true)
          if (newMesh) {
            scene.add(newMesh)
            newMesh.position.set(item.x, item.y, item.z)
            newMesh.rotation.y = item.rotationY ?? 0
            // Scale is already set in createItemMesh when useScaleTransform is true
            placedItemsRef.current.set(item.id, newMesh)
            mesh = newMesh
          }
        }
        if (mesh) {
          mesh.position.set(item.x, item.y, item.z)
          mesh.rotation.y = item.rotationY ?? 0
          mesh.scale.set(scale.x, scale.y, scale.z)
          if (mesh.material instanceof THREE.MeshStandardMaterial) {
            mesh.material.color.setHex(color)
          }
        }
      }
      // Cleanup removed items
      for (const [id, mesh] of placedItemsRef.current.entries()) {
        if (!seenItems.has(id)) {
          mesh.removeFromParent()
          mesh.geometry.dispose()
          ;(mesh.material as THREE.Material).dispose()
          placedItemsRef.current.delete(id)
        }
      }

      renderer.render(scene, camera)
    }
    tick()

    window.addEventListener("resize", resize)

    // Click to place objects - listen on the renderer's DOM element
    // This works even when pointer lock is active
    const handlePlaceClick = () => {
      // Don't place if clicking to request pointer lock (first click)
      // Check that pointer lock is active on our canvas
      if (!document.pointerLockElement || document.pointerLockElement !== renderer.domElement) return
      
      if (!controlsEnabledRef.current) return
      const currentItem = selectedInventoryItemRef.current
      const currentCallback = onPlaceObjectRef.current
      if (currentItem === "empty" || !currentCallback) return

      // When pointer locked, use center of screen (0, 0) for raycasting
      const mouse = new THREE.Vector2(0, 0)
      raycaster.setFromCamera(mouse, camera)
      
      // Raycast against ground and all placed items to allow stacking
      const objectsToIntersect: THREE.Object3D[] = [ground]
      for (const mesh of placedItemsRef.current.values()) {
        objectsToIntersect.push(mesh)
      }
      const intersects = raycaster.intersectObjects(objectsToIntersect, false)

      if (intersects.length > 0) {
        // Find the highest intersection point (topmost surface)
        let highestPoint = intersects[0].point
        let highestY = intersects[0].point.y
        for (const intersect of intersects) {
          if (intersect.point.y > highestY) {
            highestY = intersect.point.y
            highestPoint = intersect.point
          }
        }
        
        // Apply snap mode
        let snappedX = highestPoint.x
        let snappedZ = highestPoint.z
        const snapMode = snapModeRef.current
        if (snapMode === "edge") {
          snappedX = Math.round(highestPoint.x * 2) / 2
          snappedZ = Math.round(highestPoint.z * 2) / 2
        } else if (snapMode === "face") {
          snappedX = Math.round(highestPoint.x)
          snappedZ = Math.round(highestPoint.z)
        }
        // Place item so bottom sits on the surface (position is center, so add half height)
        const currentScale = previewScaleRef.current.clone()
        const defaultColor = 0x4aa3ff
        const itemHeight = getItemHeight(currentItem, currentScale)
        const placePos = new THREE.Vector3(snappedX, highestY + itemHeight * 0.5, snappedZ)
        currentCallback(currentItem, placePos, previewRotationRef.current, currentScale, defaultColor)
        onActionLogRef.current?.("Placed " + currentItem)
      }
    }
    clickListenerRef.current = handlePlaceClick
    renderer.domElement.addEventListener("click", handlePlaceClick)

    // Scroll wheel to rotate preview item
    const handleWheel = (e: WheelEvent) => {
      if (!document.pointerLockElement || document.pointerLockElement !== renderer.domElement) return
      if (!controlsEnabledRef.current) return
      e.preventDefault()
      const delta = e.deltaY > 0 ? -0.1 : 0.1
      previewRotationRef.current += delta
      if (previewItemRef.current) {
        previewItemRef.current.rotation.y = previewRotationRef.current
      }
    }
    renderer.domElement.addEventListener("wheel", handleWheel, { passive: false })

    // Z key to toggle snap mode, DEL to delete all items
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!controlsEnabledRef.current) return
      if (e.code === "KeyZ" && !e.repeat) {
        const modes: Array<"free" | "face" | "edge"> = ["free", "face", "edge"]
        const currentIndex = modes.indexOf(snapModeRef.current)
        snapModeRef.current = modes[(currentIndex + 1) % modes.length]
        onActionLogRef.current?.(`Snap mode: ${snapModeRef.current}`)
        // Update snap label
        if (previewSnapLabelRef.current && sceneRef.current && createSnapLabelRef.current) {
          const currentMode = snapModeRef.current
          const label = createSnapLabelRef.current(currentMode)
          if (label) {
            previewSnapLabelRef.current.removeFromParent()
            ;(previewSnapLabelRef.current.material as THREE.SpriteMaterial).map?.dispose()
            ;(previewSnapLabelRef.current.material as THREE.SpriteMaterial).dispose()
            sceneRef.current.add(label.sprite)
            label.sprite.position.copy(previewSnapLabelRef.current.position)
            label.sprite.visible = previewSnapLabelRef.current.visible
            previewSnapLabelRef.current = label.sprite
          }
        }
      } else if (e.code === "Delete" && !e.repeat) {
        // Delete all placed items
        if (onClearAllItems) {
          onClearAllItems()
          onActionLogRef.current?.("Deleted all props")
        }
      } else if (e.code === "ArrowUp" && document.pointerLockElement) {
        // Arrow Up: Make taller (increase Y scale)
        e.preventDefault()
        previewScaleRef.current.y = Math.min(5, previewScaleRef.current.y + 0.1)
        // Recreate preview item with new scale
        if (previewItemRef.current && sceneRef.current) {
          const currentItem = selectedInventoryItemRef.current
          if (currentItem !== "empty") {
            const oldPos = previewItemRef.current.position.clone()
            const oldRot = previewItemRef.current.rotation.y
            const oldVisible = previewItemRef.current.visible
            previewItemRef.current.removeFromParent()
            previewItemRef.current.geometry.dispose()
            ;(previewItemRef.current.material as THREE.MeshStandardMaterial).dispose()
            const newPreview = createItemMesh(currentItem, previewScaleRef.current.clone(), 0x4aa3ff, false)
            if (newPreview) {
              newPreview.rotation.y = oldRot
              newPreview.position.copy(oldPos)
              newPreview.visible = oldVisible
              const mat = newPreview.material as THREE.MeshStandardMaterial
              const clonedMat = mat.clone()
              clonedMat.transparent = true
              clonedMat.opacity = 0.5
              clonedMat.emissive = new THREE.Color(0x00ff00)
              clonedMat.emissiveIntensity = 0.3
              newPreview.material = clonedMat
              sceneRef.current.add(newPreview)
              previewItemRef.current = newPreview
            }
          }
        }
        onActionLogRef.current?.(`Height: ${previewScaleRef.current.y.toFixed(1)}`)
      } else if (e.code === "ArrowDown" && document.pointerLockElement) {
        // Arrow Down: Make shorter (decrease Y scale)
        e.preventDefault()
        previewScaleRef.current.y = Math.max(0.1, previewScaleRef.current.y - 0.1)
        // Recreate preview item with new scale
        if (previewItemRef.current && sceneRef.current) {
          const currentItem = selectedInventoryItemRef.current
          if (currentItem !== "empty") {
            const oldPos = previewItemRef.current.position.clone()
            const oldRot = previewItemRef.current.rotation.y
            const oldVisible = previewItemRef.current.visible
            previewItemRef.current.removeFromParent()
            previewItemRef.current.geometry.dispose()
            ;(previewItemRef.current.material as THREE.MeshStandardMaterial).dispose()
            const newPreview = createItemMesh(currentItem, previewScaleRef.current.clone(), 0x4aa3ff, false)
            if (newPreview) {
              newPreview.rotation.y = oldRot
              newPreview.position.copy(oldPos)
              newPreview.visible = oldVisible
              const mat = newPreview.material as THREE.MeshStandardMaterial
              const clonedMat = mat.clone()
              clonedMat.transparent = true
              clonedMat.opacity = 0.5
              clonedMat.emissive = new THREE.Color(0x00ff00)
              clonedMat.emissiveIntensity = 0.3
              newPreview.material = clonedMat
              sceneRef.current.add(newPreview)
              previewItemRef.current = newPreview
            }
          }
        }
        onActionLogRef.current?.(`Height: ${previewScaleRef.current.y.toFixed(1)}`)
      } else if (e.code === "ArrowRight" && document.pointerLockElement) {
        // Arrow Right: Make wider (increase X and Z scale)
        e.preventDefault()
        previewScaleRef.current.x = Math.min(5, previewScaleRef.current.x + 0.1)
        previewScaleRef.current.z = Math.min(5, previewScaleRef.current.z + 0.1)
        // Recreate preview item with new scale
        if (previewItemRef.current && sceneRef.current) {
          const currentItem = selectedInventoryItemRef.current
          if (currentItem !== "empty") {
            const oldPos = previewItemRef.current.position.clone()
            const oldRot = previewItemRef.current.rotation.y
            const oldVisible = previewItemRef.current.visible
            previewItemRef.current.removeFromParent()
            previewItemRef.current.geometry.dispose()
            ;(previewItemRef.current.material as THREE.MeshStandardMaterial).dispose()
            const newPreview = createItemMesh(currentItem, previewScaleRef.current.clone(), 0x4aa3ff, false)
            if (newPreview) {
              newPreview.rotation.y = oldRot
              newPreview.position.copy(oldPos)
              newPreview.visible = oldVisible
              const mat = newPreview.material as THREE.MeshStandardMaterial
              const clonedMat = mat.clone()
              clonedMat.transparent = true
              clonedMat.opacity = 0.5
              clonedMat.emissive = new THREE.Color(0x00ff00)
              clonedMat.emissiveIntensity = 0.3
              newPreview.material = clonedMat
              sceneRef.current.add(newPreview)
              previewItemRef.current = newPreview
            }
          }
        }
        onActionLogRef.current?.(`Width: ${previewScaleRef.current.x.toFixed(1)}`)
      } else if (e.code === "ArrowLeft" && document.pointerLockElement) {
        // Arrow Left: Make narrower (decrease X and Z scale)
        e.preventDefault()
        previewScaleRef.current.x = Math.max(0.1, previewScaleRef.current.x - 0.1)
        previewScaleRef.current.z = Math.max(0.1, previewScaleRef.current.z - 0.1)
        // Recreate preview item with new scale
        if (previewItemRef.current && sceneRef.current) {
          const currentItem = selectedInventoryItemRef.current
          if (currentItem !== "empty") {
            const oldPos = previewItemRef.current.position.clone()
            const oldRot = previewItemRef.current.rotation.y
            const oldVisible = previewItemRef.current.visible
            previewItemRef.current.removeFromParent()
            previewItemRef.current.geometry.dispose()
            ;(previewItemRef.current.material as THREE.MeshStandardMaterial).dispose()
            const newPreview = createItemMesh(currentItem, previewScaleRef.current.clone(), 0x4aa3ff, false)
            if (newPreview) {
              newPreview.rotation.y = oldRot
              newPreview.position.copy(oldPos)
              newPreview.visible = oldVisible
              const mat = newPreview.material as THREE.MeshStandardMaterial
              const clonedMat = mat.clone()
              clonedMat.transparent = true
              clonedMat.opacity = 0.5
              clonedMat.emissive = new THREE.Color(0x00ff00)
              clonedMat.emissiveIntensity = 0.3
              newPreview.material = clonedMat
              sceneRef.current.add(newPreview)
              previewItemRef.current = newPreview
            }
          }
        }
        onActionLogRef.current?.(`Width: ${previewScaleRef.current.x.toFixed(1)}`)
      }
    }
    window.addEventListener("keydown", handleKeyDown)

    return () => {
      window.removeEventListener("resize", resize)
      window.removeEventListener("keydown", handleKeyDown)
      if (rendererDomRef.current) {
        rendererDomRef.current.removeEventListener("wheel", handleWheel)
        if (clickListenerRef.current) {
          rendererDomRef.current.removeEventListener("click", clickListenerRef.current)
          clickListenerRef.current = null
        }
      }
      window.cancelAnimationFrame(raf)
      playerController.dispose()
      ground.geometry.dispose()
      gridMat.dispose()
      // Dispose player geometry/material only if it's still a capsule
      // Cleanup animations
      if (myPlayerMixerRef.current) {
        myPlayerMixerRef.current.stopAllAction()
        myPlayerMixerRef.current = null
      }
      myPlayerAnimationsRef.current = {}
      
      if (myPlayerRef.current instanceof THREE.Mesh) {
        myPlayerRef.current.geometry.dispose()
        ;(myPlayerRef.current.material as THREE.Material).dispose()
      }
      skyboxTexRef.current?.dispose()
      if (nameSpriteRef.current) {
        nameSpriteRef.current.sprite.removeFromParent()
        ;(nameSpriteRef.current.sprite.material as THREE.Material).dispose()
        nameSpriteRef.current.texture.dispose()
        nameSpriteRef.current = null
      }
      for (const [, v] of remoteRef.current) {
        const mesh = v.mesh
        if (mesh) {
          mesh.removeFromParent()
          if (mesh instanceof THREE.Mesh) {
            const geo = mesh.geometry
            const mat = mesh.material
            geo.dispose()
            if (Array.isArray(mat)) {
              mat.forEach((m) => m.dispose())
            } else {
              mat.dispose()
            }
          } else if (mesh instanceof THREE.Group) {
            mesh.traverse((child) => {
              if (child instanceof THREE.Mesh) {
                child.geometry.dispose()
                if (Array.isArray(child.material)) {
                  child.material.forEach((mat) => mat.dispose())
                } else {
                  (child.material as THREE.Material).dispose()
                }
              }
            })
          }
        }
        const nameSprite = v.nameSprite
        if (nameSprite) {
          nameSprite.sprite.removeFromParent()
          const spriteMat = nameSprite.sprite.material as THREE.Material
          spriteMat.dispose()
          nameSprite.texture.dispose()
        }
        const loadingSprite = v.loadingSprite
        if (loadingSprite) {
          loadingSprite.sprite.removeFromParent()
          const loadingMat = loadingSprite.sprite.material as THREE.Material
          loadingMat.dispose()
          loadingSprite.texture.dispose()
        }
      }
      remoteRef.current.clear()
      if (previewItemRef.current) {
        previewItemRef.current.removeFromParent()
        previewItemRef.current.geometry.dispose()
        ;(previewItemRef.current.material as THREE.Material).dispose()
        previewItemRef.current = null
      }
      groundMeshRef.current = null
      raycasterRef.current = null
      cameraRef.current = null
      renderer.dispose()
      host.removeChild(renderer.domElement)
      controllerRef.current = null
      rendererDomRef.current = null
      sceneRef.current = null
      texLoaderRef.current = null
      skyboxTexRef.current = null
      myPlayerRef.current = null
      // Cleanup placed items
      for (const [, mesh] of placedItemsRef.current.entries()) {
        mesh.removeFromParent()
        mesh.geometry.dispose()
        ;(mesh.material as THREE.Material).dispose()
      }
      placedItemsRef.current.clear()
    }
  }, []) // Only run once on mount - scene initialization

  // Separate effect for inventory items to avoid reinitializing scene
  useEffect(() => {
    const scene = sceneRef.current
    if (!scene) return

    // Update placement preview
    if (previewItemRef.current) {
      previewItemRef.current.removeFromParent()
      previewItemRef.current.geometry.dispose()
      ;(previewItemRef.current.material as THREE.Material).dispose()
      previewItemRef.current = null
    }

    // Reset scale when item changes
    previewScaleRef.current.set(1, 1, 1)
    const currentScale = previewScaleRef.current.clone()
    const defaultColor = 0x4aa3ff
    const previewItem = createItemMesh(selectedInventoryItem, currentScale, defaultColor)
    if (previewItem) {
      previewItem.rotation.y = previewRotationRef.current
      const mat = previewItem.material as THREE.MeshStandardMaterial
      const clonedMat = mat.clone()
      clonedMat.transparent = true
      clonedMat.opacity = 0.5
      clonedMat.emissive = new THREE.Color(0x00ff00)
      clonedMat.emissiveIntensity = 0.3
      previewItem.material = clonedMat
      previewItem.visible = false
      scene.add(previewItem)
      previewItemRef.current = previewItem
    }
  }, [selectedInventoryItem])

  // Update onPlaceObject callback reference
  const onPlaceObjectRef = useRef(onPlaceObject)
  useEffect(() => {
    onPlaceObjectRef.current = onPlaceObject
  }, [onPlaceObject])

  // Keep selectedInventoryItem in a ref for tick function
  const selectedInventoryItemRef = useRef(selectedInventoryItem)
  useEffect(() => {
    selectedInventoryItemRef.current = selectedInventoryItem
  }, [selectedInventoryItem])

  // Keep controlsEnabled in a ref for tick function
  const controlsEnabledRef = useRef(controlsEnabled)
  useEffect(() => {
    controlsEnabledRef.current = controlsEnabled
  }, [controlsEnabled])

  // Keep playerName in a ref for tick function
  const playerNameRef = useRef(playerName)
  useEffect(() => {
    playerNameRef.current = playerName
  }, [playerName])

  // Presence update throttling (avoid sending 60fps)
  const presenceAccumRef = useRef(0)



  return (
    <div style={{ width: "100vw", height: "100vh", position: "relative" }}>
      <div ref={hostRef} style={{ width: "100%", height: "100%" }} />
    </div>
  )
}
