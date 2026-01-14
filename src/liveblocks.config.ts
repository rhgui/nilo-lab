import { createClient, LiveList, LiveMap } from "@liveblocks/client"
import { createRoomContext } from "@liveblocks/react"

type Presence = {
  name?: string
  x?: number
  y?: number
  z?: number
  yaw?: number
  pitch?: number
  modelUrl?: string | null
  // Shared player color for default character (0xRRGGBB)
  playerColor?: number
  // Terrain editor brush presence
  terrainMode?: "player" | "terrainEditor"
  terrainTool?: "move" | "paint" | "raise" | "lower" | "erase" | "reset" | "smooth"
  terrainBrushX?: number
  terrainBrushY?: number
  terrainBrushZ?: number
  terrainBrushRadius?: number
  terrainBrushColor?: number
  isTerrainEditing?: boolean
}

type PlacedItem = {
  id: string
  itemId: string
  x: number
  y: number
  z: number
  rotationY?: number
  scaleX?: number
  scaleY?: number
  scaleZ?: number
  color?: number
  modelUrl?: string | null
}

type SavedModel = {
  prompt: string
  modelUrl: string
  timestamp: number
  thumbnailUrl?: string
}

type TerrainVertexDelta = {
  // Keyed by vertexIndex (string key in LiveMap)
  z: number // height (local Z in PlaneGeometry)
  color: number | null // packed 0xRRGGBB, null means "no color change"
  timestamp: number
  playerId: string // Connection ID of the player who made the edit
}

type Storage = {
  skyboxUrl: string
  placedItems: LiveList<PlacedItem>
  savedModels: LiveList<SavedModel>
  terrainVertices: LiveMap<string, TerrainVertexDelta>
}

export const client = createClient({
  publicApiKey: import.meta.env.VITE_LIVEBLOCKS_PUBLIC_KEY,
})

export const {
  RoomProvider,
  useMyPresence,
  useOthers,
  useSelf,
  useStorage,
  useMutation,
  useStatus,
} = createRoomContext<Presence, Storage>(client)

// no helper yet

