import { createClient, LiveList } from "@liveblocks/client"
import { createRoomContext } from "@liveblocks/react"

type Presence = {
  name?: string
  x?: number
  y?: number
  z?: number
  yaw?: number
  pitch?: number
  modelUrl?: string | null
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
}

type SavedModel = {
  prompt: string
  modelUrl: string
  timestamp: number
}

type Storage = {
  skyboxUrl: string
  placedItems: LiveList<PlacedItem>
  savedModels: LiveList<SavedModel>
}

export const client = createClient({
  publicApiKey: import.meta.env.VITE_LIVEBLOCKS_PUBLIC_KEY,
})

export const {
  RoomProvider,
  useMyPresence,
  useOthers,
  useStorage,
  useMutation,
  useStatus,
} = createRoomContext<Presence, Storage>(client)

// no helper yet

