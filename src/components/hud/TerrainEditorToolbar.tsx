import { useEffect, useRef } from "react"
import styles from "./hud.module.css"
import { Paintbrush, ArrowUp, ArrowDown, Eraser, RotateCcw, Move, Waves, Palette } from "lucide-react"

export type TerrainTool = "move" | "paint" | "raise" | "lower" | "erase" | "reset" | "smooth"

export type TerrainEditorToolbarProps = {
  selectedTool: TerrainTool
  onToolChange: (tool: TerrainTool) => void
  selectedColor?: number
  onColorChange?: (color: number) => void
  disabled?: boolean
}

const TERRAIN_COLORS = [
  0x4aa3ff, // Blue
  0x58f287, // Green
  0xff6b6b, // Red
  0xffd93d, // Yellow
  0x9b59b6, // Purple
  0xff8c42, // Orange
  0x1abc9c, // Teal
  0xe74c3c, // Dark Red
]

export default function TerrainEditorToolbar({ selectedTool, onToolChange, selectedColor = TERRAIN_COLORS[0], onColorChange, disabled = false }: TerrainEditorToolbarProps) {
  const colorInputRef = useRef<HTMLInputElement>(null)
  
  // Convert selectedColor (number) to hex string for the color input
  const selectedColorHex = `#${selectedColor.toString(16).padStart(6, '0')}`
  const isCustomColor = !TERRAIN_COLORS.includes(selectedColor)
  
  useEffect(() => {
    if (disabled) return
    const onKeyDown = (e: KeyboardEvent) => {
      // Number keys 1-7 for terrain tools
      if (e.code === "Digit1") {
        onToolChange("move")
      } else if (e.code === "Digit2") {
        onToolChange("paint")
      } else if (e.code === "Digit3") {
        onToolChange("raise")
      } else if (e.code === "Digit4") {
        onToolChange("lower")
      } else if (e.code === "Digit5") {
        onToolChange("erase")
      } else if (e.code === "Digit6") {
        onToolChange("smooth")
      } else if (e.code === "Digit7") {
        onToolChange("reset")
      } 
    }

    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [disabled, onToolChange])

  const tools: Array<{ id: TerrainTool; label: string; icon: typeof Move }> = [
    { id: "move", label: "Move", icon: Move },
    { id: "paint", label: "Paint", icon: Paintbrush },
    { id: "raise", label: "Raise", icon: ArrowUp },
    { id: "lower", label: "Lower", icon: ArrowDown },
    { id: "erase", label: "Erase", icon: Eraser },
    { id: "smooth", label: "Smooth", icon: Waves },
    { id: "reset", label: "Reset", icon: RotateCcw },
  ]
  

  return (
    <>
      <div className={styles.inventoryToolbar} style={{ opacity: disabled ? 0.5 : 1, pointerEvents: disabled ? "none" : "auto" }}>
        {tools.map((tool, index) => {
          const isSelected = selectedTool === tool.id
          
          return (
            <div
              key={tool.id}
              className={`${styles.inventorySlot} ${isSelected ? styles.inventorySlotSelected : ""}`}
              onClick={() => {
                if (!disabled) {
                  onToolChange(tool.id)
                }
              }}
              style={{ 
                cursor: disabled ? "not-allowed" : "pointer", 
                pointerEvents: disabled ? "none" : "auto",
                position: "relative" as const
              }}
              title={`${tool.label} (${index + 1})`}
            >
              <div className={styles.inventorySlotNumber}>{index + 1}</div>
              <div className={styles.inventoryPreviewContainer} style={{ display: "flex", flexDirection: "column", gap: "4px", alignItems: "center", justifyContent: "center" }}>
                <tool.icon size={18} strokeWidth={2} style={{ color: "rgba(255, 255, 255, 0.9)" }} />
                <span className={styles.inventorySlotLabel}>{tool.label}</span>
              </div>
            </div>
          )
        })}
      </div>
      
      <style>{`
        @keyframes pulseGlow {
          0%, 100% {
            box-shadow: 0 0 10px rgba(88, 242, 135, 0.6), 0 0 20px rgba(88, 242, 135, 0.4);
            border-color: rgba(88, 242, 135, 0.8);
          }
          50% {
            box-shadow: 0 0 20px rgba(88, 242, 135, 0.8), 0 0 30px rgba(88, 242, 135, 0.6);
            border-color: rgba(88, 242, 135, 1);
          }
        }
      `}</style>
      {/* Color picker - only show for paint tool */}
      {selectedTool === "paint" && (
        <div style={{
          position: "absolute",
          right: "20px",
          top: "50%",
          transform: "translateY(-50%)",
          display: "flex",
          flexDirection: "column",
          gap: "12px",
          alignItems: "center",
          pointerEvents: disabled ? "none" : "auto"
        }}>
          {TERRAIN_COLORS.map((color, index) => {
            const colorHex = `#${color.toString(16).padStart(6, '0')}`
            const isSelected = selectedColor === color
            return (
              <button
                key={color}
                onClick={() => !disabled && onColorChange?.(color)}
                disabled={disabled}
                style={{
                  width: "40px",
                  height: "40px",
                  borderRadius: "50%",
                  backgroundColor: colorHex,
                  border: isSelected ? "3px solid rgba(88, 242, 135, 0.8)" : "2px solid rgba(255, 255, 255, 0.3)",
                  cursor: disabled ? "not-allowed" : "pointer",
                  boxShadow: isSelected 
                    ? "0 0 0 2px rgba(88, 242, 135, 0.4), 0 4px 12px rgba(0, 0, 0, 0.3)"
                    : "0 2px 8px rgba(0, 0, 0, 0.2)",
                  transition: "all 0.2s ease",
                  outline: "none"
                }}
                title={`Color ${index + 1}`}
              />
            )
          })}
          {/* Custom color picker button */}
          <div style={{ position: "relative" }}>
            <button
              onClick={() => {
                if (!disabled && colorInputRef.current) {
                  colorInputRef.current.click()
                }
              }}
              disabled={disabled}
              style={{
                width: "40px",
                height: "40px",
                borderRadius: "50%",
                backgroundColor: selectedColorHex,
                border: isCustomColor 
                  ? "3px solid rgba(88, 242, 135, 0.8)" 
                  : "2px solid rgba(255, 255, 255, 0.3)",
                cursor: disabled ? "not-allowed" : "pointer",
                boxShadow: isCustomColor
                  ? "0 0 0 2px rgba(88, 242, 135, 0.4), 0 4px 12px rgba(0, 0, 0, 0.3)"
                  : "0 2px 8px rgba(0, 0, 0, 0.2)",
                transition: "all 0.2s ease",
                outline: "none",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                position: "relative"
              }}
              title="Custom Color"
            >
              <Palette size={18} style={{ color: "rgba(255, 255, 255, 0.9)" }} />
            </button>
            <input
              ref={colorInputRef}
              type="color"
              value={selectedColorHex}
              onChange={(e) => {
                const newColor = e.target.value
                // Convert hex to number (remove # and parse as hex)
                const colorNum = parseInt(newColor.replace('#', ''), 16)
                onColorChange?.(colorNum)
              }}
              style={{
                position: "absolute",
                opacity: 0,
                width: 0,
                height: 0,
                pointerEvents: "none"
              }}
            />
          </div>
        </div>
      )}
    </>
  )
}
