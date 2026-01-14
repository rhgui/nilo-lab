import { useEffect } from "react"
import styles from "./hud.module.css"
import Inventory3DPreview from "./Inventory3DPreview"

export type InventoryItem = {
  id: string
  label: string
}

export type InventoryToolbarProps = {
  items: InventoryItem[]
  selectedIndex: number
  onSelectedChange: (index: number) => void
  disabled?: boolean
  modelUrls?: Map<string, string>
}

export default function InventoryToolbar({ items, selectedIndex, onSelectedChange, disabled = false, modelUrls }: InventoryToolbarProps) {
  useEffect(() => {
    if (disabled) return
    const onKeyDown = (e: KeyboardEvent) => {
      // Number keys 1, 2, 3 for default inventory slots (empty, cube, sphere)
      if (e.code === "Digit1" && items.length > 0) {
        onSelectedChange(0)
      } else if (e.code === "Digit2" && items.length > 1) {
        onSelectedChange(1)
      } else if (e.code === "Digit3" && items.length > 2) {
        onSelectedChange(2)
      } else if (e.code === "Digit4") {
        // Digit4 cycles through community items only
        const communityIndices = items
          .map((item, idx) => item.id.startsWith("community-") ? idx : -1)
          .filter(idx => idx !== -1)
        
        if (communityIndices.length === 0) {
          // No community items, do nothing
          return
        }
        
        // Find current position in community items
        const currentCommunityIndex = communityIndices.indexOf(selectedIndex)
        
        if (currentCommunityIndex === -1) {
          // Currently on a non-community item, go to first community item
          onSelectedChange(communityIndices[0])
        } else {
          // Cycle to next community item
          const nextIndex = (currentCommunityIndex + 1) % communityIndices.length
          onSelectedChange(communityIndices[nextIndex])
        }
      }
    }

    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [items, selectedIndex, onSelectedChange, disabled])

  if (items.length === 0) return null

  // Separate default items (0-2) from community items (3+)
  const defaultItems = items.slice(0, 3)
  const communityItems = items.slice(3)

  return (
    <div className={styles.inventoryToolbar}>
      {defaultItems.map((item, idx) => (
        <div
          key={item.id}
          className={`${styles.inventorySlot} ${idx === selectedIndex ? styles.inventorySlotSelected : ""}`}
        >
          <div className={styles.inventorySlotNumber}>{idx + 1}</div>
          <div className={styles.inventoryPreviewContainer}>
            <Inventory3DPreview itemId={item.id} size={48} modelUrl={modelUrls?.get(item.id) || null} />
          </div>
        </div>
      ))}
      {communityItems.length > 0 && (
        <>
          <div className={styles.inventoryToolbarSpacer} />
          {communityItems.map((item, idx) => {
            const actualIdx = idx + 3
            return (
              <div
                key={item.id}
                className={`${styles.inventorySlot} ${actualIdx === selectedIndex ? styles.inventorySlotSelected : ""}`}
              >
                <div className={styles.inventorySlotNumber}>4</div>
                <div className={styles.inventoryPreviewContainer}>
                  <Inventory3DPreview itemId={item.id} size={48} modelUrl={modelUrls?.get(item.id) || null} />
                </div>
              </div>
            )
          })}
        </>
      )}
    </div>
  )
}
