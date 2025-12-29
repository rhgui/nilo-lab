import { useEffect, useRef } from "react"
import * as THREE from "three"
import styles from "./hud.module.css"

export type Inventory3DPreviewProps = {
  itemId: string
  size?: number
}

export default function Inventory3DPreview({ itemId, size = 40 }: Inventory3DPreviewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const sceneRef = useRef<THREE.Scene | null>(null)
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null)
  const meshRef = useRef<THREE.Mesh | null>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container || itemId === "empty") return

    const scene = new THREE.Scene()
    sceneRef.current = scene

    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100)
    camera.position.set(0, 0, 2)

    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true })
    renderer.setSize(size, size)
    renderer.setPixelRatio(window.devicePixelRatio)
    container.appendChild(renderer.domElement)
    rendererRef.current = renderer

    let geometry: THREE.BufferGeometry
    if (itemId === "cube") {
      geometry = new THREE.BoxGeometry(1, 1, 1)
    } else if (itemId === "sphere") {
      geometry = new THREE.SphereGeometry(0.5, 16, 16)
    } else {
      geometry = new THREE.BoxGeometry(1, 1, 1)
    }

    const material = new THREE.MeshStandardMaterial({
      color: 0x4aa3ff,
      roughness: 0.4,
      metalness: 0.0,
    })
    const mesh = new THREE.Mesh(geometry, material)
    scene.add(mesh)
    meshRef.current = mesh

    const light1 = new THREE.DirectionalLight(0xffffff, 0.8)
    light1.position.set(1, 1, 1)
    scene.add(light1)
    const light2 = new THREE.AmbientLight(0xffffff, 0.3)
    scene.add(light2)

    // Render once, no animation
    renderer.render(scene, camera)

    return () => {
      if (container && renderer.domElement) {
        container.removeChild(renderer.domElement)
      }
      geometry.dispose()
      material.dispose()
      renderer.dispose()
      sceneRef.current = null
      rendererRef.current = null
      meshRef.current = null
    }
  }, [itemId, size])

  if (itemId === "empty") {
    return <div className={styles.inventoryPreviewEmpty} />
  }

  return <div ref={containerRef} className={styles.inventoryPreview3D} />
}
