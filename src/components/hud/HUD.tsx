import { useEffect, useMemo, useState } from "react"
import { HoldKeyTracker } from "../../input/HoldKeyTracker"
import { MousePositionTracker } from "../../input/MousePositionTracker"
import styles from "./hud.module.css"
import CustomCursor from "./CustomCursor"
import PromptModal from "./PromptModal"
import DrawingModal from "./DrawingModal"
import InventoryToolbar, { type InventoryItem } from "./InventoryToolbar"
import TerrainEditorToolbar, { type TerrainTool } from "./TerrainEditorToolbar"
import CommunityModelInventory from "./CommunityModelInventory"
import { generateSkyboxImage } from "../../services/meshySkybox"
import { useMutation, useStorage, useOthers } from "../../liveblocks.config"
import { Cloud, Sparkles, Pencil, Package, User, Mountain, type LucideIcon } from "lucide-react"

type SavedModel = {
  prompt: string
  modelUrl: string
  timestamp: number
  thumbnailUrl?: string
  animations?: {
    running?: string
    walking?: string
  }
}

const MENU_KEY_CODE = "ShiftLeft"
const CONTROLS_TOGGLE_KEY_CODE = "ControlLeft"

function formatKey(code: string) {
  if (code.startsWith("Key")) return code.slice(3)
  if (code === "ShiftLeft" || code === "ShiftRight") return "Shift"
  return code
}

export type GameMode = "player" | "terrainEditor"

const tools: Array<{
  id: string
  label: string
  angle: number
  icon: LucideIcon | null
}> = [
  { id: "skybox", label: "Change Skybox", angle: 0, icon: Cloud }, // Top
  { id: "generate", label: "Generate Object (Text)", angle: 60, icon: Sparkles }, // Top-right
  { id: "generateDrawing", label: "Generate Object (Drawing)", angle: 120, icon: Pencil }, // Bottom-right
  { id: "placeCommunity", label: "Place Community Model", angle: 180, icon: Package }, // Bottom
  { id: "terrainEditor", label: "Terrain Editor Mode", angle: 240, icon: Mountain }, // Bottom-left
  { id: "playerMode", label: "Player Mode", angle: 300, icon: User }, // Top-left
]

export type HUDProps = {
  onUiBlockingChange?: (blocking: boolean) => void
  selectedInventoryIndex?: number
  onSelectedInventoryChange?: (index: number) => void
  onSelectedInventoryItemChange?: (itemId: string) => void
  actionLog?: Array<{ label: string; time: Date }>
  uiBlocking?: boolean
  onInventoryModelUrlChange?: (itemId: string, modelUrl: string | null) => void
  gameMode?: GameMode
  onGameModeChange?: (mode: GameMode) => void
  onTerrainToolChange?: (tool: TerrainTool, color: number) => void
}

const defaultInventoryItems: InventoryItem[] = [
  // for now we only have 3 items
  { id: "empty", label: "Empty" },
  { id: "cube", label: "Cube" },
  { id: "sphere", label: "Sphere" },
]

