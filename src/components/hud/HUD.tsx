import { useEffect, useMemo, useState } from "react"
import { HoldKeyTracker } from "../../input/HoldKeyTracker"
import { MousePositionTracker } from "../../input/MousePositionTracker"
import styles from "./hud.module.css"
import CustomCursor from "./CustomCursor"
import PromptModal from "./PromptModal"

const MENU_KEY_CODE = "KeyQ"

function formatKey(code: string) {
  if (code.startsWith("Key")) return code.slice(3)
  return code
}

const tools = [
  { id: "skybox", label: "Create Skybox", angle: 180 },
  { id: "place", label: "Place Object", angle: 0 },
]

export type HUDProps = {
  onUiBlockingChange?: (blocking: boolean) => void
}

export default function HUD({ onUiBlockingChange }: HUDProps) {
  const [menuHeld, setMenuHeld] = useState(false)
  const [hoveredTool, setHoveredTool] = useState<string | null>(null)
  const [selectedTool, setSelectedTool] = useState<string | null>(null)
  const [mouse, setMouse] = useState({ x: 0, y: 0 })
  const [skyboxPromptOpen, setSkyboxPromptOpen] = useState(false)

  const menuKey = useMemo(() => ({ code: MENU_KEY_CODE, label: formatKey(MENU_KEY_CODE) }), [])

  useEffect(() => {
    const tracker = new HoldKeyTracker({ code: menuKey.code })
    const unsub = tracker.subscribe(setMenuHeld)
    return () => {
      unsub()
      tracker.dispose()
    }
  }, [menuKey.code])

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
    onUiBlockingChange?.(skyboxPromptOpen)
    if (skyboxPromptOpen && document.pointerLockElement) document.exitPointerLock()
  }, [onUiBlockingChange, skyboxPromptOpen])

  const handleToolClick = (toolId: string) => {
    setSelectedTool(toolId)
    if (toolId === "skybox") setSkyboxPromptOpen(true)
  }

  return (
    <div className={styles.hud}>
      <div className={styles.panel}>
        <div className={styles.title}>Controls</div>
        <div className={styles.row}>
          <span className={styles.key}>WASD</span>
          <span className={styles.text}>Move</span>
        </div>
        <div className={styles.row}>
          <span className={styles.key}>Mouse</span>
          <span className={styles.text}>Look (click canvas to lock)</span>
        </div>
        <div className={styles.row}>
          <span className={styles.key}>Hold {menuKey.label}</span>
          <span className={styles.text}>Radial menu</span>
        </div>
      </div>

      {selectedTool && (
        <div className={styles.selectedTool}>
          <span>{tools.find(t => t.id === selectedTool)?.label}</span>
        </div>
      )}

      {menuHeld && (
        <div className={styles.radialWrap}>
          <div className={styles.radial} role="menu" aria-label="Radial menu">
            <div className={styles.centerDot} />
            
            {tools.map((tool) => {
              const radius = 150
              const angleRad = (tool.angle * Math.PI) / 180
              const x = Math.cos(angleRad) * radius
              const y = Math.sin(angleRad) * radius

              return (
                <button
                  key={tool.id}
                  className={styles.toolButton}
                  style={{
                    transform: `translate(calc(-50% + ${x}px), calc(-50% + ${y}px))`,
                  }}
                  onClick={() => handleToolClick(tool.id)}
                  onMouseEnter={() => setHoveredTool(tool.id)}
                  onMouseLeave={() => setHoveredTool(null)}
                  type="button"
                >
                  {tool.label}
                </button>
              )
            })}

            <div className={styles.centerHint}>Hold {menuKey.label}</div>
          </div>
          <CustomCursor x={mouse.x} y={mouse.y} variant={hoveredTool ? "hover" : "default"} />
        </div>
      )}

      <PromptModal
        isOpen={skyboxPromptOpen}
        onClose={() => setSkyboxPromptOpen(false)}
        onSubmit={(prompt) => {
          // TODO: hook into skybox generation pipeline
          console.log("Skybox prompt:", prompt)
        }}
      />
    </div>
  )
}