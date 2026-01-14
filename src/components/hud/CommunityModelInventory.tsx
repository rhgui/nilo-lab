import { useEffect, useRef } from "react"
import { Trash2 } from "lucide-react"
import styles from "./promptModal.module.css"

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

interface CommunityModelInventoryProps {
  isOpen: boolean
  onClose: () => void
  onSelect: (model: SavedModel) => void
  onDelete?: (modelUrl: string) => void
  models: SavedModel[]
}

export default function CommunityModelInventory({ isOpen, onClose, onSelect, onDelete, models }: CommunityModelInventoryProps) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!isOpen) return

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === "Escape") onClose()
    }

    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [isOpen, onClose])

  if (!isOpen) return null

  return (
    <div className={styles.backdrop} onMouseDown={(e) => {
      // Only close if clicking directly on backdrop, not on modal content
      if (e.target === e.currentTarget) {
        onClose()
      }
    }} role="dialog" aria-modal="true">
      <div className={styles.modal} onMouseDown={(e) => e.stopPropagation()} ref={containerRef} style={{ maxWidth: "1200px", maxHeight: "90vh", overflowY: "auto", overflowX: "hidden", width: "90vw", pointerEvents: "auto" }} data-scrollbar-styled>
        <h2 style={{ marginTop: 0, marginBottom: "24px", color: "rgba(255, 255, 255, 0.95)", fontSize: "20px", fontWeight: 600 }}>
          Community Models
        </h2>
        {models.length === 0 ? (
          <div style={{ color: "rgba(255, 255, 255, 0.6)", textAlign: "center", padding: "40px" }}>
            No community models available yet
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: "16px" }}>
            {models.map((model, index) => (
              <div
                key={`${model.modelUrl}-${index}`}
                style={{
                  position: "relative",
                  padding: "16px",
                  background: "rgba(255, 255, 255, 0.08)",
                  border: "2px solid rgba(255, 255, 255, 0.18)",
                  borderRadius: "12px",
                  color: "rgba(255, 255, 255, 0.9)",
                  transition: "all 0.2s",
                  display: "flex",
                  flexDirection: "column",
                  gap: "12px",
                  pointerEvents: "auto",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "rgba(255, 255, 255, 0.12)"
                  e.currentTarget.style.borderColor = "rgba(255, 255, 255, 0.25)"
                  e.currentTarget.style.transform = "translateY(-2px)"
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "rgba(255, 255, 255, 0.08)"
                  e.currentTarget.style.borderColor = "rgba(255, 255, 255, 0.18)"
                  e.currentTarget.style.transform = "translateY(0)"
                }}
              >
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    onSelect(model)
                    onClose()
                  }}
                  onMouseDown={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                  }}
                  style={{
                    background: "none",
                    border: "none",
                    color: "rgba(255, 255, 255, 0.9)",
                    cursor: "pointer",
                    textAlign: "left",
                    padding: 0,
                    flex: 1,
                  }}
                >
                  <div style={{ fontSize: "15px", fontWeight: 600, marginBottom: "6px" }}>
                    {model.prompt}
                  </div>
                  <div style={{ fontSize: "12px", color: "rgba(255, 255, 255, 0.6)" }}>
                    {new Date(model.timestamp).toLocaleDateString()}
                  </div>
                </button>
                {onDelete && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      if (confirm(`Delete "${model.prompt}"?`)) {
                        onDelete(model.modelUrl)
                      }
                    }}
                    onMouseDown={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                    }}
                    style={{
                      position: "absolute",
                      top: "12px",
                      right: "12px",
                      background: "rgba(255, 107, 107, 0.2)",
                      border: "1px solid rgba(255, 107, 107, 0.4)",
                      borderRadius: "6px",
                      padding: "6px",
                      cursor: "pointer",
                      color: "rgba(255, 107, 107, 0.9)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      transition: "all 0.2s",
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = "rgba(255, 107, 107, 0.3)"
                      e.currentTarget.style.borderColor = "rgba(255, 107, 107, 0.6)"
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = "rgba(255, 107, 107, 0.2)"
                      e.currentTarget.style.borderColor = "rgba(255, 107, 107, 0.4)"
                    }}
                    title="Delete model"
                  >
                    <Trash2 size={16} />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
