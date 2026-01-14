import { useEffect, useRef, useState } from "react"
import styles from "./promptModal.module.css"

interface PromptModalProps {
  isOpen: boolean
  onClose: () => void
  onSubmit: (prompt: string, aiModel?: 'nano-banana' | 'nano-banana-pro') => void | Promise<void>
  isLoading?: boolean
  generationStatus?: string
  showModelSelection?: boolean
}

export default function PromptModal({ isOpen, onClose, onSubmit, isLoading, generationStatus, showModelSelection = false }: PromptModalProps) {
  const [prompt, setPrompt] = useState("")
  const [selectedModel, setSelectedModel] = useState<'nano-banana' | 'nano-banana-pro'>('nano-banana')
  const inputRef = useRef<HTMLInputElement | null>(null)

  const handleSubmit = () => {
    // Get prompt directly from input to avoid state sync issues
    const inputValue = inputRef.current?.value || prompt
    const trimmedPrompt = inputValue.trim()
    
    if (!trimmedPrompt) {
      console.log("[PromptModal] handleSubmit called but prompt is empty")
      return
    }
    
    console.log("[PromptModal] handleSubmit called with prompt:", trimmedPrompt, "(length:", trimmedPrompt.length, ")")
    
    // Clear input immediately to prevent double-submission
    setPrompt("")
    if (inputRef.current) {
      inputRef.current.value = ""
    }
    
    // Call onSubmit without awaiting to prevent blocking
    // The parent component will handle the async operation
    try {
      const result = onSubmit(trimmedPrompt, showModelSelection ? selectedModel : undefined)
      if (result instanceof Promise) {
        // Don't await - let it run in background to prevent UI freeze
        result.catch((error) => {
          console.error("[PromptModal] Error in onSubmit promise:", error)
        })
      }
    } catch (error) {
      console.error("[PromptModal] Error in onSubmit (sync):", error)
      // Don't re-throw - let parent handle errors
    }
  }

  useEffect(() => {
    if (!isOpen) return

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
    // handleSubmit is defined above and stable for the lifetime of an open modal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, onClose])

  useEffect(() => {
    if (!isOpen) {
      // Reset prompt when modal closes
      setPrompt("")
      if (inputRef.current) {
        inputRef.current.value = ""
      }
      return
    }
    // Focus the input when opening.
    inputRef.current?.focus()
  }, [isOpen])

  if (!isOpen) return null

  return (
    <div className={styles.backdrop} onMouseDown={(e) => {
      if (!isLoading && e.target === e.currentTarget) {
        onClose()
      }
    }} role="dialog" aria-modal="true">
      <div className={styles.modal} onMouseDown={(e) => e.stopPropagation()}>
        {isLoading && generationStatus && (
          <div style={{ 
            marginBottom: "16px", 
            padding: "12px", 
            background: "rgba(88, 242, 135, 0.1)", 
            border: "1px solid rgba(88, 242, 135, 0.3)", 
            borderRadius: "8px",
            color: "rgba(255, 255, 255, 0.9)",
            fontSize: "14px"
          }}>
            {generationStatus}
          </div>
        )}
        {showModelSelection && (
          <div 
            style={{ 
              marginBottom: "16px", 
              display: "flex", 
              gap: "8px",
              pointerEvents: "auto",
              position: "relative",
              zIndex: 10
            }}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
                onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                setSelectedModel('nano-banana')
              }}
              onMouseDown={(e) => {
                e.preventDefault()
                e.stopPropagation()
              }}
              disabled={isLoading}
              style={{
                flex: 1,
                padding: "8px 16px",
                background: selectedModel === 'nano-banana' ? "rgba(74, 163, 255, 0.2)" : "transparent",
                border: selectedModel === 'nano-banana' ? "1px solid rgba(74, 163, 255, 0.5)" : "1px solid rgba(255, 255, 255, 0.18)",
                borderRadius: "6px",
                color: "rgba(255, 255, 255, 0.9)",
                cursor: isLoading ? "not-allowed" : "pointer",
                fontSize: "14px",
                outline: "none",
                pointerEvents: "auto",
                position: "relative",
                zIndex: 10
              }}
            >
              nano-banana
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                setSelectedModel('nano-banana-pro')
              }}
              onMouseDown={(e) => {
                e.preventDefault()
                e.stopPropagation()
              }}
              disabled={isLoading}
              style={{
                flex: 1,
                padding: "8px 16px",
                background: selectedModel === 'nano-banana-pro' ? "rgba(74, 163, 255, 0.2)" : "transparent",
                border: selectedModel === 'nano-banana-pro' ? "1px solid rgba(74, 163, 255, 0.5)" : "1px solid rgba(255, 255, 255, 0.18)",
                borderRadius: "6px",
                color: "rgba(255, 255, 255, 0.9)",
                cursor: isLoading ? "not-allowed" : "pointer",
                fontSize: "14px",
                outline: "none",
                pointerEvents: "auto",
                position: "relative",
                zIndex: 10
              }}
            >
              nano-banana-pro
            </button>
          </div>
        )}
        <div 
          className={styles.inputRow}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          <input
            ref={inputRef}
            value={prompt}
            onChange={(e) => {
              const newValue = e.target.value
              setPrompt(newValue)
              // Also update ref value directly to ensure it's always in sync
              if (inputRef.current) {
                inputRef.current.value = newValue
              }
            }}
            placeholder="a vibrant sunset over snowy mountains..."
            className={styles.input}
            disabled={isLoading}
          />
          <button
            type="button"
            className={styles.send}
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              handleSubmit()
            }}
            onMouseDown={(e) => {
              e.preventDefault()
              e.stopPropagation()
            }}
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