import styles from "./loadingScreen.module.css"

export default function LoadingScreen({ message = "Connecting to server..." }: { message?: string }) {
  return (
    <div className={styles.backdrop}>
      <div className={styles.container}>
        <div className={styles.spinner}></div>
        <p className={styles.message}>{message}</p>
      </div>
    </div>
  )
}

