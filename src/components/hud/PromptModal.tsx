import { useEffect, useRef, useState } from "react"
import styles from "./promptModal.module.css"

interface PromptModalProps {
  isOpen: boolean
  onClose: () => void
  onSubmit: (prompt: string) => void | Promise<void>
  isLoading?: boolean
}

export default function PromptModal({ isOpen, onClose, onSubmit, isLoading }: PromptModalProps) {
  const [prompt, setPrompt] = useState("")
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (!isOpen) return

    // Esc closes the modal and returns control to the game.
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === "Escape") onClose()
      if (e.code === "Enter") {
        e.preventDefault()
        void handleSubmit()
      }
    }

    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
    // handleSubmit is defined below but stable for the lifetime of an open modal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, onClose])

  useEffect(() => {
    if (!isOpen) return
    // Focus the input when opening.
    inputRef.current?.focus()
  }, [isOpen])

  const handleSubmit = () => {
    if (prompt.trim()) {
      const p = prompt
      setPrompt("")
      return onSubmit(p)
    }
  }

  if (!isOpen) return null

  return (
    <div className={styles.backdrop} onMouseDown={onClose} role="dialog" aria-modal="true">
      <div className={styles.modal} onMouseDown={(e) => e.stopPropagation()}>
        <div className={styles.inputRow}>
          <input
            ref={inputRef}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="a vibrant sunset over snowy mountains..."
            className={styles.input}
          />
          <button
            type="button"
            className={styles.send}
            onClick={() => void handleSubmit()}
            disabled={isLoading || !prompt.trim()}
            aria-label="Generate"
          >
            →
          </button>
        </div>
      </div>
    </div>
  )
}