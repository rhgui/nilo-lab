import { useEffect, useRef, useState } from "react"
import styles from "./promptModal.module.css"

interface PromptModalProps {
  isOpen: boolean
  onClose: () => void
  onSubmit: (prompt: string) => void
}

export default function PromptModal({ isOpen, onClose, onSubmit }: PromptModalProps) {
  const [prompt, setPrompt] = useState("")
  const inputRef = useRef<HTMLInputElement | null>(null)

  if (!isOpen) return null

  useEffect(() => {
    // Esc closes the modal and returns control to the game.
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === "Escape") onClose()
      if (e.code === "Enter") {
        e.preventDefault()
        handleSubmit()
      }
    }

    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen])

  useEffect(() => {
    // Focus the input when opening.
    inputRef.current?.focus()
  }, [])

  const handleSubmit = () => {
    if (prompt.trim()) {
      onSubmit(prompt)
      setPrompt("")
      onClose()
    }
  }

  return (
    <div className={styles.backdrop} onMouseDown={onClose} role="dialog" aria-modal="true">
      <div className={styles.modal} onMouseDown={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <div className={styles.title}>Generate Skybox</div>
          <button className={styles.close} type="button" onClick={onClose} aria-label="Close">
            Esc
          </button>
        </div>

        <div className={styles.inputRow}>
          <input
            ref={inputRef}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="make a house..."
            className={styles.input}
          />
          <button
            type="button"
            className={styles.send}
            onClick={handleSubmit}
            disabled={!prompt.trim()}
            aria-label="Generate"
          >
            →
          </button>
        </div>

        <div className={styles.hint}>Press Enter to generate • Esc to close</div>
      </div>
    </div>
  )
}