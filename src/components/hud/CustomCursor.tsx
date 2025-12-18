import styles from "./hud.module.css"

export type CustomCursorProps = {
  x: number
  y: number
  variant: "default" | "hover"
}

export default function CustomCursor({ x, y, variant }: CustomCursorProps) {
  const cls = variant === "hover" ? styles.cursorHover : styles.cursorDefault

  return (
    <div
      className={`${styles.cursor} ${cls}`}
      style={{ transform: `translate(${x}px, ${y}px)` }}
      aria-hidden
    />
  )
}
