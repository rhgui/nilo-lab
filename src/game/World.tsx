import { useEffect, useRef, useState } from "react"
import * as THREE from "three"
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js"
import { createGridMaterial } from "./gridMaterial"
import { PlayerController } from "./PlayerController"
import { ThirdPersonCamera } from "./ThirdPersonCamera"
import { FreeCameraController } from "./FreeCameraController"
import { useMyPresence, useOthers, useSelf, useStorage, useMutation } from "../liveblocks.config"

export type GameMode = "player" | "terrainEditor"

export type WorldProps = {
  controlsEnabled: boolean
  playerName: string
  selectedInventoryItem?: string
  selectedInventoryModelUrl?: string | null
  onPlaceObject?: (itemId: string, position: THREE.Vector3, rotationY: number, scale: THREE.Vector3, color: number, modelUrl?: string | null) => void
  onActionLog?: (label: string) => void
  onClearAllItems?: () => void
  onUiBlockingChange?: (blocking: boolean) => void
  gameMode?: GameMode
  terrainTool?: "move" | "paint" | "raise" | "lower" | "erase" | "reset" | "smooth"
  terrainColor?: number
}

const PRIMITIVE_BASE_SIZE = 0.2
const PRIMITIVE_BASE_HALF_HEIGHT = PRIMITIVE_BASE_SIZE / 2
const COMMUNITY_TARGET_MAX_DIM = 5.0

function getPrimitiveHalfHeight(scale: THREE.Vector3): number {
  return PRIMITIVE_BASE_HALF_HEIGHT * scale.y
}

function createItemMesh(itemId: string, scale: THREE.Vector3 = new THREE.Vector3(1, 1, 1), color: number = 0x4aa3ff): THREE.Mesh | null {
  if (itemId === "empty") return null

  let geometry: THREE.BufferGeometry
  if (itemId === "cube") {
    geometry = new THREE.BoxGeometry(PRIMITIVE_BASE_SIZE, PRIMITIVE_BASE_SIZE, PRIMITIVE_BASE_SIZE)
  } else if (itemId === "sphere") {
    geometry = new THREE.SphereGeometry(PRIMITIVE_BASE_HALF_HEIGHT, 16, 16)
  } else {
    return null
  }

  const material = new THREE.MeshStandardMaterial({
    color: color,
    roughness: 0.4,
    metalness: 0.0,
  })
  const mesh = new THREE.Mesh(geometry, material)
  mesh.scale.set(scale.x, scale.y, scale.z)
  return mesh
}

function buildCommunityModelTemplate(modelScene: THREE.Group): THREE.Group {
  const bbox = new THREE.Box3().setFromObject(modelScene)
  const center = bbox.getCenter(new THREE.Vector3())
  const size = bbox.getSize(new THREE.Vector3())
  const maxDim = Math.max(size.x, size.y, size.z) || 1
  const baseScale = COMMUNITY_TARGET_MAX_DIM / maxDim

  const wrapper = new THREE.Group()
  wrapper.add(modelScene)
  modelScene.position.sub(center)

  wrapper.userData.baseScale = baseScale
  wrapper.userData.halfHeight = size.y * 0.5
  wrapper.userData.isCommunityTemplate = true

  return wrapper
}

function applyPreviewMaterial(root: THREE.Object3D) {
  root.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      const mat = child.material
      if (Array.isArray(mat)) {
        child.material = mat.map((m) => {
          const cloned = (m as THREE.Material).clone() as THREE.Material & Partial<THREE.MeshStandardMaterial>
          if (cloned instanceof THREE.MeshStandardMaterial) {
            cloned.transparent = true
            cloned.opacity = 0.5
            cloned.emissive = new THREE.Color(0x00ff00)
            cloned.emissiveIntensity = 0.3
          }
          return cloned
        })
      } else if (mat instanceof THREE.MeshStandardMaterial) {
        const clonedMat = mat.clone()
        clonedMat.transparent = true
        clonedMat.opacity = 0.5
        clonedMat.emissive = new THREE.Color(0x00ff00)
        clonedMat.emissiveIntensity = 0.3
        child.material = clonedMat
      }
    }
  })
}

