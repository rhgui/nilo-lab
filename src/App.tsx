import { useMemo, useState, useCallback } from "react"
import World from "./game/World"
import HUD from "./components/hud/HUD"
import defaultSkyboxUrl from "./assets/default_skybox.png"
import CharacterSetup from "./components/character/CharacterSetup"
import LoadingScreen from "./components/loading/LoadingScreen"
import { RoomProvider, useMutation, useStatus } from "./liveblocks.config"
import { LiveList } from "@liveblocks/client"
import * as THREE from "three"

function App() {
  const [uiBlocking, setUiBlocking] = useState(false)
  const [selectedInventoryIndex, setSelectedInventoryIndex] = useState(0)
  // Use sessionStorage so each tab/window can have its own character.
  const [playerName, setPlayerName] = useState<string>(() => sessionStorage.getItem("playerName") ?? "")
  const roomId = useMemo(() => "physics-room", [])
  const [actionLog, setActionLog] = useState<Array<{ label: string; time: Date }>>([])

  const pushAction = useCallback((label: string) => {
    setActionLog((prev) => {
      const next = [{ label, time: new Date() }, ...prev]
      return next.slice(0, 5)
    })
  }, [])

  const inventoryItems = ["empty", "cube", "sphere"]
  const selectedInventoryItem = inventoryItems[selectedInventoryIndex] ?? "empty"

  return (
    <RoomProvider id={roomId} initialStorage={{ skyboxUrl: defaultSkyboxUrl, placedItems: new LiveList<{ id: string; itemId: string; x: number; y: number; z: number }>([]), savedModels: new LiveList<{ prompt: string; modelUrl: string; timestamp: number; animations?: { running?: string; walking?: string } }>([]) }}>
      {playerName ? (
        <>
          <WorldWithPlacement
            controlsEnabled={!uiBlocking}
            playerName={playerName}
            selectedInventoryItem={selectedInventoryItem}
            onActionLog={pushAction}
            onUiBlockingChange={setUiBlocking}
          />
          <HUD
            onUiBlockingChange={setUiBlocking}
            selectedInventoryIndex={selectedInventoryIndex}
            onSelectedInventoryChange={setSelectedInventoryIndex}
            actionLog={actionLog}
            uiBlocking={uiBlocking}
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
  onActionLog,
  onUiBlockingChange,
}: {
  controlsEnabled: boolean
  playerName: string
  selectedInventoryItem: string
  onActionLog?: (label: string) => void
  onUiBlockingChange?: (blocking: boolean) => void
}) {
  const status = useStatus()
  const addPlacedItem = useMutation(({ storage }, item: { id: string; itemId: string; x: number; y: number; z: number; rotationY?: number; scaleX?: number; scaleY?: number; scaleZ?: number; color?: number }) => {
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
    (itemId: string, position: THREE.Vector3, rotationY: number, scale: THREE.Vector3, color: number) => {
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
        color
      })
    },
    [addPlacedItem],
  )

  // Show loading screen while connecting
  if (status !== "connected") {
    return <LoadingScreen message={status === "connecting" ? "Connecting to server..." : "Reconnecting..."} />
  }

  return <World controlsEnabled={controlsEnabled} playerName={playerName} selectedInventoryItem={selectedInventoryItem} onPlaceObject={onPlaceObject} onActionLog={onActionLog} onClearAllItems={clearAllItems} onUiBlockingChange={onUiBlockingChange} />
}

export default App