export default function HUD({ onUiBlockingChange, selectedInventoryIndex, onSelectedInventoryChange, onSelectedInventoryItemChange, actionLog: externalActionLog, uiBlocking = false, onInventoryModelUrlChange, gameMode: externalGameMode, onGameModeChange, onTerrainToolChange }: HUDProps) {
  const [menuHeld, setMenuHeld] = useState(false)
  const [hoveredTool, setHoveredTool] = useState<string | null>(null)
  const [gameMode, setGameMode] = useState<GameMode>(externalGameMode || "player")
  const [mouse, setMouse] = useState({ x: 0, y: 0 })
  const [skyboxPromptOpen, setSkyboxPromptOpen] = useState(false)
  const [skyboxLoading, setSkyboxLoading] = useState(false)
  const [skyboxProgress, setSkyboxProgress] = useState(0)
  const [inventoryIndex, setInventoryIndex] = useState(selectedInventoryIndex ?? 0)
  const [communityModelInventoryOpen, setCommunityModelInventoryOpen] = useState(false)
  const [drawingModalOpen, setDrawingModalOpen] = useState(false)
  const [drawingLoading, setDrawingLoading] = useState(false)
  const [generateDrawingStatus, setGenerateDrawingStatus] = useState<string>("")
  const [previewModelUrl, setPreviewModelUrl] = useState<string | null>(null)
  const [generateTextModalOpen, setGenerateTextModalOpen] = useState(false)
  const [generateTextLoading, setGenerateTextLoading] = useState(false)
  const [generateTextStatus, setGenerateTextStatus] = useState<string>("")
  const [inventoryItems, setInventoryItems] = useState<InventoryItem[]>(defaultInventoryItems)
  const [inventoryModelUrls, setInventoryModelUrls] = useState<Map<string, string>>(new Map())
  const [selectedTerrainTool, setSelectedTerrainTool] = useState<TerrainTool>("move")
  const [selectedTerrainColor, setSelectedTerrainColor] = useState<number>(0x4aa3ff)
  
  // Notify parent when terrain tool or color changes
  useEffect(() => {
    onTerrainToolChange?.(selectedTerrainTool, selectedTerrainColor)
  }, [selectedTerrainTool, selectedTerrainColor, onTerrainToolChange])
  // keep storage subscribed (may be used later for UI)
  useStorage((root) => root.skyboxUrl)
  
  // Get saved models from storage
  const savedModelsStorage = useStorage((root: any) => root?.savedModels)
  const savedModels: SavedModel[] = savedModelsStorage ? Array.from(savedModelsStorage) as SavedModel[] : []
  
  const addSavedModel = useMutation(({ storage }: any, model: SavedModel) => {
    const models = storage.get("savedModels")
    if (models) {
      // Remove duplicates and keep last 20
      const existing: SavedModel[] = [...models]
      const filtered = existing.filter((m: SavedModel) => m.modelUrl !== model.modelUrl)
      const updated = [model, ...filtered].slice(0, 20)
      // Clear and repopulate
      while (models.length > 0) {
        models.delete(models.length - 1)
      }
      updated.forEach((m: SavedModel) => models.push(m))
    }
  }, [])

  const deleteSavedModel = useMutation(({ storage }: any, modelUrl: string) => {
    const models = storage.get("savedModels")
    if (models) {
      const modelsArray = Array.from(models) as SavedModel[]
      const index = modelsArray.findIndex((m: SavedModel) => m.modelUrl === modelUrl)
      if (index !== -1) {
        models.delete(index)
      }
    }
  }, [])

  const setSkyboxUrl = useMutation(({ storage }, url: string) => {
    storage.set("skyboxUrl", url)
  }, [])
  const [controlsVisible, setControlsVisible] = useState(true)
  const [internalActionLog, setInternalActionLog] = useState<Array<{ label: string; time: Date }>>([])
  const actionLog = externalActionLog ?? internalActionLog
  const others = useOthers()

  useEffect(() => {
    if (onSelectedInventoryChange) {
      onSelectedInventoryChange(inventoryIndex)
    }
    // Update selected item ID and model URL when inventory index changes
    const selectedItem = inventoryItems[inventoryIndex]
    if (selectedItem) {
      console.log("[HUD] Selected item changed:", { index: inventoryIndex, itemId: selectedItem.id, item: selectedItem })
      if (onSelectedInventoryItemChange) {
        onSelectedInventoryItemChange(selectedItem.id)
      }
      if (onInventoryModelUrlChange) {
        const modelUrl = inventoryModelUrls.get(selectedItem.id) || null
        onInventoryModelUrlChange(selectedItem.id, modelUrl)
      }
    } else {
      console.warn("[HUD] No item found at index:", inventoryIndex, "items:", inventoryItems)
    }
  }, [inventoryIndex, onSelectedInventoryChange, onSelectedInventoryItemChange, inventoryItems, inventoryModelUrls, onInventoryModelUrlChange])

  const menuKey = useMemo(() => ({ code: MENU_KEY_CODE, label: formatKey(MENU_KEY_CODE) }), [])
  const controlsToggleKey = useMemo(
    () => ({ code: CONTROLS_TOGGLE_KEY_CODE, label: formatKey(CONTROLS_TOGGLE_KEY_CODE) }),
    [],
  )

  useEffect(() => {
    const tracker = new HoldKeyTracker({ code: menuKey.code })
    const unsub = tracker.subscribe(setMenuHeld)
    return () => {
      unsub()
      tracker.dispose()
    }
  }, [menuKey.code])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === controlsToggleKey.code && !e.repeat) {
        setControlsVisible((v) => !v)
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [controlsToggleKey.code])

  useEffect(() => {
    const mouseTracker = new MousePositionTracker(window)
    const unsub = mouseTracker.subscribe(setMouse)
    return () => {
      unsub()
      mouseTracker.dispose()
    }
  }, [])

  // When radial menu is open, ensure cursor is visible by exiting pointer lock.
  // Pointer lock is entered by clicking the WebGL canvas; that hides the OS cursor.
  // For UI interaction we exit pointer lock and render our own custom cursor.
  useEffect(() => {
    if (!menuHeld) return
    if (document.pointerLockElement) document.exitPointerLock()
  }, [menuHeld])

  useEffect(() => {
    onUiBlockingChange?.(skyboxPromptOpen || communityModelInventoryOpen || drawingModalOpen || generateTextModalOpen)
    if ((skyboxPromptOpen || communityModelInventoryOpen || drawingModalOpen || generateTextModalOpen) && document.pointerLockElement) document.exitPointerLock()
  }, [onUiBlockingChange, skyboxPromptOpen, communityModelInventoryOpen, drawingModalOpen, generateTextModalOpen])

  const pushAction = (label: string) => {
    if (externalActionLog) {
      // If external actionLog is provided, it's managed by parent
      return
    }
    setInternalActionLog((prev) => {
      const next = [{ label, time: new Date() }, ...prev]
      return next.slice(0, 5)
    })
    
    // Auto-remove after 5 seconds
    setTimeout(() => {
      setInternalActionLog((prev) => {
        return prev.filter((item) => {
          const age = Date.now() - item.time.getTime()
          return age < 5000
        })
      })
    }, 5000)
  }

  // Refresh balance/tokens after actions complete
  const refreshBalance = async () => {
    try {
      const response = await fetch("/api/meshy/balance")
      if (response.ok) {
        const data = await response.json()
        console.log("[Balance] Refreshed:", data)
      }
    } catch (error) {
      console.warn("[Balance] Failed to refresh:", error)
    }
  }

  const formatTime = (d: Date) =>
    d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })

  const handleToolClick = (toolId: string) => {
    const tool = tools.find((t) => t.id === toolId)
    if (tool) pushAction(tool.label)
    if (toolId === "skybox") setSkyboxPromptOpen(true)
    if (toolId === "placeCommunity") setCommunityModelInventoryOpen(true)
    if (toolId === "generateDrawing") setDrawingModalOpen(true)
    if (toolId === "generate") setGenerateTextModalOpen(true)
    if (toolId === "terrainEditor") {
      setGameMode("terrainEditor")
      onGameModeChange?.("terrainEditor")
    }
    if (toolId === "playerMode") {
      setGameMode("player")
      onGameModeChange?.("player")
    }
  }
  
  // Sync external game mode
  useEffect(() => {
    if (externalGameMode !== undefined) {
      setGameMode(externalGameMode)
    }
  }, [externalGameMode])
  
  const handleCommunityModelSelect = (model: any) => {
    // Add model to inventory toolbar (max 3 community items, cycle through)
    const itemId = `community-${model.modelUrl}`
    const newItem: InventoryItem = {
      id: itemId,
      label: model.prompt.substring(0, 20) + (model.prompt.length > 20 ? "..." : "")
    }
    
    setInventoryItems(prev => {
      const defaultItems = prev.slice(0, 3) // Keep default items (empty, cube, sphere)
      const communityItems = prev.slice(3) // Get existing community items
      
      // Check if this model already exists
      const existingIndex = communityItems.findIndex(item => item.id === itemId)
      if (existingIndex !== -1) {
        // Already exists, just select it
        setInventoryIndex(existingIndex + 3)
        return prev
      }
      
      // Add new item, but limit to 3 community items
      const updatedCommunityItems = [...communityItems, newItem]
      if (updatedCommunityItems.length > 3) {
        // Remove the oldest (first) community item
        updatedCommunityItems.shift()
      }
      
      // Select the newly added item (always last in community items)
      setInventoryIndex(defaultItems.length + updatedCommunityItems.length - 1)
      
      return [...defaultItems, ...updatedCommunityItems]
    })
    
    setInventoryModelUrls(prev => {
      const next = new Map(prev)
      next.set(itemId, model.modelUrl)
      
      // Remove URLs for community items that are no longer in the list
      const currentItems = inventoryItems
      const defaultItems = currentItems.slice(0, 3)
      const communityItems = currentItems.slice(3)
      const allCommunityItems = [...communityItems, newItem]
      if (allCommunityItems.length > 3) {
        allCommunityItems.shift() // Remove oldest
      }
      const validIds = new Set([...defaultItems, ...allCommunityItems].map(item => item.id))
      for (const [id] of next.entries()) {
        if (id.startsWith("community-") && !validIds.has(id)) {
          next.delete(id)
        }
      }
      
      return next
    })
    
    // Update selected index and model URL
    const currentItems = inventoryItems
    const defaultItems = currentItems.slice(0, 3)
    const communityItems = currentItems.slice(3)
    const allCommunityItems = [...communityItems, newItem]
    if (allCommunityItems.length > 3) {
      allCommunityItems.shift()
    }
    const newIndex = defaultItems.length + allCommunityItems.length - 1
    setInventoryIndex(newIndex)
    onInventoryModelUrlChange?.(itemId, model.modelUrl)
    pushAction(`Added to inventory: ${model.prompt}`)
  }

  return (
    <div className={styles.hud}>
      <div className={styles.panel}>
        <div className={styles.panelHeader}>
          <div className={styles.title}>Controls</div>
          <button className={styles.panelToggle} type="button" onClick={() => setControlsVisible((v) => !v)}>
            {controlsVisible ? "Hide" : "Show"} ({controlsToggleKey.label})
          </button>
        </div>

        {controlsVisible && (
          <>
            {gameMode === "player" ? (
              <>
                <div className={styles.row}>
                  <span className={styles.key}>WASD</span>
                  <span className={styles.text}>Move</span>
                </div>
                <div className={styles.row}>
                  <span className={styles.key}>Space</span>
                  <span className={styles.text}>Jump</span>
                </div>
                <div className={styles.row}>
                  <span className={styles.key}>Mouse</span>
                  <span className={styles.text}>Look (click canvas to lock)</span>
                </div>
                <div className={styles.row}>
                  <span className={styles.key}>Hold {menuKey.label}</span>
                  <span className={styles.text}>Radial menu</span>
                </div>
                <div className={styles.row}>
                  <span className={styles.key}>1/2/3</span>
                  <span className={styles.text}>Change item</span>
                </div>
                <div className={styles.row}>
                  <span className={styles.key}>Scroll</span>
                  <span className={styles.text}>Rotate item</span>
                </div>
                <div className={styles.row}>
                  <span className={styles.key}>Z</span>
                  <span className={styles.text}>Toggle snap mode</span>
                </div>
                <div className={styles.row}>
                  <span className={styles.key}>Del</span>
                  <span className={styles.text}>Delete all props</span>
                </div>
                <div className={styles.row}>
                  <span className={styles.key}>↑/↓</span>
                  <span className={styles.text}>Adjust height</span>
                </div>
                <div className={styles.row}>
                  <span className={styles.key}>←/→</span>
                  <span className={styles.text}>Adjust width</span>
                </div>
              </>
            ) : (
              <>
                <div className={styles.row}>
                  <span className={styles.key}>WASD</span>
                  <span className={styles.text}>Move camera</span>
                </div>
                <div className={styles.row}>
                  <span className={styles.key}>Q/E</span>
                  <span className={styles.text}>Move up/down</span>
                </div>
                <div className={styles.row}>
                  <span className={styles.key}>Mouse Drag</span>
                  <span className={styles.text}>Rotate camera</span>
                </div>
                <div className={styles.row}>
                  <span className={styles.key}>Scroll</span>
                  <span className={styles.text}>Zoom</span>
                </div>
                <div className={styles.row}>
                  <span className={styles.key}>Hold {menuKey.label}</span>
                  <span className={styles.text}>Radial menu</span>
                </div>
                <div className={styles.row}>
                  <span className={styles.key}>1-5</span>
                  <span className={styles.text}>Terrain tools</span>
                </div>
              </>
            )}
          </>
        )}
      </div>

      <div className={styles.playersOnline}>
        <span className={styles.onlineDot} aria-hidden />
        <span className={styles.playersOnlineText}>{others.length + 1} online</span>
      </div>

      {actionLog.length > 0 && (
        <div className={styles.actionLog} aria-label="Action log">
          {actionLog.map((it, idx) => (
            <div key={`${it.time.getTime()}-${idx}`} className={styles.actionItem}>
              <span className={styles.actionTime}>[{formatTime(it.time)}]</span>
              {it.label}
            </div>
          ))}
        </div>
      )}

      {menuHeld && (
        <div className={styles.radialWrap}>
          <div className={styles.radial} role="menu" aria-label="Radial menu">
            {/* Central circle with text */}
            <div className={styles.centerCircle}>
              <div className={styles.centerText}>
                {hoveredTool ? (
                  <>
                    {tools.find((t) => t.id === hoveredTool)?.label.split(" ").map((word, i) => (
                      <div key={i}>{word}</div>
                    ))}
                  </>
                ) : (
                  <>
                    <div>Hold</div>
                    <div>Shift</div>
                  </>
                )}
              </div>
            </div>
            
            {/* Wedge segments - using SVG for proper wedge shapes */}
            <svg className={styles.wedgeContainer} viewBox="0 0 400 400">
              {tools.map((tool) => {
                const segmentAngle = 360 / tools.length
                const startAngle = tool.angle - segmentAngle / 2
                const endAngle = tool.angle + segmentAngle / 2
                const isHovered = hoveredTool === tool.id
                
                // Convert angles to SVG coordinates (SVG has 0° at top, clockwise)
                const centerX = 200
                const centerY = 200
                const innerRadius = 60
                const outerRadius = 200
                
                const startRad = ((startAngle - 90) * Math.PI) / 180
                const endRad = ((endAngle - 90) * Math.PI) / 180
                
                const x1 = centerX + Math.cos(startRad) * innerRadius
                const y1 = centerY + Math.sin(startRad) * innerRadius
                const x2 = centerX + Math.cos(startRad) * outerRadius
                const y2 = centerY + Math.sin(startRad) * outerRadius
                const x3 = centerX + Math.cos(endRad) * outerRadius
                const y3 = centerY + Math.sin(endRad) * outerRadius
                const x4 = centerX + Math.cos(endRad) * innerRadius
                const y4 = centerY + Math.sin(endRad) * innerRadius

                return (
                  <path
                    key={tool.id}
                    className={`${styles.wedgeSegment} ${isHovered ? styles.wedgeHovered : ""}`}
                    d={`M ${x1} ${y1} L ${x2} ${y2} A ${outerRadius} ${outerRadius} 0 0 1 ${x3} ${y3} L ${x4} ${y4} A ${innerRadius} ${innerRadius} 0 0 0 ${x1} ${y1} Z`}
                    onClick={() => tool.id && !tool.id.startsWith("empty") && handleToolClick(tool.id)}
                    onMouseEnter={() => setHoveredTool(tool.id)}
                    onMouseLeave={() => setHoveredTool(null)}
                  />
                )
              })}
            </svg>
            
            {/* Icons positioned absolutely over the SVG */}
            {tools.map((tool) => {
              if (!tool.icon) return null
              
              const iconRadius = 100
              const iconAngleRad = ((tool.angle - 90) * Math.PI) / 180
              const iconX = 200 + Math.cos(iconAngleRad) * iconRadius
              const iconY = 200 + Math.sin(iconAngleRad) * iconRadius
              const isHovered = hoveredTool === tool.id
              
              // Convert from SVG viewBox coordinates (400x400) to percentage
              const iconXPercent = (iconX / 400) * 100
              const iconYPercent = (iconY / 400) * 100
              
              return (
                <div
                  key={`icon-${tool.id}`}
                  className={styles.wedgeIcon}
                  style={{
                    position: "absolute",
                    left: `${iconXPercent}%`,
                    top: `${iconYPercent}%`,
                    transform: "translate(-50%, -50%)",
                    opacity: isHovered ? 1 : 0.85,
                  }}
                >
                  <tool.icon size={24} strokeWidth={2} />
                </div>
              )
            })}
          </div>
          <CustomCursor x={mouse.x} y={mouse.y} variant={hoveredTool ? "hover" : "default"} />
        </div>
      )}

      {gameMode === "player" ? (
        <InventoryToolbar
          items={inventoryItems}
          selectedIndex={inventoryIndex}
          onSelectedChange={setInventoryIndex}
          disabled={skyboxPromptOpen || communityModelInventoryOpen || drawingModalOpen || generateTextModalOpen || uiBlocking}
          modelUrls={inventoryModelUrls}
        />
      ) : (
        <TerrainEditorToolbar
          selectedTool={selectedTerrainTool}
          onToolChange={setSelectedTerrainTool}
          selectedColor={selectedTerrainColor}
          onColorChange={setSelectedTerrainColor}
          disabled={skyboxPromptOpen || communityModelInventoryOpen || drawingModalOpen || generateTextModalOpen || uiBlocking}
        />
      )}

      <PromptModal
        isOpen={skyboxPromptOpen}
        onClose={() => {
          if (!skyboxLoading) {
            setSkyboxPromptOpen(false)
            setSkyboxProgress(0)
          }
        }}
        isLoading={skyboxLoading}
        generationStatus={skyboxLoading ? `Generating skybox... ${Math.round(skyboxProgress)}%` : undefined}
        showModelSelection={true}
        onSubmit={async (prompt, aiModel) => {
          // Don't close immediately - keep modal open to show progress
          try {
            setSkyboxLoading(true)
            setSkyboxProgress(0)
            pushAction("Generating skybox…")
            const { imageUrl } = await generateSkyboxImage({ 
              prompt,
              aiModel: aiModel || 'nano-banana',
              onProgress: (progress) => {
                setSkyboxProgress(progress)
                pushAction(`Generating skybox... ${Math.round(progress)}%`)
              }
            })
            setSkyboxUrl(imageUrl)
            pushAction("Skybox updated")
            setSkyboxLoading(false)
            setSkyboxPromptOpen(false)
            setSkyboxProgress(0)
            await refreshBalance() // Refresh tokens after action
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err)
            pushAction(`Skybox failed: ${msg}`)
            console.error(err)
            setSkyboxLoading(false)
            setSkyboxProgress(0)
          }
        }}
      />
      
      <CommunityModelInventory
        isOpen={communityModelInventoryOpen}
        onClose={() => setCommunityModelInventoryOpen(false)}
        onSelect={handleCommunityModelSelect}
        onDelete={deleteSavedModel}
        models={savedModels}
      />
      
      <DrawingModal
        isOpen={drawingModalOpen}
        onClose={() => {
          if (!drawingLoading) {
            setDrawingModalOpen(false)
            setPreviewModelUrl(null)
          }
        }}
        isLoading={drawingLoading}
        generationStatus={generateDrawingStatus}
        previewModelUrl={previewModelUrl}
        onSubmit={async (imageDataUrl: string, prompt: string) => {
          // This is called after image refinement is complete and user wants to generate 3D
          console.log("[Image-to-3D] Starting generation:", { prompt, imageSize: imageDataUrl.length })
          
          // Store the prompt in a variable that will be accessible in the closure
          const texturePrompt = prompt.trim() || "realistic textures"
          if (!texturePrompt) {
            throw new Error("Prompt is required for 3D generation")
          }
          
          // Clear previous preview when starting new generation
          setPreviewModelUrl(null)
          setGenerateDrawingStatus("")
          try {
            setDrawingLoading(true)
            pushAction("Generating 3D model from refined image…")
            
            // Send to server endpoint for image-to-3d (mesh generation only, no texturing yet)
            const response = await fetch("/api/meshy/image-to-3d", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                image_url: imageDataUrl, // Data URI
                texture_prompt: texturePrompt,
                should_texture: false, // Generate mesh first, then retexture separately
              }),
            })
            
            if (!response.ok) {
              const errorText = await response.text()
              throw new Error(`Failed to generate model: ${errorText}`)
            }
            
            const data = await response.json()
            console.log("[Image-to-3D] Task created:", data.taskId)
            pushAction("Generating 3D model...")
            
            // Poll for mesh completion
            let attempts = 0
            const maxAttempts = 120
            const pollInterval = 5000
            
            const pollResult = async (): Promise<void> => {
              try {
                const statusResponse = await fetch(`/api/meshy/status/${encodeURIComponent(data.taskId)}`)
                if (!statusResponse.ok) {
                  throw new Error("Failed to check status")
                }
                
                const statusData = await statusResponse.json()
                attempts++
                console.log(`[Image-to-3D] Status check ${attempts}:`, statusData.status, statusData.progress)
                
                // Update progress and status messages
                const progress = statusData.progress !== undefined && statusData.progress !== null 
                  ? statusData.progress 
                  : Math.min((attempts / maxAttempts) * 90, 90)
                
                if (statusData.status === "PENDING" || statusData.status === "IN_PROGRESS") {
                  setGenerateDrawingStatus(`Generating 3D model... ${Math.round(progress)}%`)
                  pushAction(`Generating 3D model... ${Math.round(progress)}%`)
                  if (attempts < maxAttempts) {
                    setTimeout(pollResult, pollInterval)
                    return
                  }
                } else if (statusData.status === "completed" || statusData.status === "SUCCEEDED") {
                  const meshModelUrl = statusData.model_urls?.glb || statusData.modelUrl
                  if (meshModelUrl) {
                    // Mesh complete - show model first
                    console.log("[Image-to-3D] Mesh complete:", meshModelUrl, "full response:", statusData)
                    pushAction("Mesh complete")
                    setGenerateDrawingStatus("Mesh complete")
                    // Show mesh in preview - this will trigger the DrawingModal to load it
                    setPreviewModelUrl(meshModelUrl)
                    console.log("[Image-to-3D] Preview URL set to:", meshModelUrl)
                    
                    // Now create retexture task
                    pushAction("Texturing model...")
                    try {
                      // Ensure we have a valid prompt for retexturing
                      const finalTexturePrompt = texturePrompt || "realistic textures with high quality details"
                      console.log("[Image-to-3D] Starting retexture with prompt:", finalTexturePrompt)
                      
                      const retextureResponse = await fetch("/api/meshy/retexture", {
                        method: "POST",
                        headers: {
                          "Content-Type": "application/json",
                        },
                        body: JSON.stringify({
                          model_url: meshModelUrl, // Use model URL instead of task ID for more reliable retexturing
                          text_style_prompt: finalTexturePrompt, // Use the captured prompt variable
                          enable_pbr: false,
                        }),
                      })

                      if (retextureResponse.ok) {
                        const retextureData = await retextureResponse.json()
                        
                        // Poll for retexture task completion
                        let retextureAttempts = 0
                        const retextureMaxAttempts = 120
                        const retexturePollInterval = 5000
                        
                        const pollRetextureResult = async (): Promise<void> => {
                          try {
                            const retextureStatusResponse = await fetch(`/api/meshy/status/${encodeURIComponent(retextureData.taskId)}`)
                            if (!retextureStatusResponse.ok) {
                              throw new Error("Failed to check retexture status")
                            }
                            
                            const retextureStatusData = await retextureStatusResponse.json()
                            retextureAttempts++
                            
                            const retextureProgress = retextureStatusData.progress !== undefined && retextureStatusData.progress !== null
                              ? retextureStatusData.progress
                              : Math.min((retextureAttempts / retextureMaxAttempts) * 90, 90)
                            
                            if (retextureStatusData.status === "PENDING" || retextureStatusData.status === "IN_PROGRESS") {
                              setGenerateDrawingStatus(`Texturing model... ${Math.round(retextureProgress)}%`)
                              pushAction(`Texturing model... ${Math.round(retextureProgress)}%`)
                              if (retextureAttempts < retextureMaxAttempts) {
                                setTimeout(pollRetextureResult, retexturePollInterval)
                                return
                              }
                            } else if (retextureStatusData.status === "completed" || retextureStatusData.status === "SUCCEEDED") {
                              // Retexture complete
                              const retexturedModelUrl = retextureStatusData.model_urls?.glb || retextureStatusData.modelUrl
                              if (retexturedModelUrl) {
                                pushAction("Texture complete")
                                setGenerateDrawingStatus("Texture complete")
                                setPreviewModelUrl(retexturedModelUrl) // Update preview with textured model
                                
                                // Add to community models
                                const thumbnailUrl = retextureStatusData.thumbnail_url || null
                                console.log("[Image-to-3D] Retexture complete, thumbnail URL:", thumbnailUrl, "full response:", retextureStatusData)
                                const newModel = {
                                  prompt: prompt.trim(),
                                  modelUrl: retexturedModelUrl,
                                  timestamp: Date.now(),
                                  thumbnailUrl: thumbnailUrl || undefined
                                }
                                addSavedModel(newModel)
                                
                                // Add to inventory
                                handleCommunityModelSelect(newModel)
                                
                                pushAction("Image-to-3D: Added to inventory!")
                                console.log("[Image-to-3D] Complete, added to inventory")
                                setDrawingLoading(false)
                                setDrawingModalOpen(false) // Close modal after completion
                                await refreshBalance() // Refresh tokens after action
                                return
                              }
                            } else if (retextureStatusData.status === "failed" || retextureStatusData.status === "FAILED") {
                              // Retexture failed, use mesh model
                              pushAction("Texturing failed, using mesh model")
                              const meshModelUrl = statusData.model_urls?.glb || statusData.modelUrl
                              const thumbnailUrl = statusData.thumbnail_url || null
                              console.log("[Image-to-3D] Mesh complete, thumbnail URL:", thumbnailUrl, "full response:", statusData)
                              const newModel = {
                                prompt: prompt.trim(),
                                modelUrl: meshModelUrl,
                                timestamp: Date.now(),
                                thumbnailUrl: thumbnailUrl || undefined
                              }
                              addSavedModel(newModel)
                              handleCommunityModelSelect(newModel)
                              setDrawingLoading(false)
                              return
                            } else if (retextureAttempts < retextureMaxAttempts) {
                              setTimeout(pollRetextureResult, retexturePollInterval)
                              return
                            } else {
                              // Retexture timed out, use mesh model
                              pushAction("Texturing timed out, using mesh model")
                              const meshModelUrl = statusData.model_urls?.glb || statusData.modelUrl
                              const thumbnailUrl = statusData.thumbnail_url || null
                              console.log("[Image-to-3D] Mesh complete, thumbnail URL:", thumbnailUrl, "full response:", statusData)
                              const newModel = {
                                prompt: prompt.trim(),
                                modelUrl: meshModelUrl,
                                timestamp: Date.now(),
                                thumbnailUrl: thumbnailUrl || undefined
                              }
                              addSavedModel(newModel)
                              handleCommunityModelSelect(newModel)
                              setDrawingLoading(false)
                              return
                            }
                          } catch (error) {
                            // Retexture error, use mesh model
                            pushAction("Texturing error, using mesh model")
                            const meshModelUrl = statusData.model_urls?.glb || statusData.modelUrl
                            const thumbnailUrl = statusData.thumbnail_url || null
                            const newModel = {
                              prompt: prompt.trim(),
                              modelUrl: meshModelUrl,
                              timestamp: Date.now(),
                              thumbnailUrl: thumbnailUrl || undefined
                            }
                            addSavedModel(newModel)
                            handleCommunityModelSelect(newModel)
                            setDrawingLoading(false)
                            console.error(error)
                          }
                        }
                        
                        // Start polling retexture task
                        setTimeout(pollRetextureResult, 2000)
                        return
                      } else {
                        // Retexture request failed - don't add to inventory yet, wait for texture to complete or timeout
                        const errorText = await retextureResponse.text()
                        console.error("[Image-to-3D] Retexture request failed:", errorText)
                        pushAction("Texturing request failed, waiting for texture to complete...")
                        // Don't add model to inventory - let texture complete or timeout first
                        // The model preview is already showing the mesh, which is fine
                        setGenerateDrawingStatus("Texturing request failed, retrying...")
                        // Continue polling to see if texture completes anyway, or wait for timeout
                        return
                      }
                    } catch (error) {
                      // Retexture error - log but don't add to inventory yet
                      // Model preview is already showing mesh, wait for texture to complete
                      console.error("[Image-to-3D] Retexture error:", error)
                      pushAction("Texturing error, waiting for texture...")
                      setGenerateDrawingStatus("Texturing error, waiting...")
                      // Don't add model to inventory - wait for texture completion or explicit timeout
                      // The error might be transient, texture could still complete
                      setDrawingLoading(false)
                    }
                  }
                } else if (statusData.status === "failed" || statusData.status === "FAILED") {
                  throw new Error(statusData.error || "Image-to-3D generation failed")
                } else if (attempts < maxAttempts) {
                  setTimeout(pollResult, pollInterval)
                  return
                } else {
                  throw new Error("Image-to-3D generation timed out")
                }
              } catch (error) {
                console.error("[Image-to-3D] Polling error:", error)
                setDrawingLoading(false)
                setDrawingModalOpen(false)
                const msg = error instanceof Error ? error.message : String(error)
                pushAction(`Image-to-3D failed: ${msg}`)
              }
            }
            
            setTimeout(pollResult, 2000)
          } catch (err) {
            console.error("[Image-to-3D] Initial request error:", err)
            const msg = err instanceof Error ? err.message : String(err)
            pushAction(`Generation failed: ${msg}`)
            setDrawingLoading(false)
            setDrawingModalOpen(false)
          }
        }}
      />
      
      <PromptModal
        isOpen={generateTextModalOpen}
        onClose={() => {
          if (!generateTextLoading) {
            setGenerateTextModalOpen(false)
          }
        }}
        isLoading={generateTextLoading}
        generationStatus={generateTextStatus || (generateTextLoading ? "Generating 3D model from text..." : undefined)}
        onSubmit={async (promptParam) => {
          // Store prompt immediately to avoid closure issues
          const finalPrompt = promptParam.trim()
          console.log("[HUD] Text-to-3D onSubmit called with prompt:", finalPrompt, "(length:", finalPrompt.length, ")")
          
          // Don't close immediately - keep modal open to show progress
          try {
            setGenerateTextLoading(true)
            setGenerateTextStatus("Initializing generation...")
            pushAction("Generating 3D model from text…")
            
            // Store the prompt for retexture step
            const texturePrompt = finalPrompt || "realistic textures"
            
            console.log("[HUD] Sending request to /api/meshy/generate with:", {
              prompt: finalPrompt,
              texture_prompt: texturePrompt,
              pose_mode: "a-pose"
            })
            
            // Send to server endpoint for text-to-3d
            const response = await fetch("/api/meshy/generate", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                prompt: finalPrompt,
                texture_prompt: texturePrompt,
                pose_mode: "a-pose",
              }),
            })
            
            if (!response.ok) {
              const errorText = await response.text()
              throw new Error(`Failed to generate model: ${errorText}`)
            }
            
            const data = await response.json()
            pushAction(`3D model generation started: ${data.taskId}`)
            setGenerateTextStatus("Generating mesh... 0%")
            
            // Poll for mesh completion with progress tracking
            // Use setTimeout to prevent blocking the UI thread
            let attempts = 0
            const maxAttempts = 120
            const pollInterval = 5000
            
            const pollResult = async (): Promise<void> => {
              try {
                const statusResponse = await fetch(`/api/meshy/status/${encodeURIComponent(data.taskId)}`)
                if (!statusResponse.ok) {
                  throw new Error("Failed to check status")
                }
                
                const statusData = await statusResponse.json()
                attempts++
                
                const progress = statusData.progress !== undefined && statusData.progress !== null
                  ? statusData.progress
                  : Math.min((attempts / maxAttempts) * 90, 90)
                
                if (statusData.status === "PENDING" || statusData.status === "IN_PROGRESS") {
                  const progressText = `Generating mesh... ${Math.round(progress)}%`
                  setGenerateTextStatus(progressText)
                  pushAction(`Generating 3D model... ${Math.round(progress)}%`)
                  if (attempts < maxAttempts) {
                    setTimeout(pollResult, pollInterval)
                    return
                  }
                } else if (statusData.status === "completed" || statusData.status === "SUCCEEDED") {
                  const meshModelUrl = statusData.model_urls?.glb || statusData.modelUrl
                  if (meshModelUrl) {
                    // Mesh complete - now create retexture task to ensure textures are generated
                    console.log("[Text-to-3D] Mesh complete:", meshModelUrl)
                    setGenerateTextStatus("Mesh complete, texturing model... 0%")
                    pushAction("Mesh complete, texturing model...")
                    
                    try {
                      const retextureResponse = await fetch("/api/meshy/retexture", {
                        method: "POST",
                        headers: {
                          "Content-Type": "application/json",
                        },
                        body: JSON.stringify({
                          model_url: meshModelUrl,
                          text_style_prompt: texturePrompt,
                          enable_pbr: false,
                        }),
                      })

                      if (retextureResponse.ok) {
                        const retextureData = await retextureResponse.json()
                        
                        // Poll for retexture task completion
                        let retextureAttempts = 0
                        const retextureMaxAttempts = 120
                        const retexturePollInterval = 5000
                        
                        const pollRetextureResult = async (): Promise<void> => {
                          try {
                            const retextureStatusResponse = await fetch(`/api/meshy/status/${encodeURIComponent(retextureData.taskId)}`)
                            if (!retextureStatusResponse.ok) {
                              throw new Error("Failed to check retexture status")
                            }
                            
                            const retextureStatusData = await retextureStatusResponse.json()
                            retextureAttempts++
                            
                            const retextureProgress = retextureStatusData.progress !== undefined && retextureStatusData.progress !== null
                              ? retextureStatusData.progress
                              : Math.min((retextureAttempts / retextureMaxAttempts) * 90, 90)
                            
                            if (retextureStatusData.status === "PENDING" || retextureStatusData.status === "IN_PROGRESS") {
                              const textureProgressText = `Texturing model... ${Math.round(retextureProgress)}%`
                              setGenerateTextStatus(textureProgressText)
                              pushAction(`Texturing model... ${Math.round(retextureProgress)}%`)
                              if (retextureAttempts < retextureMaxAttempts) {
                                setTimeout(pollRetextureResult, retexturePollInterval)
                                return
                              }
                            } else if (retextureStatusData.status === "completed" || retextureStatusData.status === "SUCCEEDED") {
                              // Retexture complete
                              const retexturedModelUrl = retextureStatusData.model_urls?.glb || retextureStatusData.modelUrl
                              if (retexturedModelUrl) {
                                setGenerateTextStatus("Complete!")
                                pushAction("Texture complete")
                                const thumbnailUrl = retextureStatusData.thumbnail_url || statusData.thumbnail_url || null
                                const newModel = {
                                  prompt: finalPrompt,
                                  modelUrl: retexturedModelUrl,
                                  timestamp: Date.now(),
                                  thumbnailUrl: thumbnailUrl || undefined
                                }
                                addSavedModel(newModel)
                                handleCommunityModelSelect(newModel)
                                setGenerateTextLoading(false)
                                setGenerateTextStatus("")
                                setGenerateTextModalOpen(false)
                                await refreshBalance() // Refresh tokens after action
                                return
                              }
                            } else if (retextureStatusData.status === "failed" || retextureStatusData.status === "FAILED") {
                              // Retexture failed, use mesh model
                              setGenerateTextStatus("Texturing failed, using mesh model")
                              pushAction("Texturing failed, using mesh model")
                              const thumbnailUrl = statusData.thumbnail_url || null
                              const newModel = {
                                prompt: finalPrompt,
                                modelUrl: meshModelUrl,
                                timestamp: Date.now(),
                                thumbnailUrl: thumbnailUrl || undefined
                              }
                              addSavedModel(newModel)
                              handleCommunityModelSelect(newModel)
                              setGenerateTextLoading(false)
                              setGenerateTextStatus("")
                              setGenerateTextModalOpen(false)
                              return
                            } else if (retextureAttempts < retextureMaxAttempts) {
                              setTimeout(pollRetextureResult, retexturePollInterval)
                              return
                            } else {
                              // Retexture timed out, use mesh model
                              setGenerateTextStatus("Texturing timed out, using mesh model")
                              pushAction("Texturing timed out, using mesh model")
                              const thumbnailUrl = statusData.thumbnail_url || null
                              const newModel = {
                                prompt: finalPrompt,
                                modelUrl: meshModelUrl,
                                timestamp: Date.now(),
                                thumbnailUrl: thumbnailUrl || undefined
                              }
                              addSavedModel(newModel)
                              handleCommunityModelSelect(newModel)
                              setGenerateTextLoading(false)
                              setGenerateTextStatus("")
                              setGenerateTextModalOpen(false)
                              return
                            }
                          } catch (error) {
                            // Retexture error, use mesh model
                            setGenerateTextStatus("Texturing error, using mesh model")
                            pushAction("Texturing error, using mesh model")
                            const thumbnailUrl = statusData.thumbnail_url || null
                            const newModel = {
                              prompt: finalPrompt,
                              modelUrl: meshModelUrl,
                              timestamp: Date.now(),
                              thumbnailUrl: thumbnailUrl || undefined
                            }
                            addSavedModel(newModel)
                            handleCommunityModelSelect(newModel)
                            setGenerateTextLoading(false)
                            setGenerateTextStatus("")
                            setGenerateTextModalOpen(false)
                            console.error(error)
                          }
                        }
                        
                        // Start polling retexture task
                        setTimeout(pollRetextureResult, 2000)
                        return
                      } else {
                        // Retexture request failed, use mesh model
                        const errorText = await retextureResponse.text()
                        console.error("[Text-to-3D] Retexture request failed:", errorText)
                        setGenerateTextStatus("Texturing request failed, using mesh model")
                        pushAction("Texturing request failed, using mesh model")
                        const thumbnailUrl = statusData.thumbnail_url || null
                        const newModel = {
                          prompt: finalPrompt,
                          modelUrl: meshModelUrl,
                          timestamp: Date.now(),
                          thumbnailUrl: thumbnailUrl || undefined
                        }
                        addSavedModel(newModel)
                        handleCommunityModelSelect(newModel)
                        setGenerateTextLoading(false)
                        setGenerateTextStatus("")
                        setGenerateTextModalOpen(false)
                        return
                      }
                    } catch (error) {
                      // Retexture error, use mesh model
                      console.error("[Text-to-3D] Retexture error:", error)
                      setGenerateTextStatus("Texturing error, using mesh model")
                      pushAction("Texturing error, using mesh model")
                      const thumbnailUrl = statusData.thumbnail_url || null
                      const newModel = {
                        prompt: finalPrompt,
                        modelUrl: meshModelUrl,
                        timestamp: Date.now(),
                        thumbnailUrl: thumbnailUrl || undefined
                      }
                      addSavedModel(newModel)
                      handleCommunityModelSelect(newModel)
                      setGenerateTextLoading(false)
                      setGenerateTextStatus("")
                      setGenerateTextModalOpen(false)
                    }
                  }
                } else if (statusData.status === "failed" || statusData.status === "FAILED") {
                  throw new Error(statusData.error || "Text-to-3D generation failed")
                } else if (attempts < maxAttempts) {
                  setTimeout(pollResult, pollInterval)
                  return
                } else {
                  throw new Error("Text-to-3D generation timed out")
                }
              } catch (error) {
                console.error("[Text-to-3D] Polling error:", error)
                setGenerateTextLoading(false)
                setGenerateTextStatus("")
                setGenerateTextModalOpen(false)
                const msg = error instanceof Error ? error.message : String(error)
                pushAction(`Text-to-3D failed: ${msg}`)
              }
            }
            
            setTimeout(pollResult, 2000)
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err)
            pushAction(`Generation failed: ${msg}`)
            console.error(err)
            setGenerateTextLoading(false)
            setGenerateTextStatus("")
            setGenerateTextModalOpen(false)
          }
        }}
      />
    </div>
  )
}