function setPreviewObjectTransform(args: {
  itemId: string
  object: THREE.Object3D
  surfaceY: number
  x: number
  z: number
  rotationY: number
  scale: THREE.Vector3
}) {
  const { itemId, object, surfaceY, x, z, rotationY, scale } = args

  object.rotation.y = rotationY

  if (itemId.startsWith("community-")) {
    const baseScale = (object.userData.baseScale as number | undefined) ?? 1
    const halfHeight = ((object.userData.halfHeight as number | undefined) ?? PRIMITIVE_BASE_HALF_HEIGHT) * baseScale * scale.y
    object.scale.set(baseScale * scale.x, baseScale * scale.y, baseScale * scale.z)
    object.position.set(x, surfaceY + halfHeight, z)
    return
  }

  // primitives
  const halfHeight = getPrimitiveHalfHeight(scale)
  object.scale.set(scale.x, scale.y, scale.z)
  object.position.set(x, surfaceY + halfHeight, z)
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

type RemoteVisual = {
  mesh: THREE.Mesh | THREE.Group | null
  name: string
  nameSprite: { sprite: THREE.Sprite; texture: THREE.Texture } | null
  modelUrl: string | null
  isLoading: boolean // Track loading state to prevent duplicate loads
}

export default function World({ controlsEnabled, playerName, selectedInventoryItem = "empty", selectedInventoryModelUrl, onPlaceObject, onActionLog, onClearAllItems, onUiBlockingChange: _onUiBlockingChange, gameMode = "player", terrainTool = "move", terrainColor = 0x4aa3ff }: WorldProps) {
  // Get player model URL from sessionStorage
  const playerModelUrl = typeof window !== "undefined" ? sessionStorage.getItem("playerModelUrl") : null
  
  const skyboxUrl = useStorage((root) => root.skyboxUrl) ?? ""
  const placedItemsStorage = useStorage((root) => root.placedItems)
  const savedModelsStorage = useStorage((root) => root.savedModels)
  const terrainVerticesStorage = useStorage((root) => root.terrainVertices)
  const self = useSelf()
  const currentPlayerId = self?.connectionId != null ? String(self.connectionId) : ""
  const currentPlayerIdRef = useRef<string>(currentPlayerId)
  
  useEffect(() => {
    currentPlayerIdRef.current = currentPlayerId
  }, [currentPlayerId])
  
  const updateTerrainVerticesDelta = useMutation(
    ({ storage }, delta: Array<{ vertexIndex: number; z: number; color: number | null }>, playerId: string) => {
      const terrainVertices = storage.get("terrainVertices")
      const timestamp = Date.now()
      for (const d of delta) {
        terrainVertices.set(String(d.vertexIndex), {
          z: d.z,
          color: d.color,
          timestamp,
          playerId,
        })
      }
    },
    [],
  )

  const clearTerrainVertices = useMutation(({ storage }) => {
    const terrainVertices = storage.get("terrainVertices")
    // LiveMap doesn't expose clear() in typings; delete keys instead
    for (const key of terrainVertices.keys()) {
      terrainVertices.delete(key)
    }
  }, [])
  const placedItemsRef = useRef<Map<string, THREE.Mesh | THREE.Group>>(new Map())
  const placedItemsPlaceholdersRef = useRef<Map<string, THREE.Mesh>>(new Map()) // Placeholder boxes for loading models
  const placedItemsArrayRef = useRef<Array<{ id: string; itemId: string; x: number; y: number; z: number; rotationY?: number; scaleX?: number; scaleY?: number; scaleZ?: number; color?: number; modelUrl?: string | null }>>([])
  const placedItemsModelUrlsRef = useRef<Map<string, string>>(new Map())
  const modelCacheRef = useRef<Map<string, THREE.Group>>(new Map())
  const gltfLoaderRef = useRef<GLTFLoader>(new GLTFLoader())
  const loadingQueueRef = useRef<Array<{ itemId: string; modelUrl: string; item: any; scale: THREE.Vector3 }>>([])
  const isLoadingModelRef = useRef<boolean>(false)
  const [, updateMyPresence] = useMyPresence()
  const others = useOthers()
  const othersRef = useRef(others)
  
  // Placement state
  const previewRotationRef = useRef(0)
  const previewScaleRef = useRef(new THREE.Vector3(1, 1, 1))
  const snapModeRef = useRef<"free" | "face" | "edge">("free")
  const onActionLogRef = useRef(onActionLog)
  // Placement cooldown to prevent multiple placements from single click
  const lastPlacementTimeRef = useRef<number>(0)
  const PLACEMENT_COOLDOWN_MS = 800
  const lastPreviewUpdateRef = useRef<number>(0)
  const PREVIEW_UPDATE_INTERVAL = 16
  
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
  const freeCameraControllerRef = useRef<FreeCameraController | null>(null)
  const gameModeRef = useRef<GameMode>(gameMode)
  const rendererDomRef = useRef<HTMLCanvasElement | null>(null)
  const sceneRef = useRef<THREE.Scene | null>(null)
  const skyboxTexRef = useRef<THREE.Texture | null>(null)
  const texLoaderRef = useRef<THREE.TextureLoader | null>(null)
  const nameSpriteRef = useRef<{ sprite: THREE.Sprite; texture: THREE.Texture } | null>(null)
  const remoteRef = useRef<Map<number, RemoteVisual>>(new Map())
  const myPlayerRef = useRef<THREE.Mesh | THREE.Group | null>(null)
  const groundMeshRef = useRef<THREE.Mesh | null>(null)
  const groundGeometryRef = useRef<THREE.PlaneGeometry | null>(null)
  const groundOriginalPositionsRef = useRef<Float32Array | null>(null) // Store original vertex positions for reset
  const terrainBrushCircleRef = useRef<THREE.Line | null>(null)
  const terrainBrushRadiusRef = useRef<number>(5.0) // Brush radius in world units
  const terrainToolRef = useRef(terrainTool)
  const terrainColorRef = useRef(terrainColor)
  const remoteTerrainBrushesRef = useRef<Map<number, { circle: THREE.Line; nameSprite: THREE.Sprite | null }>>(new Map()) // Remote player brush circles
  const previewItemRef = useRef<THREE.Mesh | THREE.Group | null>(null)
  const previewModelLoaderRef = useRef<GLTFLoader | null>(null)
  const previewSnapLabelRef = useRef<THREE.Sprite | null>(null)
  const previewModelUrlRef = useRef<string | null>(null) // Track which model URL the preview is using
  const raycasterRef = useRef<THREE.Raycaster | null>(null)
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null)
  const clickListenerRef = useRef<((e: MouseEvent) => void) | null>(null)
  const isTerrainEditingRef = useRef(false) // Track if mouse is down for terrain editing
  const terrainEditingVerticesRef = useRef<Set<string>>(new Set()) // Track which vertices have been modified (using string keys for brush position tracking)
  const mousePositionRef = useRef<THREE.Vector2>(new THREE.Vector2(0, 0)) // Track mouse position for raycasting
  const lastTerrainSyncTimeRef = useRef<number>(0) // Throttle terrain sync while editing
  const lastTerrainEditTimeRef = useRef<number>(0) // Track last edit time (for optional manual sync indicator)
  const modifiedTerrainVertexIndicesRef = useRef<Set<number>>(new Set()) // Vertices edited since last sync
  const lastAppliedTerrainVertexTimestampRef = useRef<Map<number, number>>(new Map()) // Per-vertex applied timestamp
  const hadAnyRemoteTerrainDeltasRef = useRef<boolean>(false) // Track if we previously had deltas (for reset)
  const fpsRef = useRef<number>(0)
  const fpsUpdateTimeRef = useRef<number>(0)


  useEffect(() => {
    othersRef.current = others
  }, [others])

  // Apply terrain deltas from storage (multiplayer sync)
  // Also ensure we apply terrain on initial load when geometry becomes available
  const terrainAppliedInitialRef = useRef<boolean>(false)
  const [geometryReady, setGeometryReady] = useState<boolean>(false)
  
  // Get storage size to watch for changes (LiveMap size changes trigger reactivity)
  const terrainVerticesSize = terrainVerticesStorage?.size ?? 0
  
  useEffect(() => {
    // Wait for both geometry and storage to be ready
    if (!terrainVerticesStorage || !groundGeometryRef.current) {
      return
    }

    const groundGeometry = groundGeometryRef.current
    const positions = groundGeometry.attributes.position
    const colors = groundGeometry.attributes.color
    const positionArray = positions.array as Float32Array
    const colorArray = colors ? (colors.array as Float32Array) : null

    // If the map was cleared (e.g., reset), restore original terrain locally.
    if (terrainVerticesStorage.size === 0) {
      if (hadAnyRemoteTerrainDeltasRef.current) {
        const originalPositions = groundOriginalPositionsRef.current
        if (originalPositions && originalPositions.length === positionArray.length) {
          for (let i = 0; i < positionArray.length; i++) {
            positionArray[i] = originalPositions[i]
          }
          positions.needsUpdate = true
        }
        if (colorArray) {
          for (let i = 0; i < colorArray.length; i += 3) {
            colorArray[i] = 0.75
            colorArray[i + 1] = 0.75
            colorArray[i + 2] = 0.75
          }
          colors!.needsUpdate = true
        }
        lastAppliedTerrainVertexTimestampRef.current.clear()
        groundGeometry.computeVertexNormals()
        terrainAppliedInitialRef.current = false // Reset flag on clear
      }
      hadAnyRemoteTerrainDeltasRef.current = false
      return
    }

    hadAnyRemoteTerrainDeltasRef.current = true

    const myPlayerId = currentPlayerIdRef.current
    let didApplyAny = false
    
    // On initial load (first time we see terrain data), apply ALL terrain vertices regardless of timestamp
    const isInitialLoad = !terrainAppliedInitialRef.current && terrainVerticesStorage.size > 0
    if (isInitialLoad) {
      console.log("[TERRAIN SYNC] Initial load detected, applying all terrain vertices")
      lastAppliedTerrainVertexTimestampRef.current.clear()
      terrainAppliedInitialRef.current = true
    }

    for (const [key, value] of terrainVerticesStorage.entries()) {
      const vertexIndex = Number(key)
      if (!Number.isFinite(vertexIndex)) continue

      const lastTs = lastAppliedTerrainVertexTimestampRef.current.get(vertexIndex) ?? 0
      // Skip if already applied (unless initial load)
      if (!isInitialLoad && value.timestamp <= lastTs) continue
      // Skip own updates
      if (value.playerId && value.playerId === myPlayerId) continue

      const base = vertexIndex * 3
      if (base + 2 >= positionArray.length) continue
      positionArray[base + 2] = value.z
      didApplyAny = true

      if (colorArray && value.color != null) {
        const r = ((value.color >> 16) & 0xff) / 255
        const g = ((value.color >> 8) & 0xff) / 255
        const b = (value.color & 0xff) / 255
        colorArray[base] = r
        colorArray[base + 1] = g
        colorArray[base + 2] = b
      }

      lastAppliedTerrainVertexTimestampRef.current.set(vertexIndex, value.timestamp)
    }

    if (didApplyAny) {
      console.log("[TERRAIN SYNC] Applied terrain updates:", { isInitialLoad, vertexCount: terrainVerticesStorage.size })
      positions.needsUpdate = true
      if (colorArray) colors!.needsUpdate = true
      groundGeometry.computeVertexNormals()
    }
  }, [terrainVerticesStorage, terrainVerticesSize, geometryReady])

  useEffect(() => {
    onActionLogRef.current = onActionLog
  }, [onActionLog])
  
  useEffect(() => {
    if (placedItemsStorage) {
      placedItemsArrayRef.current = Array.from(placedItemsStorage)
    } else {
      placedItemsArrayRef.current = []
    }
  }, [placedItemsStorage])

  useEffect(() => {
    gameModeRef.current = gameMode
    terrainToolRef.current = terrainTool
    terrainColorRef.current = terrainColor
    freeCameraControllerRef.current?.setEnabled(controlsEnabled && gameMode === "terrainEditor")
  }, [gameMode, terrainTool, terrainColor, controlsEnabled])

  useEffect(() => {
    controllerRef.current?.setEnabled(controlsEnabled && gameMode === "player")
    freeCameraControllerRef.current?.setEnabled(controlsEnabled && gameMode === "terrainEditor")

    // If UI is blocking input, ensure pointer lock is released.
    if (!controlsEnabled && document.pointerLockElement) document.exitPointerLock()
  }, [controlsEnabled, gameMode])

  // Skybox: Use scene.background with EquirectangularReflectionMapping
  // This is the standard Three.js approach for panoramas
  useEffect(() => {
    const scene = sceneRef.current
    const loader = texLoaderRef.current
    if (!scene || !loader || !skyboxUrl) {
      // Clear background if no skybox URL
      if (scene) {
        scene.background = new THREE.Color(0x0b0b0b)
      }
      return
    }

    let loadUrl = skyboxUrl
    if (skyboxUrl.includes('assets.meshy.ai')) {
      loadUrl = skyboxUrl // Load directly, no proxy
    }

    const prev = skyboxTexRef.current
    
    // Load texture and set as scene background
    const tex = loader.load(
      loadUrl,
      () => {
        // Texture loaded successfully
        if (!scene) return
        
        // Configure texture for panorama
        tex.colorSpace = THREE.SRGBColorSpace
        tex.mapping = THREE.EquirectangularReflectionMapping
        
        // Set as scene background - this provides full 360-degree coverage
        scene.background = tex
      },
      undefined,
      (error) => {
        console.error('[World] Failed to load skybox texture:', error)
        if (scene) {
          scene.background = new THREE.Color(0x0b0b0b)
        }
      }
    )
    
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
    updateMyPresence({ name: playerName })
  }, [playerName])

  useEffect(() => {
    const scene = sceneRef.current
    if (!scene) return

    // Update placement preview - recreate when item changes
    if (previewItemRef.current) {
      // Ensure it's removed from scene - check both parent and scene
      if (previewItemRef.current.parent) {
        previewItemRef.current.parent.remove(previewItemRef.current)
      }
      if (scene && scene.children.includes(previewItemRef.current)) {
        scene.remove(previewItemRef.current)
      }
      // Clean up based on type
      if (previewItemRef.current instanceof THREE.Mesh) {
        previewItemRef.current.geometry.dispose()
        const mat = previewItemRef.current.material
        if (mat instanceof THREE.Material) {
          mat.dispose()
        }
      } else if (previewItemRef.current instanceof THREE.Group) {
        // Clean up GLB model
        previewItemRef.current.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            child.geometry.dispose()
            if (Array.isArray(child.material)) {
              child.material.forEach((m) => m.dispose())
            } else {
              child.material.dispose()
            }
          }
        })
      }
      previewItemRef.current = null
    }

    // Remove old snap label
    if (previewSnapLabelRef.current) {
      previewSnapLabelRef.current.removeFromParent()
      ;(previewSnapLabelRef.current.material as THREE.SpriteMaterial).map?.dispose()
      ;(previewSnapLabelRef.current.material as THREE.SpriteMaterial).dispose()
      previewSnapLabelRef.current = null
    }

    // Reset preview scale whenever the selected inventory item changes
    previewScaleRef.current.set(1, 1, 1)
    const defaultColor = 0x4aa3ff

    // If we have a model URL for community models, load the GLB
    if (selectedInventoryModelUrl && selectedInventoryItem.startsWith("community-")) {
      // IMPORTANT: Meshy CloudFront signed URLs have two possible issues:
      // 1. CORS: Meshy doesn't send CORS headers, so direct loading fails
      // 2. IP restrictions: Some URLs (especially animation URLs) include IP in signature
      // 
      // Strategy: Try direct loading first. If CORS error (not 403), retry with proxy.
      const isMeshyUrl = selectedInventoryModelUrl.includes('assets.meshy.ai')
      const loadUrl = selectedInventoryModelUrl // Try direct loading first
      // Prefer cached template for instant preview
      const cachedTemplate = modelCacheRef.current.get(selectedInventoryModelUrl)
      if (cachedTemplate) {
        const model = cachedTemplate.clone(true)
        previewModelUrlRef.current = selectedInventoryModelUrl
        applyPreviewMaterial(model)
        model.rotation.y = previewRotationRef.current
        model.visible = false
        scene.add(model)
        previewItemRef.current = model
      } else {
        const loader = new GLTFLoader()
        previewModelLoaderRef.current = loader
        const onPreviewSuccess = (gltf: any) => {
          if (!sceneRef.current) return
          const template = buildCommunityModelTemplate(gltf.scene)
          modelCacheRef.current.set(selectedInventoryModelUrl, template)
          previewModelUrlRef.current = selectedInventoryModelUrl

          const model = template.clone(true)
          applyPreviewMaterial(model)
          model.rotation.y = previewRotationRef.current
          model.visible = false
          sceneRef.current.add(model)
          previewItemRef.current = model
        }
        
        const onPreviewError = (error: unknown) => {
          // Try proxy fallback for Meshy URLs if CORS error (not 403)
          const errorMsg = error && typeof error === 'object' && 'message' in error ? String(error.message) : "Unknown error"
          const errorMsgLower = errorMsg.toLowerCase()
          const isCorsError = errorMsgLower.includes('cors') || 
                             errorMsgLower.includes('cross-origin') ||
                             errorMsgLower.includes('access-control')
          const is403Error = errorMsg.includes('403') || errorMsg.includes('Forbidden')
          
          if (isMeshyUrl && isCorsError && !is403Error) {
            console.log("[Preview] CORS error on direct load, retrying with proxy...")
            const proxyUrl = `/api/meshy/proxy?url=${encodeURIComponent(selectedInventoryModelUrl)}`
            loader.load(
              proxyUrl,
              onPreviewSuccess,
              undefined,
              (proxyError) => {
                console.error("[Preview] Failed to load preview model via proxy:", proxyError)
              }
            )
          } else {
            console.error("[Preview] Failed to load preview model:", error)
            if (is403Error) {
              console.error("[Preview] ❌ 403 Forbidden - URL has IP restrictions and cannot be loaded")
            }
          }
        }
        
        loader.load(
          loadUrl,
          onPreviewSuccess,
          undefined,
          onPreviewError
        )
      }
    } else {
      // Use regular mesh for cube/sphere
      const previewItem = createItemMesh(selectedInventoryItem, previewScaleRef.current.clone(), defaultColor)
      if (previewItem) {
        previewItem.rotation.y = previewRotationRef.current
        applyPreviewMaterial(previewItem)
        previewItem.visible = false
        scene.add(previewItem)
        previewItemRef.current = previewItem
      }
    }

    const snapLabel = createSnapLabelRef.current?.(snapModeRef.current)
    if (snapLabel) {
      scene.add(snapLabel.sprite)
      previewSnapLabelRef.current = snapLabel.sprite
      snapLabel.sprite.visible = false
    }
  }, [selectedInventoryItem, selectedInventoryModelUrl])

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    // Basic Three.js bootstrap (renderer/scene/camera) owned by this component.
    // Keep cleanup here so hot-reloads don't leak WebGL contexts or listeners.
    // Optimized WebGL renderer for GPU performance
    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: "high-performance", // Prefer dedicated GPU
      precision: "highp", // High precision for better quality
      stencil: false, // Disable stencil buffer if not needed
      depth: true, // Enable depth buffer
      logarithmicDepthBuffer: false, // Disable for better performance
    })
    
    // GPU-optimized settings
    renderer.setClearColor(0x0b0b0b, 1)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2)) // Limit pixel ratio for performance
    renderer.shadowMap.enabled = false // Disable shadows for better performance
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.NoToneMapping // Disable tone mapping for performance
    renderer.toneMappingExposure = 1.0
    
    host.appendChild(renderer.domElement)
    rendererDomRef.current = renderer.domElement
    
    const fpsOverlay = document.createElement("div")
    fpsOverlay.id = "fps-counter"
    fpsOverlay.style.cssText = `
      position: absolute;
      bottom: 10px;
      left: 10px;
      color: rgba(255, 255, 255, 0.8);
      font-family: monospace;
      font-size: 14px;
      background: rgba(0, 0, 0, 0.5);
      padding: 4px 8px;
      border-radius: 4px;
      pointer-events: none;
      z-index: 1000;
    `
    fpsOverlay.textContent = "FPS: 0"
    host.appendChild(fpsOverlay)
    
    // Note: WebGPU support is experimental in Three.js. For now, we use optimized WebGL.
    // WebGPU can be added later when it's more stable. Current WebGL settings are optimized for GPU performance.
    console.log("[Renderer] Using optimized WebGL renderer with GPU acceleration")
    
    const scene = new THREE.Scene()
    sceneRef.current = scene

    const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 10000)
    camera.position.set(0, 2, 6)

    // Initialize texture loader
    const texLoader = new THREE.TextureLoader()
    texLoaderRef.current = texLoader
    
    scene.background = new THREE.Color(0x0b0b0b)
    scene.add(new THREE.AmbientLight(0xffffff, 0.35))
    const dir = new THREE.DirectionalLight(0xffffff, 0.65)
    dir.position.set(10, 20, 10)
    scene.add(dir)

    // Larger ground plane (100x100) with more segments for terrain editing
    const gridMat = createGridMaterial({ scale: 1.0, lineWidth: 1.0 })
    const groundGeometry = new THREE.PlaneGeometry(100, 100, 50, 50) // More segments for smoother terrain editing
    const ground = new THREE.Mesh(groundGeometry, gridMat)
    ground.rotation.x = -Math.PI / 2
    scene.add(ground)
    groundMeshRef.current = ground
    groundGeometryRef.current = groundGeometry
    
    // Store original positions for reset
    const positions = groundGeometry.attributes.position.array as Float32Array
    groundOriginalPositionsRef.current = new Float32Array(positions)
    
    // Add color attribute for painting
    const colors = new Float32Array(positions.length)
    for (let i = 0; i < colors.length; i += 3) {
      colors[i] = 0.75 // R
      colors[i + 1] = 0.75 // G
      colors[i + 2] = 0.75 // B
    }
    groundGeometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    
    // Mark geometry as ready - this will trigger terrain application useEffect
    setGeometryReady(true)
    
    // Create brush circle indicator (green outline)
    const brushCircleGeometry = new THREE.BufferGeometry()
    const brushCirclePoints: THREE.Vector3[] = []
    const brushSegments = 64
    for (let i = 0; i <= brushSegments; i++) {
      const angle = (i / brushSegments) * Math.PI * 2
      brushCirclePoints.push(new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle)))
    }
    brushCircleGeometry.setFromPoints(brushCirclePoints)
    const brushCircleMaterial = new THREE.LineBasicMaterial({ 
      color: 0x58f287, 
      linewidth: 2,
      transparent: true,
      opacity: 0.8
    })
    const brushCircle = new THREE.Line(brushCircleGeometry, brushCircleMaterial)
    // Circle is already in XZ plane (horizontal), no rotation needed
    brushCircle.visible = false
    scene.add(brushCircle)
    terrainBrushCircleRef.current = brushCircle

    // Player mesh - load GLB model if available, otherwise use capsule
    const playerRadius = 0.25
    const playerHeight = 0.85 // Half of standard height (was 1.7)
    const playerGeo = new THREE.CapsuleGeometry(playerRadius, playerHeight, 8, 16)
    // Load player color from sessionStorage, default to blue
    const playerColorHex = typeof window !== "undefined" ? (sessionStorage.getItem("playerColor") || "#4aa3ff") : "#4aa3ff"
    const playerColor = parseInt(playerColorHex.replace("#", ""), 16)
    const playerMat = new THREE.MeshStandardMaterial({ 
      color: playerColor, 
      roughness: 0.4, 
      metalness: 0.0,
      transparent: true,
      opacity: 0.4
    })
    const player = new THREE.Mesh(playerGeo, playerMat)
    player.castShadow = false
    player.receiveShadow = false
    player.position.set(0, playerRadius + playerHeight * 0.5, 0) // Capsule center is at radius + half height
    scene.add(player)
    myPlayerRef.current = player
    
    // Load GLB model if available (will replace capsule)
    if (playerModelUrl) {
      const loader = new GLTFLoader()
      // IMPORTANT: Meshy CloudFront signed URLs have two possible issues:
      // 1. CORS: Meshy doesn't send CORS headers, so direct loading fails
      // 2. IP restrictions: Some URLs (especially animation URLs) include IP in signature
      // 
      // Strategy: Try direct loading first. If CORS error (not 403), retry with proxy.
      // If 403 error, the URL has IP restrictions and cannot be loaded.
      const isMeshyUrl = playerModelUrl.includes('assets.meshy.ai')
      const loadUrl = playerModelUrl // Try direct loading first
      
      console.log("[World] Loading player model from:", loadUrl, isMeshyUrl ? "(Meshy URL - direct load)" : "")
      
      loader.load(
        loadUrl,
        (gltf) => {
          
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
          
          // Cache the player model in the community-model cache format (centered wrapper + metadata).
          // This avoids mixed cache formats and lets it be placed like any other community model.
          if (playerModelUrl) {
            const cacheScene = gltf.scene.clone(true) as THREE.Group
            const template = buildCommunityModelTemplate(cacheScene)
            modelCacheRef.current.set(playerModelUrl, template)
          }
          
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
        },
        undefined,
        (error) => {
          // Try proxy fallback for Meshy URLs if CORS error (not 403)
          const errorMsg = error && typeof error === 'object' && 'message' in error ? String(error.message) : "Unknown error"
          const errorMsgLower = errorMsg.toLowerCase()
          const isCorsError = errorMsgLower.includes('cors') || 
                             errorMsgLower.includes('cross-origin') ||
                             errorMsgLower.includes('access-control')
          const is403Error = errorMsg.includes('403') || errorMsg.includes('Forbidden')
          
          if (isMeshyUrl && isCorsError && !is403Error) {
            console.log("[World] CORS error on direct load, retrying with proxy...")
            const proxyUrl = `/api/meshy/proxy?url=${encodeURIComponent(playerModelUrl)}`
            loader.load(
              proxyUrl,
              (gltf) => {
                // Same success handler as above
                const model = gltf.scene
                const bbox = new THREE.Box3().setFromObject(model)
                const center = bbox.getCenter(new THREE.Vector3())
                const size = bbox.getSize(new THREE.Vector3())
                const height = size.y
                const scaleFactor = playerHeight / height
                model.scale.set(scaleFactor, scaleFactor, scaleFactor)
                model.rotation.y = Math.PI
                model.userData.rotationY = Math.PI
                const groundLevel = playerRadius
                const scaledMinY = bbox.min.y * scaleFactor
                model.position.set(-center.x * scaleFactor, groundLevel - scaledMinY, -center.z * scaleFactor)
                model.castShadow = false
                model.receiveShadow = false
                if (playerModelUrl) {
                  const cacheScene = gltf.scene.clone(true) as THREE.Group
                  const template = buildCommunityModelTemplate(cacheScene)
                  modelCacheRef.current.set(playerModelUrl, template)
                }
                if (myPlayerRef.current) {
                  const oldPos = myPlayerRef.current.position.clone()
                  scene.remove(myPlayerRef.current)
                  if (myPlayerRef.current instanceof THREE.Mesh) {
                    myPlayerRef.current.geometry.dispose()
                    ;(myPlayerRef.current.material as THREE.Material).dispose()
                  }
                  model.position.copy(oldPos)
                  model.rotation.y = Math.PI
                }
                scene.add(model)
                myPlayerRef.current = model as any
                console.log("Player model loaded successfully via proxy, rotation:", model.rotation.y)
              },
              undefined,
              (proxyError) => {
                console.error("Failed to load player model via proxy, keeping capsule:", proxyError)
              }
            )
          } else {
            console.error("Failed to load player model, keeping capsule:", error)
            if (is403Error) {
              console.error("[World] ❌ 403 Forbidden - URL has IP restrictions and cannot be loaded")
            }
          }
        }
      )
    }

    // Name tag - create but don't add to scene (we don't show our own name tag)
    const nameTag = createNameSprite(playerName)
    nameSpriteRef.current = nameTag
    // Don't add to scene - we only show other players' name tags

    // Create controllers based on game mode
    const playerController = new PlayerController({ 
      domElement: renderer.domElement,
      mouseSensitivity: 0.0025, // Slightly more sensitive
      moveSpeed: 22.0, // Slightly faster movement
      damping: 12.0 // Smoother stopping
    })
    playerController.setEnabled(controlsEnabled && gameMode === "player")
    controllerRef.current = playerController

    const freeCameraController = new FreeCameraController({
      camera,
      domElement: renderer.domElement,
      moveSpeed: 30.0,
      mouseSensitivity: 0.002,
      isMoveToolSelected: () => terrainToolRef.current === "move",
      isEditingToolSelected: () => {
        const tool = terrainToolRef.current
        return tool === "paint" || tool === "raise" || tool === "lower" || tool === "erase" || tool === "smooth"
      }
    })
    freeCameraController.setEnabled(controlsEnabled && gameMode === "terrainEditor")
    freeCameraControllerRef.current = freeCameraController

    const followCam = new ThirdPersonCamera({ 
      camera,
      targetOffset: new THREE.Vector3(0, 0.8, 0), // Look at head height
      distance: 6.0, // Slightly closer for better view
      height: 2.0 // Higher camera angle
    })
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

    // Helper function to apply brush effect at a specific position
    // IMPORTANT: This function ONLY affects vertices within the circular brush area at the current position
    // It does NOT interpolate or apply effects along any path
    const applyBrushEffect = (
      brushPositionWorld: THREE.Vector3, // Brush position in world space
      radius: number,
      tool: string,
      color: number,
      positionArray: Float32Array,
      colorArray: Float32Array | null,
      originalPositions: Float32Array | null,
      dt: number,
      groundMesh: THREE.Mesh, // Need the ground mesh to transform coordinates
      modifiedVertexIndices?: Set<number>
    ) => {
      // CRITICAL: The ground plane is rotated -90 degrees around X axis
      // PlaneGeometry creates a plane in XY plane (facing +Z)
      // After rotation: plane is in XZ plane (facing +Y)
      // Position array is in LOCAL space (before rotation):
      //   Local X = World X (horizontal)
      //   Local Y = World -Z (horizontal, negative)
      //   Local Z = World Y (VERTICAL/HEIGHT - this is what we modify!)
      
      // Transform brush position from world space to ground's local space
      const brushLocal = new THREE.Vector3()
      groundMesh.worldToLocal(brushLocal.copy(brushPositionWorld))
      
      // Use squared distance for performance (avoid sqrt until needed)
      const radiusSq = radius * radius
      const brushLocalX = brushLocal.x
      const brushLocalY = brushLocal.y // This is actually world -Z
      
      // Only process vertices that could possibly be within range (quick bounds check)
      for (let i = 0; i < positionArray.length; i += 3) {
        // Position array format in LOCAL space: [x, y, z, x, y, z, ...]
        // i = local X (world X, horizontal)
        // i + 1 = local Y (world -Z, horizontal)
        // i + 2 = local Z (world Y, VERTICAL HEIGHT - modify this for raise/lower!)
        const localX = positionArray[i]
        const localY = positionArray[i + 1]
        
        // Calculate distance in LOCAL XZ plane (which is world XZ plane)
        // Use local X and local Y (which maps to world X and -Z)
        const dx = localX - brushLocalX
        const dy = localY - brushLocalY
        
        // Quick bounds check - skip vertices that are definitely too far
        if (Math.abs(dx) > radius || Math.abs(dy) > radius) continue
        
        // Calculate squared distance from vertex to brush center (in horizontal plane)
        const distSq = dx * dx + dy * dy
        
        // Only apply effect if vertex is strictly inside the circle
        if (distSq < radiusSq) {
          const vertexIndex = i / 3
          // Calculate actual distance for falloff
          const dist = Math.sqrt(distSq)
          
          // Smooth falloff curve (smoothstep)
          const normalizedDist = dist / radius
          const falloff = 1 - normalizedDist
          const smoothFalloff = falloff * falloff * (3 - 2 * falloff)
          
          // Increased intensity - much stronger base strength
          const baseStrength = 8.0 // Base strength per second
          const strength = smoothFalloff * baseStrength * dt
          
          if (tool === "raise") {
            // Raise height - ONLY modify local Z coordinate (which is world Y/height)
            // Position array: [x, y, z, ...] in local space
            // i = local X (world X, horizontal) - DO NOT MODIFY
            // i+1 = local Y (world -Z, horizontal) - DO NOT MODIFY
            // i+2 = local Z (world Y, VERTICAL HEIGHT) - MODIFY THIS ONLY
            positionArray[i + 2] += strength * 3.0
            modifiedVertexIndices?.add(vertexIndex)
          } else if (tool === "lower") {
            // Lower height - ONLY modify local Z coordinate (which is world Y/height)
            // Position array: [x, y, z, ...] in local space
            // i = local X (world X, horizontal) - DO NOT MODIFY
            // i+1 = local Y (world -Z, horizontal) - DO NOT MODIFY
            // i+2 = local Z (world Y, VERTICAL HEIGHT) - MODIFY THIS ONLY
            positionArray[i + 2] -= strength * 3.0
            modifiedVertexIndices?.add(vertexIndex)
          } else if (tool === "paint" && colorArray) {
            // Paint color - only paint vertices within the circle at current position
            const r = ((color >> 16) & 0xff) / 255
            const g = ((color >> 8) & 0xff) / 255
            const b = (color & 0xff) / 255
            // Use much stronger blend for paint (paint should be very visible)
            const paintStrength = Math.min(1.0, strength * 5.0) // Paint much faster, clamp to 1.0
            // Color array format: [r, g, b, r, g, b, ...]
            colorArray[i] = THREE.MathUtils.lerp(colorArray[i], r, paintStrength)
            colorArray[i + 1] = THREE.MathUtils.lerp(colorArray[i + 1], g, paintStrength)
            colorArray[i + 2] = THREE.MathUtils.lerp(colorArray[i + 2], b, paintStrength)
            modifiedVertexIndices?.add(vertexIndex)
          } else if (tool === "smooth") {
            // Smooth tool: average height with neighboring vertices
            // PlaneGeometry creates a grid: widthSegments x heightSegments
            // For 50x50 segments, we have 51x51 vertices (segments + 1)
            const widthSegments = 50
            const heightSegments = 50
            const verticesPerRow = widthSegments + 1 // 51
            const vertexIndex = i / 3
            const gridX = Math.floor(vertexIndex % verticesPerRow)
            const gridY = Math.floor(vertexIndex / verticesPerRow)
            
            let neighborCount = 0
            let neighborSum = 0
            
            // Check 4 neighbors (up, down, left, right)
            const neighbors = [
              { x: gridX - 1, y: gridY },     // Left
              { x: gridX + 1, y: gridY },     // Right
              { x: gridX, y: gridY - 1 },     // Up
              { x: gridX, y: gridY + 1 },     // Down
            ]
            
            for (const neighbor of neighbors) {
              if (neighbor.x >= 0 && neighbor.x < verticesPerRow && neighbor.y >= 0 && neighbor.y <= heightSegments) {
                const neighborIndex = neighbor.y * verticesPerRow + neighbor.x
                const neighborArrayIndex = neighborIndex * 3
                if (neighborArrayIndex + 2 < positionArray.length) {
                  neighborSum += positionArray[neighborArrayIndex + 2] // Local Z (height)
                  neighborCount++
                }
              }
            }
            
            if (neighborCount > 0) {
              const averageHeight = neighborSum / neighborCount
              const currentHeight = positionArray[i + 2]
              // Smooth towards average height
              positionArray[i + 2] = THREE.MathUtils.lerp(currentHeight, averageHeight, strength)
              modifiedVertexIndices?.add(vertexIndex)
            }
          } else if (tool === "erase" && originalPositions) {
            // Erase: restore original position and color
            const originalLocalZ = originalPositions[i + 2] // Original local Z (height)
            positionArray[i + 2] = THREE.MathUtils.lerp(positionArray[i + 2], originalLocalZ, strength)
            if (colorArray) {
              // Restore to default gray (0.75, 0.75, 0.75)
              colorArray[i] = THREE.MathUtils.lerp(colorArray[i], 0.75, strength)
              colorArray[i + 1] = THREE.MathUtils.lerp(colorArray[i + 1], 0.75, strength)
              colorArray[i + 2] = THREE.MathUtils.lerp(colorArray[i + 2], 0.75, strength)
            }
            modifiedVertexIndices?.add(vertexIndex)
          }
        }
      }
    }

    let raf = 0
    let frameCount = 0
    const tick = () => {
      raf = window.requestAnimationFrame(tick)
      const dt = Math.min(clock.getDelta(), 0.05)
      
      // Update FPS counter (every second)
      frameCount++
      const now = performance.now()
      if (now - fpsUpdateTimeRef.current >= 1000) {
        fpsRef.current = frameCount
        frameCount = 0
        fpsUpdateTimeRef.current = now
        // Update FPS display
        const fpsOverlay = document.getElementById("fps-counter")
        if (fpsOverlay) {
          fpsOverlay.textContent = `FPS: ${fpsRef.current}`
        }
      }

      const currentGameMode = gameModeRef.current

      if (currentGameMode === "terrainEditor") {
        // Terrain editor mode: use free camera
        freeCameraControllerRef.current?.update(dt)
        
        // Terrain editing: show brush circle and handle editing
        const brushCircle = terrainBrushCircleRef.current
        const ground = groundMeshRef.current
        const groundGeometry = groundGeometryRef.current
        const raycaster = raycasterRef.current
        const camera = cameraRef.current
        const currentTool = terrainToolRef.current
        
        if (brushCircle && ground && groundGeometry && raycaster && camera) {
          // Only show brush circle for editing tools, not for move tool
          if (currentTool !== "move") {
            // Raycast from actual mouse position to ground
            raycaster.setFromCamera(mousePositionRef.current, camera)
            const intersects = raycaster.intersectObject(ground)
            
            if (intersects.length > 0) {
              const intersection = intersects[0]
              const point = intersection.point
              
              // Update brush circle position and scale
              brushCircle.position.set(point.x, point.y + 0.01, point.z) // Slightly above ground
              const radius = terrainBrushRadiusRef.current
              brushCircle.scale.set(radius, 1, radius) // Scale X and Z, keep Y at 1 (circle is in XZ plane)
              brushCircle.visible = true
              
              // Update presence with terrain brush info (throttled via presenceAccumRef)
              presenceAccumRef.current += dt
              if (presenceAccumRef.current >= 0.05) {
                presenceAccumRef.current = 0
                const playerColorHex = typeof window !== "undefined" ? (sessionStorage.getItem("playerColor") || "#4aa3ff") : "#4aa3ff"
                const playerColor = parseInt(playerColorHex.replace("#", ""), 16)
                updateMyPresence({
                  terrainMode: "terrainEditor",
                  terrainTool: currentTool,
                  terrainBrushX: point.x,
                  terrainBrushY: point.y,
                  terrainBrushZ: point.z,
                  terrainBrushRadius: radius,
                  terrainBrushColor: currentTool === "paint" ? terrainColorRef.current : undefined,
                  isTerrainEditing: isTerrainEditingRef.current,
                  playerColor: playerColor,
                })
              }
              
              // Handle terrain editing when mouse is down (but not for move tool)
              // Apply effect continuously at current brush position (circular area only)
              // IMPORTANT: Only apply at the exact current position, not along any path
              if (isTerrainEditingRef.current && terrainToolRef.current !== "move") {
                const tool = terrainToolRef.current
                const color = terrainColorRef.current
                const positions = groundGeometry.attributes.position
                const colors = groundGeometry.attributes.color
                const positionArray = positions.array as Float32Array
                const colorArray = colors ? (colors.array as Float32Array) : null
                
                // Apply brush effect ONLY at current position (point) within circular area
                // This does NOT interpolate or create lines - only affects vertices in circle at current position
                applyBrushEffect(
                  point, // Current brush position from raycast (world space) - this is the ONLY position we paint at
                  radius,
                  tool,
                  color,
                  positionArray,
                  colorArray,
                  groundOriginalPositionsRef.current,
                  dt,
                  ground, // Pass ground mesh for coordinate transformation
                  modifiedTerrainVertexIndicesRef.current
                )
                
                // Update geometry every frame while editing
                positions.needsUpdate = true
                if (colorArray) {
                  colors!.needsUpdate = true
                }
                groundGeometry.computeVertexNormals()

                const editNow = performance.now()
                lastTerrainEditTimeRef.current = editNow

                // Continuous throttled sync during editing (150ms)
                const TERRAIN_SYNC_INTERVAL = 150 // ms between syncs while editing
                if (
                  modifiedTerrainVertexIndicesRef.current.size > 0 &&
                  editNow - lastTerrainSyncTimeRef.current >= TERRAIN_SYNC_INTERVAL
                ) {
                  lastTerrainSyncTimeRef.current = editNow
                  const delta: Array<{ vertexIndex: number; z: number; color: number | null }> = []
                  for (const vertexIndex of modifiedTerrainVertexIndicesRef.current) {
                    const base = vertexIndex * 3
                    if (base + 2 >= positionArray.length) continue
                    const z = positionArray[base + 2]
                    let packedColor: number | null = null
                    if (colorArray) {
                      const r = Math.round(THREE.MathUtils.clamp(colorArray[base], 0, 1) * 255)
                      const g = Math.round(THREE.MathUtils.clamp(colorArray[base + 1], 0, 1) * 255)
                      const b = Math.round(THREE.MathUtils.clamp(colorArray[base + 2], 0, 1) * 255)
                      packedColor = (r << 16) | (g << 8) | b
                    }
                    delta.push({ vertexIndex, z, color: packedColor })
                  }
                  updateTerrainVerticesDelta(delta, currentPlayerIdRef.current)
                  modifiedTerrainVertexIndicesRef.current.clear()
                }
              }
            } else {
              brushCircle.visible = false
            }
          } else {
            // Hide brush circle for move tool
            brushCircle.visible = false
            // Clear terrain brush presence when move tool is selected
            presenceAccumRef.current += dt
            if (presenceAccumRef.current >= 0.05) {
              presenceAccumRef.current = 0
              const playerColorHex = typeof window !== "undefined" ? (sessionStorage.getItem("playerColor") || "#4aa3ff") : "#4aa3ff"
              const playerColor = parseInt(playerColorHex.replace("#", ""), 16)
              updateMyPresence({
                terrainMode: "terrainEditor",
                terrainTool: "move",
                playerColor: playerColor,
              })
            }
          }
        }
      } else {
        // Player mode: clear terrain brush presence
        presenceAccumRef.current += dt
        if (presenceAccumRef.current >= 0.05) {
          presenceAccumRef.current = 0
          const playerColorHex = typeof window !== "undefined" ? (sessionStorage.getItem("playerColor") || "#4aa3ff") : "#4aa3ff"
          const playerColor = parseInt(playerColorHex.replace("#", ""), 16)
          updateMyPresence({
            terrainMode: "player",
            playerColor: playerColor,
          })
        }
        // Player mode: use player controller
        // Simple controller with gravity (no physics)
        const player = myPlayerRef.current
        if (!player) return
        
        // Raycast from player position to get actual terrain height
        const ground = groundMeshRef.current
        const raycaster = raycasterRef.current
        let groundY = playerRadius + playerHeight * 0.5 // Default ground Y (capsule center)
        
        if (ground && raycaster) {
          // Cast ray straight down from player position
          const rayOrigin = new THREE.Vector3(player.position.x, player.position.y + 10, player.position.z)
          const rayDirection = new THREE.Vector3(0, -1, 0)
          raycaster.set(rayOrigin, rayDirection)
          const intersects = raycaster.intersectObject(ground)
          
          if (intersects.length > 0) {
            const intersection = intersects[0]
            // Ground height is at intersection point, player capsule center should be at ground + half height
            groundY = intersection.point.y + playerHeight * 0.5
          }
        }
        
        const isGrounded = Math.abs(player.position.y - groundY) < 0.15
        
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

        // Clamp player to 100x100 ground ([-50,50] in x and z)
        const half = 50 - playerRadius * 0.75
        player.position.x = THREE.MathUtils.clamp(player.position.x, -half, half)
        player.position.z = THREE.MathUtils.clamp(player.position.z, -half, half)

        // Keep player centered in view
        followCam.update(player, playerController.getYaw(), playerController.getPitch())
        
        // Skybox is handled by scene.background, no position updates needed
        
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
      }
      
      // Don't update our own name tag position - we don't show it

      // Update placement preview with raycasting (only in player mode)
      // Use ref to get current selectedInventoryItem without adding to deps
      const currentSelectedItem = selectedInventoryItemRef.current
      
      if (gameModeRef.current === "player" && previewItemRef.current && currentSelectedItem !== "empty" && document.pointerLockElement === renderer.domElement) {
        // Throttle preview updates to reduce flashing - update less frequently
        const now = performance.now()
        if (now - lastPreviewUpdateRef.current < PREVIEW_UPDATE_INTERVAL) {
          // Skip this frame - preview stays in its last position (no flashing)
          return
        }
        lastPreviewUpdateRef.current = now
        
        const mouse = new THREE.Vector2(0, 0)
        raycaster.setFromCamera(mouse, camera)
        
        // Optimize: Limit to checking the nearest items for performance
        // This prevents lag when there are many placed objects
        const objectsToIntersect: THREE.Object3D[] = [ground]
        const placedItemsArray = Array.from(placedItemsRef.current.values())
        
        // Only check the 30 nearest items for performance (reduced from all items)
        // Sort by distance from camera to prioritize nearby objects
        if (placedItemsArray.length > 0) {
          const cameraPos = camera.position
          const sortedItems = placedItemsArray
            .map(mesh => ({
              mesh,
              distance: mesh.position.distanceToSquared(cameraPos)
            }))
            .sort((a, b) => a.distance - b.distance)
            .slice(0, 30) // Only check 30 nearest items for better performance
            .map(item => item.mesh)
          
          objectsToIntersect.push(...sortedItems)
        }
        
        // Recursive so we can stack/place on top of community models (Groups)
        const intersects = raycaster.intersectObjects(objectsToIntersect, true)

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
          const currentScale = previewScaleRef.current
          setPreviewObjectTransform({
            itemId: currentSelectedItem,
            object: previewItemRef.current,
            surfaceY: highestY,
            x: snappedX,
            z: snappedZ,
            rotationY: previewRotationRef.current,
            scale: currentScale,
          })
          previewItemRef.current.visible = true
          
          // Update snap label position - always show it above the preview block
          const baseScale = (previewItemRef.current.userData.baseScale as number | undefined) ?? 1
          const baseHalfHeight =
            currentSelectedItem.startsWith("community-")
              ? ((previewItemRef.current.userData.halfHeight as number | undefined) ?? PRIMITIVE_BASE_HALF_HEIGHT) * baseScale
              : PRIMITIVE_BASE_HALF_HEIGHT
          const worldHeight = 2 * baseHalfHeight * currentScale.y
          const labelY = highestY + worldHeight + 0.5

          if (!previewSnapLabelRef.current) {
            const label = createSnapLabelRef.current?.(snapModeRef.current)
            if (label) {
              scene.add(label.sprite)
              previewSnapLabelRef.current = label.sprite
            }
          }
          if (previewSnapLabelRef.current) {
            previewSnapLabelRef.current.position.set(snappedX, labelY, snappedZ)
            previewSnapLabelRef.current.visible = true
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
        // Removed console.log spam - this is normal when pointer isn't locked or no intersection
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
          const playerColorHex = typeof window !== "undefined" ? (sessionStorage.getItem("playerColor") || "#4aa3ff") : "#4aa3ff"
          const playerColor = parseInt(playerColorHex.replace("#", ""), 16)
          updateMyPresence({
            x: player.position.x,
            y: player.position.y,
            z: player.position.z,
            yaw,
            pitch,
            name: playerNameRef.current,
            modelUrl: playerModelUrl || null,
            playerColor: playerColor,
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
          v = { mesh: null as any, name: nameO, nameSprite: null as any, modelUrl: null, isLoading: false }
          remoteRef.current.set(id, v)
        }
        if (!v) return // Type guard

        // Update model if URL changed or not yet loaded (but only if not already loading)
        if ((modelUrlO !== v.modelUrl || !v.mesh) && !v.isLoading) {
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
            // Mark as loading to prevent duplicate loads
            v.isLoading = true
            
            // Load remote player's custom model
            const loader = new GLTFLoader()
            // IMPORTANT: Meshy CloudFront signed URLs have two possible issues:
            // 1. CORS: Meshy doesn't send CORS headers, so direct loading fails
            // 2. IP restrictions: Some URLs (especially animation URLs) include IP in signature
            // 
            // Strategy: Try direct loading first. If CORS error (not 403), retry with proxy.
            const isMeshyUrl = modelUrlO.includes('assets.meshy.ai')
            const loadUrl = modelUrlO // Try direct loading first
            const onRemoteModelSuccess = (gltf: any) => {
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
              v!.isLoading = false // Mark as done loading
            }
            
            const onRemoteModelError = (error: unknown) => {
              // Try proxy fallback for Meshy URLs if CORS error (not 403)
              const errorMsg = error && typeof error === 'object' && 'message' in error ? String(error.message) : "Unknown error"
              const errorMsgLower = errorMsg.toLowerCase()
              const isCorsError = errorMsgLower.includes('cors') || 
                                 errorMsgLower.includes('cross-origin') ||
                                 errorMsgLower.includes('access-control')
              const is403Error = errorMsg.includes('403') || errorMsg.includes('Forbidden')
              
              if (isMeshyUrl && isCorsError && !is403Error) {
                console.log(`[World] CORS error loading remote player model for ${nameO}, retrying with proxy...`)
                const proxyUrl = `/api/meshy/proxy?url=${encodeURIComponent(modelUrlO)}`
                loader.load(
                  proxyUrl,
                  onRemoteModelSuccess,
                  undefined,
                  (proxyError) => {
                    console.error(`Failed to load remote player model for ${nameO} via proxy, using capsule:`, proxyError)
                    // Fallback to capsule
                    const geo = new THREE.CapsuleGeometry(playerRadius, playerHeight, 8, 16)
                    const remotePlayerColor = typeof p?.playerColor === "number" ? p.playerColor : 0xff7b1c
                    const mat = new THREE.MeshStandardMaterial({ color: remotePlayerColor, roughness: 0.5, metalness: 0.0 })
                    const mesh = new THREE.Mesh(geo, mat)
                    scene.add(mesh)
                    v!.mesh = mesh
                    v!.modelUrl = null
                    v!.isLoading = false
                  }
                )
              } else {
                console.error(`Failed to load remote player model for ${nameO}, using capsule:`, error)
                if (is403Error) {
                  console.error(`[World] ❌ 403 Forbidden - URL has IP restrictions and cannot be loaded`)
                }
                // Fallback to capsule on error - use playerColor from presence
                const geo = new THREE.CapsuleGeometry(playerRadius, playerHeight, 8, 16)
                const remotePlayerColor = typeof p?.playerColor === "number" ? p.playerColor : 0xff7b1c
                const mat = new THREE.MeshStandardMaterial({ color: remotePlayerColor, roughness: 0.5, metalness: 0.0 })
                const mesh = new THREE.Mesh(geo, mat)
                scene.add(mesh)
                v!.mesh = mesh
                v!.modelUrl = null
                v!.isLoading = false // Mark as done loading (even on error)
              }
            }
            
            loader.load(
              loadUrl,
              onRemoteModelSuccess,
              undefined,
              onRemoteModelError
            )
          } else {
            // Use default capsule if no model URL - use playerColor from presence
            const geo = new THREE.CapsuleGeometry(playerRadius, playerHeight, 8, 16)
            const remotePlayerColor = typeof p?.playerColor === "number" ? p.playerColor : 0xff7b1c
            const mat = new THREE.MeshStandardMaterial({ color: remotePlayerColor, roughness: 0.5, metalness: 0.0 })
            const mesh = new THREE.Mesh(geo, mat)
            mesh.userData.rotationY = 0 // Capsules don't need base rotation offset
            scene.add(mesh)
            v.mesh = mesh
            v.modelUrl = null
            v.isLoading = false // No loading needed for capsule
          }
        }
        
        // Update remote player capsule color if it changed (for default capsules only)
        if (v.mesh instanceof THREE.Mesh && !v.modelUrl) {
          const remotePlayerColor = typeof p?.playerColor === "number" ? p.playerColor : 0xff7b1c
          const mat = v.mesh.material as THREE.MeshStandardMaterial
          if (mat.color.getHex() !== remotePlayerColor) {
            mat.color.setHex(remotePlayerColor)
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
          // Remote models have a base rotation of Math.PI (180 degrees) applied when loaded.
          // This base rotation is stored in userData.rotationY. We need to add it to the yaw
          // so that the remote player's facing direction matches the local player's.
          // When yawO = 0, both should face the same direction.
          const baseRotation = v.mesh.userData?.rotationY ?? 0
          v.mesh.rotation.y = yawO + baseRotation
        }
        if (v.nameSprite) {
          v.nameSprite.sprite.position.set(x, y + 1.1, z)
        }
        
        // Handle remote terrain brushes (only show when in terrain editor mode)
        if (gameModeRef.current === "terrainEditor") {
          const terrainMode = p?.terrainMode
          const terrainToolO = p?.terrainTool
          const brushX = p?.terrainBrushX
          const brushY = p?.terrainBrushY
          const brushZ = p?.terrainBrushZ
          const brushRadius = p?.terrainBrushRadius
          const brushColor = p?.terrainBrushColor
          
          if (terrainMode === "terrainEditor" && terrainToolO && terrainToolO !== "move" && 
              typeof brushX === "number" && typeof brushY === "number" && typeof brushZ === "number" && 
              typeof brushRadius === "number") {
            let brushData = remoteTerrainBrushesRef.current.get(id)
            if (!brushData) {
              // Create brush circle for this remote player
              const brushCircleGeometry = new THREE.BufferGeometry()
              const segments = 64
              const vertices = new Float32Array((segments + 1) * 3)
              for (let i = 0; i <= segments; i++) {
                const angle = (i / segments) * Math.PI * 2
                vertices[i * 3] = Math.cos(angle)
                vertices[i * 3 + 1] = 0
                vertices[i * 3 + 2] = Math.sin(angle)
              }
              brushCircleGeometry.setAttribute("position", new THREE.BufferAttribute(vertices, 3))
              
              // Determine brush color based on tool
              let brushCircleColor = 0xffffff
              if (terrainToolO === "paint" && typeof brushColor === "number") {
                brushCircleColor = brushColor
              } else if (terrainToolO === "raise") {
                brushCircleColor = 0x58f287 // Green
              } else if (terrainToolO === "lower") {
                brushCircleColor = 0xff6b6b // Red
              } else if (terrainToolO === "smooth") {
                brushCircleColor = 0x4aa3ff // Blue
              } else if (terrainToolO === "erase") {
                brushCircleColor = 0xffd93d // Yellow
              }
              
              const brushCircleMaterial = new THREE.LineBasicMaterial({
                color: brushCircleColor,
                transparent: true,
                opacity: 0.4, // Less opacity for remote brushes
                linewidth: 2
              })
              const brushCircle = new THREE.Line(brushCircleGeometry, brushCircleMaterial)
              brushCircle.visible = true
              scene.add(brushCircle)
              
              // Create name sprite for brush
              const brushNameSprite = createNameSprite(nameO)
              scene.add(brushNameSprite.sprite)
              
              brushData = { circle: brushCircle, nameSprite: brushNameSprite.sprite }
              remoteTerrainBrushesRef.current.set(id, brushData)
            }
            
            // Update brush circle position and scale
            brushData.circle.position.set(brushX, brushY + 0.01, brushZ)
            brushData.circle.scale.set(brushRadius, 1, brushRadius)
            brushData.circle.visible = true
            
            // Update brush name sprite position
            if (brushData.nameSprite) {
              brushData.nameSprite.position.set(brushX, brushY + 0.5, brushZ)
              brushData.nameSprite.visible = true
            }
            
            // Update brush color if paint tool
            if (terrainToolO === "paint" && typeof brushColor === "number") {
              const mat = brushData.circle.material as THREE.LineBasicMaterial
              mat.color.setHex(brushColor)
            }
          } else {
            // Hide brush if not editing or move tool
            const brushData = remoteTerrainBrushesRef.current.get(id)
            if (brushData) {
              brushData.circle.visible = false
              if (brushData.nameSprite) {
                brushData.nameSprite.visible = false
              }
            }
          }
        } else {
          // Hide all remote brushes when not in terrain editor mode
          for (const brushData of remoteTerrainBrushesRef.current.values()) {
            brushData.circle.visible = false
            if (brushData.nameSprite) {
              brushData.nameSprite.visible = false
            }
          }
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
        
        // Cleanup remote terrain brush
        const brushData = remoteTerrainBrushesRef.current.get(id)
        if (brushData) {
          brushData.circle.removeFromParent()
          brushData.circle.geometry.dispose()
          ;(brushData.circle.material as THREE.Material).dispose()
          if (brushData.nameSprite) {
            brushData.nameSprite.removeFromParent()
            ;(brushData.nameSprite.material as THREE.Material).dispose()
            const brushNameTex = (brushData.nameSprite.userData as any)?.texture as THREE.Texture | undefined
            if (brushNameTex) brushNameTex.dispose()
          }
          remoteTerrainBrushesRef.current.delete(id)
        }
        
        remoteRef.current.delete(id)
      }

      // Update placed items (use ref for reactive updates)
      const placedItems = placedItemsArrayRef.current
      // Performance: Limit number of placed items to prevent crashes
      const MAX_PLACED_ITEMS = 100
      const itemsToProcess = placedItems.slice(0, MAX_PLACED_ITEMS)
      const seenItems = new Set<string>()
      for (const item of itemsToProcess) {
        seenItems.add(item.id)
        let mesh = placedItemsRef.current.get(item.id)
        const scale = new THREE.Vector3(item.scaleX ?? 1, item.scaleY ?? 1, item.scaleZ ?? 1)
        const color = item.color ?? 0x4aa3ff
        if (!mesh) {
          // Check if this is a community model
          if (item.itemId.startsWith("community-") && item.modelUrl) {
            // Check cache first
            const modelUrl = item.modelUrl
            const cachedModel = modelCacheRef.current.get(modelUrl)
            
            if (cachedModel) {
              // Use cached model - instant placement
              const model = cachedModel.clone(true)

              const baseScale = (model.userData.baseScale as number | undefined) ?? 1
              const halfHeight =
                ((model.userData.halfHeight as number | undefined) ?? PRIMITIVE_BASE_HALF_HEIGHT) * baseScale * scale.y

              model.scale.set(baseScale * scale.x, baseScale * scale.y, baseScale * scale.z)
              model.position.set(item.x, item.y + halfHeight, item.z)
              model.rotation.y = item.rotationY ?? 0
              
              scene.add(model)
              placedItemsRef.current.set(item.id, model)
              placedItemsModelUrlsRef.current.set(item.id, modelUrl)
              
              // Remove loading placeholder and text if it exists (for cached models)
              const placeholder = placedItemsPlaceholdersRef.current.get(item.id)
              if (placeholder) {
                scene.remove(placeholder)
                placeholder.geometry.dispose()
                const mat = placeholder.material as THREE.Material
                mat.dispose()
                placedItemsPlaceholdersRef.current.delete(item.id)
                
                // Remove loading text
                const loadingText = placeholder.userData.loadingText as { sprite: THREE.Sprite; texture: THREE.Texture } | undefined
                if (loadingText) {
                  scene.remove(loadingText.sprite)
                  loadingText.texture.dispose()
                  const spriteMat = loadingText.sprite.material as THREE.Material
                  spriteMat.dispose()
                }
              }
            } else {
              // Create loading placeholder for ALL items (both currently loading and queued)
              // This ensures users can see where all objects will be placed
              // Only create if one doesn't already exist
              if (!placedItemsPlaceholdersRef.current.has(item.id)) {
                const placeholderGeometry = new THREE.BoxGeometry(1, 1, 1)
                const placeholderMaterial = new THREE.MeshStandardMaterial({
                  color: 0x4aa3ff,
                  transparent: true,
                  opacity: 0.3,
                  emissive: 0x4aa3ff,
                  emissiveIntensity: 0.2
                })
                const placeholderBox = new THREE.Mesh(placeholderGeometry, placeholderMaterial)
                
                // Position placeholder at item location
                const halfHeight = PRIMITIVE_BASE_HALF_HEIGHT * scale.y
                placeholderBox.position.set(item.x, item.y + halfHeight, item.z)
                placeholderBox.scale.set(scale.x, scale.y, scale.z)
                scene.add(placeholderBox)
                placedItemsPlaceholdersRef.current.set(item.id, placeholderBox)
                
                // Create "Loading object" text sprite
                const loadingText = createNameSprite("Loading object")
                loadingText.sprite.position.set(item.x, item.y + halfHeight * 2 + 0.5, item.z)
                scene.add(loadingText.sprite)
                placeholderBox.userData.loadingText = loadingText
              }
              
              // Check if we're already loading a model - if so, queue this one
              if (isLoadingModelRef.current) {
                // Add to queue (placeholder already created above)
                loadingQueueRef.current.push({
                  itemId: item.id,
                  modelUrl: modelUrl,
                  item: item,
                  scale: scale.clone()
                })
                continue // Skip to next item
              }
              
              // Mark as loading
              isLoadingModelRef.current = true
              
              // Load GLB model for community items
              // IMPORTANT: Meshy CloudFront signed URLs have two possible issues:
              // 1. CORS: Meshy doesn't send CORS headers, so direct loading fails
              // 2. IP restrictions: Some URLs (especially animation URLs) include IP in signature
              // 
              // Strategy: Try direct loading first. If CORS error (not 403), retry with proxy.
              const isMeshyUrl = modelUrl.includes('assets.meshy.ai')
              const loadUrl = modelUrl // Try direct loading first
              
              const onPlacedItemSuccess = (gltf: any) => {
                if (!sceneRef.current) return
                
                // Optimize textures to reduce memory usage
                gltf.scene.traverse((child: THREE.Object3D) => {
                  if (child instanceof THREE.Mesh) {
                    const material = child.material
                    if (material instanceof THREE.MeshStandardMaterial) {
                      // Limit texture resolution to prevent memory issues
                        if (material.map && material.map.image) {
                          material.map.minFilter = THREE.LinearFilter
                          material.map.magFilter = THREE.LinearFilter
                          const img = material.map.image
                          if (img && typeof img === 'object' && 'width' in img && 'height' in img) {
                            const maxSize = 1024 // Limit to 1024x1024
                            if ((img as any).width > maxSize || (img as any).height > maxSize) {
                              // Texture will be downscaled by GPU, but we can set max size
                              material.map.generateMipmaps = false
                            }
                          }
                        }
                      }
                    }
                  })
                  
                  const template = buildCommunityModelTemplate(gltf.scene)
                  modelCacheRef.current.set(modelUrl, template)

                  const model = template.clone(true)
                  const baseScale = (model.userData.baseScale as number | undefined) ?? 1
                  const halfHeight =
                    ((model.userData.halfHeight as number | undefined) ?? PRIMITIVE_BASE_HALF_HEIGHT) * baseScale * scale.y

                  model.scale.set(baseScale * scale.x, baseScale * scale.y, baseScale * scale.z)
                  model.position.set(item.x, item.y + halfHeight, item.z)
                  model.rotation.y = item.rotationY ?? 0
                  
                  sceneRef.current.add(model)
                  placedItemsRef.current.set(item.id, model)
                  placedItemsModelUrlsRef.current.set(item.id, modelUrl)
                  
                  // Remove loading placeholder and text
                  const placeholder = placedItemsPlaceholdersRef.current.get(item.id)
                  if (placeholder) {
                    sceneRef.current.remove(placeholder)
                    placeholder.geometry.dispose()
                    const mat = placeholder.material as THREE.Material
                    mat.dispose()
                    placedItemsPlaceholdersRef.current.delete(item.id)
                    
                    // Remove loading text
                    const loadingText = placeholder.userData.loadingText as { sprite: THREE.Sprite; texture: THREE.Texture } | undefined
                    if (loadingText) {
                      sceneRef.current.remove(loadingText.sprite)
                      loadingText.texture.dispose()
                      const spriteMat = loadingText.sprite.material as THREE.Material
                      spriteMat.dispose()
                    }
                  }
                  
                  // Mark as done loading and process next in queue
                  isLoadingModelRef.current = false
                  // Process next item in queue if any
                  if (loadingQueueRef.current.length > 0) {
                    const nextItem = loadingQueueRef.current.shift()
                    if (nextItem && sceneRef.current) {
                      // Trigger a re-render by adding the item back to the processing loop
                      // The tick loop will pick it up on the next frame
                      setTimeout(() => {
                        // Force a re-check by updating the array ref
                        placedItemsArrayRef.current = [...placedItemsArrayRef.current]
                      }, 0)
                    }
                  }
                }
              
              const onPlacedItemError = (error: unknown) => {
                // Try proxy fallback for Meshy URLs if CORS error (not 403)
                const errorMsg = error && typeof error === 'object' && 'message' in error ? String(error.message) : "Unknown error"
                const errorMsgLower = errorMsg.toLowerCase()
                const isCorsError = errorMsgLower.includes('cors') || 
                                   errorMsgLower.includes('cross-origin') ||
                                   errorMsgLower.includes('access-control')
                const is403Error = errorMsg.includes('403') || errorMsg.includes('Forbidden')
                
                if (isMeshyUrl && isCorsError && !is403Error) {
                  console.log("[World] CORS error loading placed item, retrying with proxy...")
                  const proxyUrl = `/api/meshy/proxy?url=${encodeURIComponent(modelUrl)}`
                  gltfLoaderRef.current.load(
                    proxyUrl,
                    onPlacedItemSuccess,
                    undefined,
                    (proxyError) => {
                      console.error("Failed to load placed community model via proxy:", proxyError)
                      
                      // Remove loading placeholder and text on error
                      const placeholder = placedItemsPlaceholdersRef.current.get(item.id)
                      if (placeholder && sceneRef.current) {
                        sceneRef.current.remove(placeholder)
                        placeholder.geometry.dispose()
                        const mat = placeholder.material as THREE.Material
                        mat.dispose()
                        placedItemsPlaceholdersRef.current.delete(item.id)
                        
                        // Remove loading text
                        const loadingText = placeholder.userData.loadingText as { sprite: THREE.Sprite; texture: THREE.Texture } | undefined
                        if (loadingText) {
                          sceneRef.current.remove(loadingText.sprite)
                          loadingText.texture.dispose()
                          const spriteMat = loadingText.sprite.material as THREE.Material
                          spriteMat.dispose()
                        }
                      }
                      
                      // Mark as done loading and process next in queue
                      isLoadingModelRef.current = false
                      if (loadingQueueRef.current.length > 0) {
                        const nextItem = loadingQueueRef.current.shift()
                        if (nextItem && sceneRef.current) {
                          setTimeout(() => {
                            placedItemsArrayRef.current = [...placedItemsArrayRef.current]
                          }, 0)
                        }
                      }
                    }
                  )
                } else {
                  console.error("Failed to load placed community model:", error)
                  if (is403Error) {
                    console.error("[World] ❌ 403 Forbidden - URL has IP restrictions and cannot be loaded")
                  }
                  
                  // Remove loading placeholder and text on error
                  const placeholder = placedItemsPlaceholdersRef.current.get(item.id)
                  if (placeholder && sceneRef.current) {
                    sceneRef.current.remove(placeholder)
                    placeholder.geometry.dispose()
                    const mat = placeholder.material as THREE.Material
                    mat.dispose()
                    placedItemsPlaceholdersRef.current.delete(item.id)
                    
                    // Remove loading text
                    const loadingText = placeholder.userData.loadingText as { sprite: THREE.Sprite; texture: THREE.Texture } | undefined
                    if (loadingText) {
                      sceneRef.current.remove(loadingText.sprite)
                      loadingText.texture.dispose()
                      const spriteMat = loadingText.sprite.material as THREE.Material
                      spriteMat.dispose()
                    }
                  }
                  
                  // Mark as done loading and process next in queue
                  isLoadingModelRef.current = false
                  // Process next item in queue if any
                  if (loadingQueueRef.current.length > 0) {
                    const nextItem = loadingQueueRef.current.shift()
                    if (nextItem && sceneRef.current) {
                      // Trigger a re-render
                      setTimeout(() => {
                        placedItemsArrayRef.current = [...placedItemsArrayRef.current]
                      }, 0)
                    }
                  }
                }
              }
              
              gltfLoaderRef.current.load(
                loadUrl,
                onPlacedItemSuccess,
                undefined,
                onPlacedItemError
              )
            }
          } else {
            // Create mesh with scale transform for regular items
            const newMesh = createItemMesh(item.itemId, scale, color)
            if (newMesh) {
              scene.add(newMesh)
              // item.y is the surface Y. Place primitive so bottom sits on that surface.
              const halfHeight = getPrimitiveHalfHeight(scale)
              newMesh.position.set(item.x, item.y + halfHeight, item.z)
              newMesh.rotation.y = item.rotationY ?? 0
              placedItemsRef.current.set(item.id, newMesh)
              mesh = newMesh
            }
          }
        }
        if (mesh) {
          mesh.rotation.y = item.rotationY ?? 0
          // For community models, scale is already applied during load
          // For regular meshes, update scale and position
          if (mesh instanceof THREE.Mesh) {
            // item.y is the surface Y. Place primitive so bottom sits on that surface.
            const halfHeight = getPrimitiveHalfHeight(scale)
            mesh.position.set(item.x, item.y + halfHeight, item.z)
            mesh.scale.set(scale.x, scale.y, scale.z)
            if (mesh.material instanceof THREE.MeshStandardMaterial) {
              mesh.material.color.setHex(color)
            }
          } else if (mesh instanceof THREE.Group && item.modelUrl) {
            // Update scale and position for community models
            const storedUrl = placedItemsModelUrlsRef.current.get(item.id)
            if (storedUrl === item.modelUrl) {
              const baseScale = (mesh.userData.baseScale as number | undefined) ?? 1
              const halfHeight = ((mesh.userData.halfHeight as number | undefined) ?? PRIMITIVE_BASE_HALF_HEIGHT) * baseScale * scale.y
              mesh.scale.set(baseScale * scale.x, baseScale * scale.y, baseScale * scale.z)
              mesh.position.set(item.x, item.y + halfHeight, item.z)
            }
          }
        }
      }
      // Cleanup removed items
      for (const [id, mesh] of placedItemsRef.current.entries()) {
        if (!seenItems.has(id)) {
          mesh.removeFromParent()
          if (mesh instanceof THREE.Mesh) {
            mesh.geometry.dispose()
            const mat = mesh.material
            if (mat instanceof THREE.Material) {
              mat.dispose()
            }
          } else if (mesh instanceof THREE.Group) {
            mesh.traverse((child) => {
              if (child instanceof THREE.Mesh) {
                child.geometry.dispose()
                const mat = child.material
                if (Array.isArray(mat)) {
                  mat.forEach((m) => {
                    if (m instanceof THREE.MeshStandardMaterial) {
                      // Dispose textures
                      if (m.map) m.map.dispose()
                      if (m.normalMap) m.normalMap.dispose()
                      if (m.roughnessMap) m.roughnessMap.dispose()
                      if (m.metalnessMap) m.metalnessMap.dispose()
                    }
                    m.dispose()
                  })
                } else if (mat instanceof THREE.MeshStandardMaterial) {
                  // Dispose textures
                  if (mat.map) mat.map.dispose()
                  if (mat.normalMap) mat.normalMap.dispose()
                  if (mat.roughnessMap) mat.roughnessMap.dispose()
                  if (mat.metalnessMap) mat.metalnessMap.dispose()
                  mat.dispose()
                } else {
                  mat.dispose()
                }
              }
            })
          }
          placedItemsRef.current.delete(id)
          placedItemsModelUrlsRef.current.delete(id)
        }
      }
      // Cleanup removed placeholders - remove placeholders for items that no longer exist
      for (const [id, placeholder] of placedItemsPlaceholdersRef.current.entries()) {
        if (!seenItems.has(id)) {
          // Item was removed, clean up its placeholder
          if (placeholder.parent) {
            placeholder.removeFromParent()
          }
          placeholder.geometry.dispose()
          const mat = placeholder.material
          if (Array.isArray(mat)) {
            mat.forEach((m) => m.dispose())
          } else {
            mat.dispose()
          }
          
          // Also remove loading text if it exists
          const loadingText = placeholder.userData.loadingText as { sprite: THREE.Sprite; texture: THREE.Texture } | undefined
          if (loadingText) {
            if (loadingText.sprite.parent) {
              loadingText.sprite.removeFromParent()
            }
            loadingText.texture.dispose()
            const spriteMat = loadingText.sprite.material as THREE.Material
            spriteMat.dispose()
          }
          
          placedItemsPlaceholdersRef.current.delete(id)
        }
      }

      // Performance: Only render if scene is ready
      if (scene && camera && renderer) {
        renderer.render(scene, camera)
      }
    }
    tick()

    window.addEventListener("resize", resize)

    // Click to place objects - listen on the renderer's DOM element
    // This works even when pointer lock is active
    const handlePlaceClick = (e: MouseEvent) => {
      // Prevent event propagation to avoid multiple triggers
      e.stopPropagation()
      e.preventDefault()
      
      // Cooldown check - prevent rapid multiple placements
      const now = Date.now()
      if (now - lastPlacementTimeRef.current < PLACEMENT_COOLDOWN_MS) {
        console.log("[Place] Click ignored - cooldown active")
        return
      }
      
      // Don't place if clicking to request pointer lock (first click)
      // Check that pointer lock is active on our canvas
      if (!document.pointerLockElement || document.pointerLockElement !== renderer.domElement) {
        console.log("[Place] Click ignored - no pointer lock")
        return
      }
      
      if (!controlsEnabledRef.current) {
        console.log("[Place] Click ignored - controls disabled")
        return
      }
      const currentItem = selectedInventoryItemRef.current
      const currentModelUrl = selectedInventoryModelUrlRef.current
      const currentCallback = onPlaceObjectRef.current
      console.log("[Place] Click detected:", {
        item: currentItem,
        isCommunity: currentItem.startsWith("community-"),
        modelUrl: currentModelUrl,
        hasCallback: !!currentCallback,
        isEmpty: currentItem === "empty"
      })
      if (currentItem === "empty" || !currentCallback) {
        console.log("[Place] Click ignored - empty item or no callback")
        return
      }

      // When pointer locked, use center of screen (0, 0) for raycasting
      const mouse = new THREE.Vector2(0, 0)
      raycaster.setFromCamera(mouse, camera)
      
      // Raycast against ground and all placed items to allow stacking
      const objectsToIntersect: THREE.Object3D[] = [ground]
      for (const mesh of placedItemsRef.current.values()) {
        objectsToIntersect.push(mesh)
      }
      // Recursive so we can stack/place on top of community models (Groups)
      const intersects = raycaster.intersectObjects(objectsToIntersect, true)

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
        // Place item so bottom sits ON the surface
        // Store the ground position (highestY) in item.y
        const currentScale = previewScaleRef.current.clone()
        const defaultColor = 0x4aa3ff
        // For cubes/spheres, we need to account for half height
        // For community models, the positioning logic handles it
        // Store ground position - model positioning will be calculated during rendering
        const placePos = new THREE.Vector3(snappedX, highestY, snappedZ)
        // Get model URL for community items
        const currentModelUrl = currentItem.startsWith("community-") ? selectedInventoryModelUrlRef.current : null
        
        // For community models, require the template to be cached (preview load will populate it)
        if (currentItem.startsWith("community-") && currentModelUrl) {
          const isModelCached = modelCacheRef.current.has(currentModelUrl)
          if (!isModelCached) {
            console.log("[Place] Cannot place - model not loaded yet:", currentModelUrl)
            onActionLogRef.current?.("Model is still loading, please wait...")
            return
          }
        }
        
        console.log("[Place] Placing item:", {
          item: currentItem,
          position: placePos,
          rotation: previewRotationRef.current,
          scale: currentScale,
          modelUrl: currentModelUrl
        })
        
        // Update cooldown timestamp BEFORE calling callback
        lastPlacementTimeRef.current = now
        
        currentCallback(currentItem, placePos, previewRotationRef.current, currentScale, defaultColor, currentModelUrl)
        
        // Get prompt from savedModels for better log message
        let logMessage = `Placed ${currentItem}`
        if (currentItem.startsWith("community-") && savedModelsStorage) {
          const savedModels = Array.from(savedModelsStorage)
          const modelUrl = currentModelUrl || ""
          const savedModel = savedModels.find(m => m.modelUrl === modelUrl)
          if (savedModel) {
            logMessage = `Placed: ${savedModel.prompt}`
          }
        } else if (currentItem === "cube") {
          logMessage = "Placed: Cube"
        } else if (currentItem === "sphere") {
          logMessage = "Placed: Sphere"
        }
        onActionLogRef.current?.(logMessage)
        console.log("[Place] Placement callback called successfully")
      }
    }
    clickListenerRef.current = handlePlaceClick
    renderer.domElement.addEventListener("click", handlePlaceClick)

    // Scroll wheel to rotate preview item (player mode) or resize brush (terrain editor mode)
    const handleWheel = (e: WheelEvent) => {
      if (!controlsEnabledRef.current) return
      
      if (gameModeRef.current === "terrainEditor") {
        // Terrain editor mode: resize brush
        e.preventDefault()
        const delta = e.deltaY > 0 ? -0.5 : 0.5
        terrainBrushRadiusRef.current = Math.max(1.0, Math.min(20.0, terrainBrushRadiusRef.current + delta))
      } else {
        // Player mode: rotate preview item
        if (!document.pointerLockElement || document.pointerLockElement !== renderer.domElement) return
        e.preventDefault()
        const delta = e.deltaY > 0 ? -0.1 : 0.1
        previewRotationRef.current += delta
        if (previewItemRef.current) {
          previewItemRef.current.rotation.y = previewRotationRef.current
        }
      }
    }
    renderer.domElement.addEventListener("wheel", handleWheel, { passive: false })
    
    // Track mouse position for terrain editing
    const handleTerrainMouseMove = (e: MouseEvent) => {
      if (gameModeRef.current !== "terrainEditor") return
      const rect = renderer.domElement.getBoundingClientRect()
      mousePositionRef.current.x = ((e.clientX - rect.left) / rect.width) * 2 - 1
      mousePositionRef.current.y = -((e.clientY - rect.top) / rect.height) * 2 + 1
    }
    
    // Terrain editing mouse handlers
    const handleTerrainMouseDown = (e: MouseEvent) => {
      if (gameModeRef.current !== "terrainEditor") return
      if (!controlsEnabledRef.current) return
      if (e.button === 0) { // Left mouse button
        isTerrainEditingRef.current = true
        terrainEditingVerticesRef.current.clear()
        
        // Handle reset tool on click
        if (terrainToolRef.current === "reset") {
          const groundGeometry = groundGeometryRef.current
          const groundOriginalPositions = groundOriginalPositionsRef.current
          if (groundGeometry && groundOriginalPositions) {
            const positions = groundGeometry.attributes.position
            const colors = groundGeometry.attributes.color
            const positionArray = positions.array as Float32Array
            const colorArray = colors ? (colors.array as Float32Array) : null
            
            // Reset all positions
            for (let i = 0; i < positionArray.length; i++) {
              positionArray[i] = groundOriginalPositions[i]
            }
            
            // Reset all colors
            if (colorArray) {
              for (let i = 0; i < colorArray.length; i += 3) {
                colorArray[i] = 0.75
                colorArray[i + 1] = 0.75
                colorArray[i + 2] = 0.75
              }
            }
            
            positions.needsUpdate = true
            if (colors) colors.needsUpdate = true
            groundGeometry.computeVertexNormals()
            onActionLogRef.current?.("Terrain reset")
            modifiedTerrainVertexIndicesRef.current.clear()
            lastAppliedTerrainVertexTimestampRef.current.clear()
            // Clear shared deltas so other clients also reset
            clearTerrainVertices()
          }
        }
      }
    }
    
    const handleTerrainMouseUp = (e: MouseEvent) => {
      if (gameModeRef.current !== "terrainEditor") return
      if (e.button === 0) { // Left mouse button
        isTerrainEditingRef.current = false
        terrainEditingVerticesRef.current.clear()
        
        // Final sync on mouse up (confirmation when stroke completes)
        const groundGeometry = groundGeometryRef.current
        if (groundGeometry && modifiedTerrainVertexIndicesRef.current.size > 0) {
          const positions = groundGeometry.attributes.position
          const colors = groundGeometry.attributes.color
          const positionArray = positions.array as Float32Array
          const colorArray = colors ? (colors.array as Float32Array) : null
          const delta: Array<{ vertexIndex: number; z: number; color: number | null }> = []
          for (const vertexIndex of modifiedTerrainVertexIndicesRef.current) {
            const base = vertexIndex * 3
            if (base + 2 >= positionArray.length) continue
            const z = positionArray[base + 2]
            let packedColor: number | null = null
            if (colorArray) {
              const r = Math.round(THREE.MathUtils.clamp(colorArray[base], 0, 1) * 255)
              const g = Math.round(THREE.MathUtils.clamp(colorArray[base + 1], 0, 1) * 255)
              const b = Math.round(THREE.MathUtils.clamp(colorArray[base + 2], 0, 1) * 255)
              packedColor = (r << 16) | (g << 8) | b
            }
            delta.push({ vertexIndex, z, color: packedColor })
          }
          updateTerrainVerticesDelta(delta, currentPlayerIdRef.current)
          modifiedTerrainVertexIndicesRef.current.clear()
        }
      }
    }
    
    renderer.domElement.addEventListener("mousedown", handleTerrainMouseDown)
    renderer.domElement.addEventListener("mouseup", handleTerrainMouseUp)
    renderer.domElement.addEventListener("mousemove", handleTerrainMouseMove)

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
        // Cleanup loading queue
        if (sceneRef.current) {
          // Also search the scene for any orphaned sprites (bugged ones)
          sceneRef.current.traverse((child) => {
            if (child instanceof THREE.Sprite) {
              // Check if it's a loading sprite (has the characteristic material)
              const mat = child.material
              if (mat instanceof THREE.SpriteMaterial && mat.map) {
                // Likely a loading sprite - remove it
                try {
                  if (child.parent) {
                    child.parent.remove(child)
                  }
                  mat.map.dispose()
                  mat.dispose()
                  console.log("[Delete] Removed orphaned loading sprite from scene")
                } catch (error) {
                  console.warn("[Delete] Error removing orphaned sprite:", error)
                }
              }
            }
          })
          
          // Also clear the loading queue
          loadingQueueRef.current = []
          isLoadingModelRef.current = false
        }
      } else if (e.code === "ArrowUp" && document.pointerLockElement) {
        // Arrow Up: Make taller and wider (increase Y, X, Z scale)
        e.preventDefault()
        const currentItem = selectedInventoryItemRef.current
        if (currentItem === "empty") return
        previewScaleRef.current.y += 0.1
        previewScaleRef.current.x += 0.1
        previewScaleRef.current.z += 0.1
        if (previewItemRef.current) {
          if (currentItem.startsWith("community-")) {
            const baseScale = (previewItemRef.current.userData.baseScale as number | undefined) ?? 1
            previewItemRef.current.scale.set(
              baseScale * previewScaleRef.current.x,
              baseScale * previewScaleRef.current.y,
              baseScale * previewScaleRef.current.z,
            )
          } else {
            previewItemRef.current.scale.copy(previewScaleRef.current)
          }
        }
        onActionLogRef.current?.(`Size: ${previewScaleRef.current.x.toFixed(1)} x ${previewScaleRef.current.y.toFixed(1)} x ${previewScaleRef.current.z.toFixed(1)}`)
      } else if (e.code === "ArrowDown" && document.pointerLockElement) {
        // Arrow Down: Make shorter and narrower (decrease Y, X, Z scale)
        e.preventDefault()
        const currentItem = selectedInventoryItemRef.current
        if (currentItem === "empty") return
        previewScaleRef.current.y = Math.max(0.1, previewScaleRef.current.y - 0.1)
        previewScaleRef.current.x = Math.max(0.1, previewScaleRef.current.x - 0.1)
        previewScaleRef.current.z = Math.max(0.1, previewScaleRef.current.z - 0.1)
        if (previewItemRef.current) {
          if (currentItem.startsWith("community-")) {
            const baseScale = (previewItemRef.current.userData.baseScale as number | undefined) ?? 1
            previewItemRef.current.scale.set(
              baseScale * previewScaleRef.current.x,
              baseScale * previewScaleRef.current.y,
              baseScale * previewScaleRef.current.z,
            )
          } else {
            previewItemRef.current.scale.copy(previewScaleRef.current)
          }
        }
        onActionLogRef.current?.(`Height: ${previewScaleRef.current.y.toFixed(1)}`)
      } else if (e.code === "ArrowRight" && document.pointerLockElement) {
        // Arrow Right: Make wider (increase X and Z scale)
        e.preventDefault()
        const currentItem = selectedInventoryItemRef.current
        if (currentItem === "empty") return
        previewScaleRef.current.x += 0.1
        previewScaleRef.current.z += 0.1
        if (previewItemRef.current) {
          if (currentItem.startsWith("community-")) {
            const baseScale = (previewItemRef.current.userData.baseScale as number | undefined) ?? 1
            previewItemRef.current.scale.set(
              baseScale * previewScaleRef.current.x,
              baseScale * previewScaleRef.current.y,
              baseScale * previewScaleRef.current.z,
            )
          } else {
            previewItemRef.current.scale.copy(previewScaleRef.current)
          }
        }
        onActionLogRef.current?.(`Width: ${previewScaleRef.current.x.toFixed(1)}`)
      } else if (e.code === "ArrowLeft" && document.pointerLockElement) {
        // Arrow Left: Make narrower (decrease X and Z scale)
        e.preventDefault()
        const currentItem = selectedInventoryItemRef.current
        if (currentItem === "empty") return
        previewScaleRef.current.x = Math.max(0.1, previewScaleRef.current.x - 0.1)
        previewScaleRef.current.z = Math.max(0.1, previewScaleRef.current.z - 0.1)
        if (previewItemRef.current) {
          if (currentItem.startsWith("community-")) {
            const baseScale = (previewItemRef.current.userData.baseScale as number | undefined) ?? 1
            previewItemRef.current.scale.set(
              baseScale * previewScaleRef.current.x,
              baseScale * previewScaleRef.current.y,
              baseScale * previewScaleRef.current.z,
            )
          } else {
            previewItemRef.current.scale.copy(previewScaleRef.current)
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
        rendererDomRef.current.removeEventListener("mousedown", handleTerrainMouseDown)
        rendererDomRef.current.removeEventListener("mouseup", handleTerrainMouseUp)
        if (clickListenerRef.current) {
          rendererDomRef.current.removeEventListener("click", clickListenerRef.current)
          clickListenerRef.current = null
        }
      }
      window.cancelAnimationFrame(raf)
      playerController.dispose()
      freeCameraControllerRef.current?.dispose()
      ground.geometry.dispose()
      gridMat.dispose()
      // Dispose player geometry/material only if it's still a capsule
      
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
      }
      remoteRef.current.clear()
      if (previewItemRef.current) {
        previewItemRef.current.removeFromParent()
        // Type guard: only Meshes have geometry
        if (previewItemRef.current instanceof THREE.Mesh) {
          previewItemRef.current.geometry.dispose()
          const mat = previewItemRef.current.material
          if (mat instanceof THREE.Material) {
            mat.dispose()
          }
        } else if (previewItemRef.current instanceof THREE.Group) {
          // Clean up GLB model
          previewItemRef.current.traverse((child) => {
            if (child instanceof THREE.Mesh) {
              child.geometry.dispose()
              if (Array.isArray(child.material)) {
                child.material.forEach((m) => m.dispose())
              } else {
                child.material.dispose()
              }
            }
          })
        }
        previewItemRef.current = null
      }
      groundMeshRef.current = null
      raycasterRef.current = null
      cameraRef.current = null
      renderer.dispose()
      host.removeChild(renderer.domElement)
      // Remove FPS counter
      const fpsOverlay = document.getElementById("fps-counter")
      if (fpsOverlay) {
        host.removeChild(fpsOverlay)
      }
      controllerRef.current = null
      freeCameraControllerRef.current?.dispose()
      freeCameraControllerRef.current = null
      rendererDomRef.current = null
      sceneRef.current = null
      texLoaderRef.current = null
      skyboxTexRef.current = null
      myPlayerRef.current = null
      // Cleanup placed items
      for (const [, mesh] of placedItemsRef.current.entries()) {
        mesh.removeFromParent()
        if (mesh instanceof THREE.Mesh) {
          mesh.geometry.dispose()
          const mat = mesh.material
          if (mat instanceof THREE.Material) {
            mat.dispose()
          }
        } else if (mesh instanceof THREE.Group) {
          mesh.traverse((child) => {
            if (child instanceof THREE.Mesh) {
              child.geometry.dispose()
              if (Array.isArray(child.material)) {
                child.material.forEach((m) => m.dispose())
              } else {
                child.material.dispose()
              }
            }
          })
        }
      }
      placedItemsRef.current.clear()
      placedItemsModelUrlsRef.current.clear()
      // Cleanup placeholders
      for (const [, placeholder] of placedItemsPlaceholdersRef.current.entries()) {
        placeholder.removeFromParent()
        placeholder.geometry.dispose()
        const mat = placeholder.material
        if (Array.isArray(mat)) {
          mat.forEach((m) => m.dispose())
        } else {
          mat.dispose()
        }
      }
      placedItemsPlaceholdersRef.current.clear()
      // Clear model cache
      for (const [, cachedModel] of modelCacheRef.current.entries()) {
        cachedModel.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            child.geometry.dispose()
            if (Array.isArray(child.material)) {
              child.material.forEach((m) => m.dispose())
            } else {
              child.material.dispose()
            }
          }
        })
      }
      modelCacheRef.current.clear()
    }
  }, []) // Only run once on mount - scene initialization

  // Update onPlaceObject callback reference
  const onPlaceObjectRef = useRef(onPlaceObject)
  useEffect(() => {
    onPlaceObjectRef.current = onPlaceObject
  }, [onPlaceObject])

  // Keep selectedInventoryItem in a ref for tick function
  const selectedInventoryItemRef = useRef(selectedInventoryItem)
  useEffect(() => {
    selectedInventoryItemRef.current = selectedInventoryItem
    console.log("[World] Selected inventory item updated:", selectedInventoryItem)
  }, [selectedInventoryItem])

  // Keep selectedInventoryModelUrl in a ref for tick function
  const selectedInventoryModelUrlRef = useRef(selectedInventoryModelUrl)
  useEffect(() => {
    selectedInventoryModelUrlRef.current = selectedInventoryModelUrl
  }, [selectedInventoryModelUrl])

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
