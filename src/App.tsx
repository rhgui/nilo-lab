import { useMemo, useState, useCallback } from "react"
import World from "./game/World"
import HUD, { type GameMode } from "./components/hud/HUD"
import defaultSkyboxUrl from "./assets/default_skybox.png"
import CharacterSetup from "./components/character/CharacterSetup"
import LoadingScreen from "./components/loading/LoadingScreen"
import { RoomProvider, useMutation, useStatus } from "./liveblocks.config"
import { LiveList, LiveMap } from "@liveblocks/client"
import * as THREE from "three"

function App() {
  const [uiBlocking, setUiBlocking] = useState(false)
  const [selectedInventoryIndex, setSelectedInventoryIndex] = useState(0)
  const [selectedInventoryItem, setSelectedInventoryItem] = useState<string>("empty")
  const [selectedInventoryModelUrl, setSelectedInventoryModelUrl] = useState<string | null>(null)
  const [gameMode, setGameMode] = useState<GameMode>("player")
  const [terrainTool, setTerrainTool] = useState<"move" | "paint" | "raise" | "lower" | "erase" | "reset" | "smooth">("move")
  const [terrainColor, setTerrainColor] = useState<number>(0x4aa3ff)
  const [playerName, setPlayerName] = useState<string>(() => sessionStorage.getItem("playerName") ?? "")
  const roomId = useMemo(() => "physics-room", [])
  const [actionLog, setActionLog] = useState<Array<{ label: string; time: Date }>>([])

  const pushAction = useCallback((label: string) => {
    setActionLog((prev) => {
      const next = [{ label, time: new Date() }, ...prev]
      return       next.slice(0, 5)
    })
    
    setTimeout(() => {
      setActionLog((prev) => {
        return prev.filter((item) => {
          const age = Date.now() - item.time.getTime()
          return age < 5000
        })
      })
    }, 5000)
  }, [])
  
  const handleInventoryModelUrlChange = useCallback((_itemId: string, modelUrl: string | null) => {
    setSelectedInventoryModelUrl(modelUrl)
  }, [])
  
  const handleSelectedInventoryItemChange = useCallback((itemId: string) => {
    setSelectedInventoryItem(itemId)
    if (!itemId.startsWith("community-")) {
      setSelectedInventoryModelUrl(null)
    }
  }, [])
  
  return (
      <RoomProvider
        id={roomId}
        initialStorage={{
          skyboxUrl: defaultSkyboxUrl,
          placedItems: new LiveList<{ id: string; itemId: string; x: number; y: number; z: number; rotationY?: number; scaleX?: number; scaleY?: number; scaleZ?: number; color?: number; modelUrl?: string | null }>([]),
          savedModels: new LiveList<{ prompt: string; modelUrl: string; timestamp: number; thumbnailUrl?: string; animations?: { running?: string; walking?: string } }>([]),
          terrainVertices: new LiveMap<string, { z: number; color: number | null; timestamp: number; playerId: string }>(),
        }}
      >
      {playerName ? (
        <>
          <WorldWithPlacement
            controlsEnabled={!uiBlocking}
            playerName={playerName}
            selectedInventoryItem={selectedInventoryItem}
            selectedInventoryModelUrl={selectedInventoryModelUrl}
            onActionLog={pushAction}
            onUiBlockingChange={setUiBlocking}
            gameMode={gameMode}
            terrainTool={terrainTool}
            terrainColor={terrainColor}
          />
          <HUD
            onUiBlockingChange={setUiBlocking}
            selectedInventoryIndex={selectedInventoryIndex}
            onSelectedInventoryChange={(index) => {
              setSelectedInventoryIndex(index)
            }}
            onSelectedInventoryItemChange={handleSelectedInventoryItemChange}
            actionLog={actionLog}
            uiBlocking={uiBlocking}
            onInventoryModelUrlChange={handleInventoryModelUrlChange}
            gameMode={gameMode}
            onGameModeChange={setGameMode}
            onTerrainToolChange={(tool, color) => {
              setTerrainTool(tool)
              setTerrainColor(color)
            }}
          />
        </>
      ) : (
        <CharacterSetup
          onConfirm={(name, modelUrl) => {
            sessionStorage.setItem("playerName", name)
            if (modelUrl) {
              sessionStorage.setItem("playerModelUrl", modelUrl)
            }
            setPlayerName(name)
          }}
        />
      )}
    </RoomProvider>
  )
}

function WorldWithPlacement({
  controlsEnabled,
  playerName,
  selectedInventoryItem,
  selectedInventoryModelUrl,
  onActionLog,
  onUiBlockingChange,
  gameMode,
  terrainTool,
  terrainColor,
}: {
  controlsEnabled: boolean
  playerName: string
  selectedInventoryItem: string
  selectedInventoryModelUrl?: string | null
  onActionLog?: (label: string) => void
  onUiBlockingChange?: (blocking: boolean) => void
  gameMode: GameMode
  terrainTool: "move" | "paint" | "raise" | "lower" | "erase" | "reset" | "smooth"
  terrainColor: number
}) {
  const status = useStatus()
  const addPlacedItem = useMutation(({ storage }, item: { id: string; itemId: string; x: number; y: number; z: number; rotationY?: number; scaleX?: number; scaleY?: number; scaleZ?: number; color?: number; modelUrl?: string | null }) => {
    const items = storage.get("placedItems")
    if (items) {
      items.push(item)
    }
  }, [])

  const clearAllItems = useMutation(({ storage }) => {
    const items = storage.get("placedItems")
    if (items) {
      while (items.length > 0) {
        items.delete(items.length - 1)
      }
    }
  }, [])

  const onPlaceObject = useCallback(
    (itemId: string, position: THREE.Vector3, rotationY: number, scale: THREE.Vector3, color: number, modelUrl?: string | null) => {
      if (itemId === "empty") return
      const id = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
      addPlacedItem({ 
        id, 
        itemId, 
        x: position.x, 
        y: position.y, 
        z: position.z,
        rotationY,
        scaleX: scale.x,
        scaleY: scale.y,
        scaleZ: scale.z,
        color,
        modelUrl: modelUrl || null
      })
    },
    [addPlacedItem],
  )

  if (status !== "connected") {
    return <LoadingScreen message={status === "connecting" ? "Connecting to server..." : "Reconnecting..."} />
  }

  return <World controlsEnabled={controlsEnabled} playerName={playerName} selectedInventoryItem={selectedInventoryItem} selectedInventoryModelUrl={selectedInventoryModelUrl} onPlaceObject={onPlaceObject} onActionLog={onActionLog} onClearAllItems={clearAllItems} onUiBlockingChange={onUiBlockingChange} gameMode={gameMode} terrainTool={terrainTool} terrainColor={terrainColor} />
}

export default App
