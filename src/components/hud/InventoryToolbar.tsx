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
}

export default function InventoryToolbar({ items, selectedIndex, onSelectedChange, disabled = false }: InventoryToolbarProps) {
  useEffect(() => {
    if (disabled) return
    const onKeyDown = (e: KeyboardEvent) => {
      // Number keys 1, 2, 3 for inventory slots
      if (e.code === "Digit1" && items.length > 0) {
        onSelectedChange(0)
      } else if (e.code === "Digit2" && items.length > 1) {
        onSelectedChange(1)
      } else if (e.code === "Digit3" && items.length > 2) {
        onSelectedChange(2)
      }
    }

    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [items.length, onSelectedChange, disabled])

  if (items.length === 0) return null

  return (
    <div className={styles.inventoryToolbar}>
      {items.map((item, idx) => (
        <div
          key={item.id}
          className={`${styles.inventorySlot} ${idx === selectedIndex ? styles.inventorySlotSelected : ""}`}
        >
          <div className={styles.inventorySlotNumber}>{idx + 1}</div>
          <div className={styles.inventoryPreviewContainer}>
            <Inventory3DPreview itemId={item.id} size={48} />
          </div>
        </div>
      ))}
    </div>
  )
}
