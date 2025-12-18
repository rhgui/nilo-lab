import { useEffect, useRef, useState } from "react"
import styles from "./characterSetup.module.css"

export type CharacterSetupProps = {
  initialName?: string
  onConfirm: (name: string) => void
}

export default function CharacterSetup({ initialName, onConfirm }: CharacterSetupProps) {
  const [name, setName] = useState(initialName ?? "")
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const submit = () => {
    const n = name.trim()
    if (!n) return
    onConfirm(n)
  }

  return (
    <div className={styles.backdrop} role="dialog" aria-modal="true">
      <div className={styles.card}>
        <div className={styles.title}>Choose your name</div>
        <div className={styles.row}>
          <input
            ref={inputRef}
            className={styles.input}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit()
            }}
            placeholder="Your name..."
            maxLength={24}
          />
          <button className={styles.button} type="button" onClick={submit} disabled={!name.trim()}>
            Join
          </button>
        </div>
      </div>
    </div>
  )
}

