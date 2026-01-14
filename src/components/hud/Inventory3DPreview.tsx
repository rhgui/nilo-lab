import { useEffect, useRef } from "react"
import * as THREE from "three"
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js"
import styles from "./hud.module.css"

export type Inventory3DPreviewProps = {
  itemId: string
  size?: number
  modelUrl?: string | null
}

export default function Inventory3DPreview({ itemId, size = 40, modelUrl }: Inventory3DPreviewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const sceneRef = useRef<THREE.Scene | null>(null)
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null)
  const meshRef = useRef<THREE.Mesh | THREE.Group | null>(null)

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

    const light1 = new THREE.DirectionalLight(0xffffff, 0.8)
    light1.position.set(1, 1, 1)
    scene.add(light1)
    const light2 = new THREE.AmbientLight(0xffffff, 0.3)
    scene.add(light2)

    // If it's a community model with a URL, load the GLB
    if (modelUrl && itemId.startsWith("community-")) {
      const loader = new GLTFLoader()
      const isMeshyUrl = modelUrl.includes('assets.meshy.ai')
      const loadUrl = isMeshyUrl ? `/api/meshy/proxy?url=${encodeURIComponent(modelUrl)}` : modelUrl
      
      loader.load(
        loadUrl,
        (gltf) => {
          if (!sceneRef.current) return
          const model = gltf.scene
          
          // Scale and center the model
          const bbox = new THREE.Box3().setFromObject(model)
          const center = bbox.getCenter(new THREE.Vector3())
          const size = bbox.getSize(new THREE.Vector3())
          const maxDim = Math.max(size.x, size.y, size.z)
          const scale = 1.5 / maxDim
          
          model.scale.set(scale, scale, scale)
          model.position.set(-center.x * scale, -center.y * scale, -center.z * scale)
          scene.add(model)
          meshRef.current = model
          
          // Render once
          renderer.render(scene, camera)
        },
        undefined,
        (error) => {
          console.error("Failed to load inventory preview model:", error)
        }
      )
    } else {
      // Use regular geometry for cube/sphere
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

      // Render once, no animation
      renderer.render(scene, camera)
    }

    return () => {
      if (container && renderer.domElement) {
        container.removeChild(renderer.domElement)
      }
      if (meshRef.current) {
        if (meshRef.current instanceof THREE.Mesh) {
          meshRef.current.geometry.dispose()
          const mat = meshRef.current.material
          if (mat instanceof THREE.Material) {
            mat.dispose()
          }
        } else if (meshRef.current instanceof THREE.Group) {
          meshRef.current.traverse((child) => {
            if (child instanceof THREE.Mesh) {
              child.geometry.dispose()
              if (Array.isArray(child.material)) {
                child.material.forEach((m) => m.dispose())
              } else {
                child.material.dispose()
              }
            }
          })
        }
      }
      renderer.dispose()
      sceneRef.current = null
      rendererRef.current = null
      meshRef.current = null
    }
  }, [itemId, size, modelUrl])

  if (itemId === "empty") {
    return <div className={styles.inventoryPreviewEmpty} />
  }

  return <div ref={containerRef} className={styles.inventoryPreview3D} />
}
