import { useEffect, useMemo, useState } from "react"
import { HoldKeyTracker } from "../../input/HoldKeyTracker"
import { MousePositionTracker } from "../../input/MousePositionTracker"
import styles from "./hud.module.css"
import CustomCursor from "./CustomCursor"
import PromptModal from "./PromptModal"
import { generateSkyboxImage } from "../../services/falSkybox"

const MENU_KEY_CODE = "ShiftLeft"
// controls toggle key code
const CONTROLS_TOGGLE_KEY_CODE = "ControlLeft"

function formatKey(code: string) {
  if (code.startsWith("Key")) return code.slice(3)
  if (code === "ShiftLeft" || code === "ShiftRight") return "Shift"
  return code
}

const tools = [
  { id: "skybox", label: "Create Skybox", angle: 180 },
  { id: "place", label: "Place Object", angle: 0 },
]

export type HUDProps = {
  onUiBlockingChange?: (blocking: boolean) => void
  onSkyboxUrlChange?: (url: string) => void
}

export default function HUD({ onUiBlockingChange, onSkyboxUrlChange }: HUDProps) {
  const [menuHeld, setMenuHeld] = useState(false)
  const [hoveredTool, setHoveredTool] = useState<string | null>(null)
  const [mouse, setMouse] = useState({ x: 0, y: 0 })
  const [skyboxPromptOpen, setSkyboxPromptOpen] = useState(false)
  const [skyboxLoading, setSkyboxLoading] = useState(false)
  const [controlsVisible, setControlsVisible] = useState(true)
  const [actionLog, setActionLog] = useState<Array<{ label: string; time: Date }>>([])

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
    onUiBlockingChange?.(skyboxPromptOpen)
    if (skyboxPromptOpen && document.pointerLockElement) document.exitPointerLock()
  }, [onUiBlockingChange, skyboxPromptOpen])

  const pushAction = (label: string) => {
    setActionLog((prev) => {
      const next = [{ label, time: new Date() }, ...prev]
      return next.slice(0, 5)
    })
  }

  const formatTime = (d: Date) =>
    d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })

  const handleToolClick = (toolId: string) => {
    const tool = tools.find((t) => t.id === toolId)
    if (tool) pushAction(tool.label)
    if (toolId === "skybox") setSkyboxPromptOpen(true)
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
          </>
        )}
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
        isLoading={skyboxLoading}
        onSubmit={async (prompt) => {
          // Close immediately after sending; generation continues in the background.
          setSkyboxPromptOpen(false)
          try {
            setSkyboxLoading(true)
            pushAction("Generating skybox…")
            const { imageUrl } = await generateSkyboxImage({ prompt })
            onSkyboxUrlChange?.(imageUrl)
            pushAction("Skybox updated")
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err)
            pushAction(`Skybox failed: ${msg}`)
            console.error(err)
          } finally {
            setSkyboxLoading(false)
          }
        }}
      />
    </div>
  )
}