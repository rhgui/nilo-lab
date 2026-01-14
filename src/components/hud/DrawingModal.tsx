import { useEffect, useRef, useState } from "react"
import * as THREE from "three"
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js"
import { Pencil, Eraser } from "lucide-react"
import styles from "./promptModal.module.css"

interface DrawingModalProps {
  isOpen: boolean
  onClose: () => void
  onSubmit: (imageDataUrl: string, prompt: string) => void | Promise<void>
  isLoading?: boolean
  generationStatus?: string
  previewModelUrl?: string | null
}

type Step = "drawing" | "refining" | "generating"

export default function DrawingModal({ isOpen, onClose, onSubmit, isLoading, generationStatus, previewModelUrl }: DrawingModalProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const previewCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const [isDrawing, setIsDrawing] = useState(false)
  const [prompt, setPrompt] = useState("")
  const inputRef = useRef<HTMLInputElement | null>(null)
  
  // Image refinement state
  const [step, setStep] = useState<Step>("drawing")
  const [drawnImageUrl, setDrawnImageUrl] = useState<string | null>(null)
  const [refinedImageUrl, setRefinedImageUrl] = useState<string | null>(null)
  const [isRefining, setIsRefining] = useState(false)
  const [refinementStatus, setRefinementStatus] = useState("")
  const [selectedModel, setSelectedModel] = useState<"nano-banana" | "nano-banana-pro">("nano-banana")
  const [refinementPrompt, setRefinementPrompt] = useState("")
  
  // Refinement history (chat messages)
  const [refinementHistory, setRefinementHistory] = useState<Array<{
    type: "user" | "refined"
    prompt?: string
    imageUrl: string
    timestamp: number
  }>>([])
  
  // Drawing tools
  const [drawingMode, setDrawingMode] = useState<"pencil" | "eraser">("pencil")
  
  // Three.js scene refs
  const sceneRef = useRef<THREE.Scene | null>(null)
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null)
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null)
  const modelRef = useRef<THREE.Group | null>(null)
  const animationFrameRef = useRef<number | null>(null)

  // Initialize Three.js scene for preview - reinitialize when step changes to generating
  useEffect(() => {
    // Only initialize scene when modal is open, step is generating, and canvas exists
    if (!isOpen || step !== "generating" || !previewCanvasRef.current) {
      // Cleanup if step changes away from generating
      if (step !== "generating") {
        if (animationFrameRef.current) {
          cancelAnimationFrame(animationFrameRef.current)
          animationFrameRef.current = null
        }
        if (modelRef.current && sceneRef.current) {
          sceneRef.current.remove(modelRef.current)
          modelRef.current.traverse((child) => {
            if (child instanceof THREE.Mesh) {
              child.geometry.dispose()
              if (Array.isArray(child.material)) {
                child.material.forEach((m) => m.dispose())
              } else {
                child.material.dispose()
              }
            }
          })
          modelRef.current = null
        }
      }
      return
    }

    const canvas = previewCanvasRef.current
    if (!canvas) return
    
    console.log("[DrawingModal] Initializing 3D scene for preview")
    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x1a1a1a)
    
    const camera = new THREE.PerspectiveCamera(50, canvas.clientWidth / canvas.clientHeight, 0.1, 1000)
    camera.position.set(0, 0, 3)
    
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
    renderer.setSize(canvas.clientWidth, canvas.clientHeight)
    renderer.setPixelRatio(window.devicePixelRatio)
    
    // Add lights
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6)
    scene.add(ambientLight)
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8)
    directionalLight.position.set(5, 5, 5)
    scene.add(directionalLight)
    
    sceneRef.current = scene
    cameraRef.current = camera
    rendererRef.current = renderer
    
    console.log("[DrawingModal] Scene initialized, starting animation loop")
    
    // Animation loop
    const animate = () => {
      if (!sceneRef.current || !cameraRef.current || !rendererRef.current) return
      animationFrameRef.current = requestAnimationFrame(animate)
      
      // Rotate model if it exists
      if (modelRef.current) {
        modelRef.current.rotation.y += 0.01
      }
      
      rendererRef.current.render(sceneRef.current, cameraRef.current)
    }
    animate()
    
    return () => {
      console.log("[DrawingModal] Cleaning up scene")
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current)
        animationFrameRef.current = null
      }
      if (modelRef.current && sceneRef.current) {
        sceneRef.current.remove(modelRef.current)
        modelRef.current.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            child.geometry.dispose()
            if (Array.isArray(child.material)) {
              child.material.forEach((m) => m.dispose())
            } else {
              child.material.dispose()
            }
          }
        })
        modelRef.current = null
      }
      renderer.dispose()
      sceneRef.current = null
      cameraRef.current = null
      rendererRef.current = null
    }
  }, [isOpen, step])

  // Load model when previewModelUrl changes
  useEffect(() => {
    // Only load model when step is "generating" and modal is open
    if (!isOpen || step !== "generating" || !previewModelUrl) return
    
    // Wait for scene to be ready - use a small delay to ensure initialization completes
    const checkAndLoad = () => {
      if (!sceneRef.current || !cameraRef.current || !rendererRef.current) {
        // Scene not ready yet, retry after a short delay
        setTimeout(checkAndLoad, 50)
        return
      }
      
      // Clear existing model first
      if (modelRef.current) {
        sceneRef.current.remove(modelRef.current)
        modelRef.current.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            child.geometry.dispose()
            if (Array.isArray(child.material)) {
              child.material.forEach((m) => m.dispose())
            } else {
              child.material.dispose()
            }
          }
        })
        modelRef.current = null
      }
      
      console.log("[DrawingModal] Loading preview model:", previewModelUrl, "step:", step, "scene ready:", !!sceneRef.current)
      const loader = new GLTFLoader()
      const isMeshyUrl = previewModelUrl.includes('assets.meshy.ai')
      const loadUrl = isMeshyUrl ? `/api/meshy/proxy?url=${encodeURIComponent(previewModelUrl)}` : previewModelUrl
      
      loader.load(
        loadUrl,
        (gltf) => {
          if (!sceneRef.current || !isOpen || step !== "generating") {
            console.log("[DrawingModal] Model loaded but scene/step changed, skipping")
            return
          }
          
          console.log("[DrawingModal] Model loaded successfully, adding to scene")
          const model = gltf.scene.clone()
          
          // Scale and center the model
          const bbox = new THREE.Box3().setFromObject(model)
          const center = bbox.getCenter(new THREE.Vector3())
          const size = bbox.getSize(new THREE.Vector3())
          const maxDim = Math.max(size.x, size.y, size.z) || 1
          const scale = 2 / maxDim
          
          model.scale.set(scale, scale, scale)
          model.position.set(-center.x * scale, -center.y * scale, -center.z * scale)
          
          sceneRef.current.add(model)
          modelRef.current = model
          console.log("[DrawingModal] Model added to scene successfully")
        },
        undefined,
        (error) => {
          console.error("[DrawingModal] Failed to load preview model:", error)
        }
      )
    }
    
    // Start the check and load process
    checkAndLoad()
  }, [previewModelUrl, isOpen, step])

  // Handle window resize
  useEffect(() => {
    if (!isOpen) return
    
    const handleResize = () => {
      if (previewCanvasRef.current && cameraRef.current && rendererRef.current) {
        const canvas = previewCanvasRef.current
        cameraRef.current.aspect = canvas.clientWidth / canvas.clientHeight
        cameraRef.current.updateProjectionMatrix()
        rendererRef.current.setSize(canvas.clientWidth, canvas.clientHeight)
      }
    }
    
    window.addEventListener("resize", handleResize)
    return () => window.removeEventListener("resize", handleResize)
  }, [isOpen])

  // Reset state when modal closes
  useEffect(() => {
    if (!isOpen) {
      setStep("drawing")
      setDrawnImageUrl(null)
      setRefinedImageUrl(null)
      setIsRefining(false)
      setRefinementStatus("")
      setRefinementPrompt("")
      setPrompt("")
      setDrawingMode("pencil")
    }
  }, [isOpen])

  const handleRefineImage = async () => {
    // Use the latest refined image if available, otherwise use the original drawing
    let imageToRefine = refinedImageUrl || drawnImageUrl
    if (!imageToRefine || !refinementPrompt.trim()) return
    
    // If the refined image URL is a proxied URL, extract the original URL or convert to data URI
    if (imageToRefine.startsWith('/api/meshy/proxy') || imageToRefine.includes('/api/meshy/proxy')) {
      try {
        // Extract the original URL from the proxied URL
        const urlMatch = imageToRefine.match(/[?&]url=([^&]+)/)
        if (urlMatch && urlMatch[1]) {
          const originalUrl = decodeURIComponent(urlMatch[1])
          imageToRefine = originalUrl
        } else {
          // Fallback: fetch the image and convert to data URI
          const fullUrl = imageToRefine.startsWith('http') ? imageToRefine : `${window.location.origin}${imageToRefine}`
          const response = await fetch(fullUrl)
          const blob = await response.blob()
          const reader = new FileReader()
          imageToRefine = await new Promise<string>((resolve, reject) => {
            reader.onloadend = () => resolve(reader.result as string)
            reader.onerror = reject
            reader.readAsDataURL(blob)
          })
        }
      } catch (error) {
        console.error("[DrawingModal] Failed to convert proxied URL for refinement:", error)
        // Fallback to original drawing
        imageToRefine = drawnImageUrl || ""
        if (!imageToRefine) {
          setRefinementStatus("Error: No image available to refine")
          setIsRefining(false)
          return
        }
      }
    }
    
    setIsRefining(true)
    setRefinementStatus("Refining image...")
    
    try {
      // Create image-to-image task
      const response = await fetch("/api/meshy/image-to-image", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          reference_image_urls: [imageToRefine],
          prompt: refinementPrompt.trim(),
          ai_model: selectedModel,
        }),
      })
      
      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`Failed to refine image: ${errorText}`)
      }
      
      const data = await response.json()
      console.log("[Image-to-Image] Task created:", data.taskId)
      
      // Poll for completion
      let attempts = 0
      const maxAttempts = 120
      const pollInterval = 2000
      
      const pollStatus = async (): Promise<void> => {
        try {
          const statusResponse = await fetch(`/api/meshy/image-to-image/status/${encodeURIComponent(data.taskId)}`)
          if (!statusResponse.ok) {
            throw new Error("Failed to check status")
          }
          
          const statusData = await statusResponse.json()
          attempts++
          
          const progress = statusData.progress !== undefined && statusData.progress !== null 
            ? statusData.progress 
            : Math.min((attempts / maxAttempts) * 90, 90)
          
          if (statusData.status === "PENDING" || statusData.status === "IN_PROGRESS") {
            setRefinementStatus(`Refining image... ${Math.round(progress)}%`)
            if (attempts < maxAttempts) {
              setTimeout(pollStatus, pollInterval)
              return
            }
          } else if (statusData.status === "SUCCEEDED" || statusData.status === "completed") {
            if (statusData.imageUrl) {
              setRefinementStatus("Image refined!")
              // Store proxied URL for display - this becomes the new base for further refinements
              setRefinedImageUrl(statusData.imageUrl)
              setIsRefining(false)
              
              // Add to chat history: user prompt and refined image
              const currentImageToRefine = refinedImageUrl || drawnImageUrl
              setRefinementHistory(prev => [
                ...prev,
                {
                  type: "user",
                  prompt: refinementPrompt,
                  imageUrl: currentImageToRefine || "",
                  timestamp: Date.now()
                },
                {
                  type: "refined",
                  imageUrl: statusData.imageUrl,
                  timestamp: Date.now()
                }
              ])
              
              // Clear the prompt for next refinement
              setRefinementPrompt("")
              // Don't auto-proceed - let user click "Generate Model" when ready
              return
            }
            // Retry if no image URL yet
            if (attempts < maxAttempts) {
              setTimeout(pollStatus, pollInterval)
              return
            }
          } else if (statusData.status === "FAILED" || statusData.status === "failed") {
            throw new Error(statusData.error || "Image refinement failed")
          }
          
          if (attempts >= maxAttempts) {
            throw new Error("Image refinement timed out")
          }
        } catch (error) {
          console.error("[Image-to-Image] Error:", error)
          setRefinementStatus(`Error: ${error instanceof Error ? error.message : "Unknown error"}`)
          setIsRefining(false)
        }
      }
      
      await pollStatus()
    } catch (error) {
      console.error("[Image-to-Image] Error:", error)
      setRefinementStatus(`Error: ${error instanceof Error ? error.message : "Unknown error"}`)
      setIsRefining(false)
    }
  }

  const handleGoToRefine = () => {
    const canvas = canvasRef.current
    if (!canvas) return
    
    const imageDataUrl = canvas.toDataURL("image/png")
    if (!imageDataUrl) return
    
    // Store the drawn image and move to refinement step
    setDrawnImageUrl(imageDataUrl)
    setStep("refining")
    
    // Preserve refinement history when navigating back to refine
    // Only clear if there's no existing history (truly new drawing)
    // The history will be preserved from previous refinement sessions
    // Don't clear refinedImageUrl either - it should persist when navigating back
    
    setRefinementPrompt("")
  }

  const handleGenerateDirectly = async () => {
    const canvas = canvasRef.current
    if (!canvas) return
    
    const imageDataUrl = canvas.toDataURL("image/png")
    if (!imageDataUrl || !prompt.trim()) return
    
    // Store the drawn image and go directly to 3D generation
    setDrawnImageUrl(imageDataUrl)
    setStep("generating")
    await onSubmit(imageDataUrl, prompt)
  }

  const handleProceedTo3D = async (imageUrl?: string | null) => {
    // Use provided imageUrl, then refined image if available, otherwise use original drawing
    let imageToUse = imageUrl || refinedImageUrl || (canvasRef.current?.toDataURL("image/png") || "")
    if (!imageToUse) return
    
    // If the image URL is a proxied URL, we need to extract the original URL or convert to data URI
    // Proxied URLs look like: /api/meshy/proxy?url=...
    if (imageToUse.startsWith('/api/meshy/proxy') || imageToUse.includes('/api/meshy/proxy')) {
      try {
        // Extract the original URL from the proxied URL
        const urlMatch = imageToUse.match(/[?&]url=([^&]+)/)
        if (urlMatch && urlMatch[1]) {
          const originalUrl = decodeURIComponent(urlMatch[1])
          // Use the original Meshy CDN URL for the API (it accepts full HTTP URLs)
          imageToUse = originalUrl
        } else {
          // Fallback: fetch the image and convert to data URI
          const fullUrl = imageToUse.startsWith('http') ? imageToUse : `${window.location.origin}${imageToUse}`
          const response = await fetch(fullUrl)
          const blob = await response.blob()
          const reader = new FileReader()
          imageToUse = await new Promise<string>((resolve, reject) => {
            reader.onloadend = () => resolve(reader.result as string)
            reader.onerror = reject
            reader.readAsDataURL(blob)
          })
        }
      } catch (error) {
        console.error("[DrawingModal] Failed to convert proxied URL:", error)
        // Fallback to original drawing
        imageToUse = canvasRef.current?.toDataURL("image/png") || ""
        if (!imageToUse) {
          console.error("[DrawingModal] No fallback image available")
          return
        }
      }
    }
    
    setStep("generating")
    await onSubmit(imageToUse, refinementPrompt || prompt)
  }

  useEffect(() => {
    if (!isOpen) return

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === "Escape") onClose()
      if (e.code === "Enter" && e.ctrlKey) {
        e.preventDefault()
        if (step === "drawing") {
          void handleGenerateDirectly()
        } else if (step === "refining" && refinedImageUrl) {
          void handleProceedTo3D()
        }
      }
    }

    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [isOpen, step, refinedImageUrl, refinementPrompt, prompt])

  // Initialize canvas only when modal first opens (not when switching steps)
  const hasInitializedCanvas = useRef(false)
  
  useEffect(() => {
    if (!isOpen) {
      hasInitializedCanvas.current = false
      return
    }
    
    inputRef.current?.focus()
    
    // Only clear canvas on first open, not when switching steps
    if (!hasInitializedCanvas.current) {
      const canvas = canvasRef.current
      if (canvas) {
        const ctx = canvas.getContext("2d")
        if (ctx) {
          ctx.fillStyle = "white"
          ctx.fillRect(0, 0, canvas.width, canvas.height)
        }
      }
      hasInitializedCanvas.current = true
    }
  }, [isOpen])
  
  // Restore drawing when switching back to drawing step
  useEffect(() => {
    if (!isOpen || step !== "drawing" || !drawnImageUrl) return
    
    const canvas = canvasRef.current
    if (!canvas) return
    
    // Check if canvas is already showing the drawing (to avoid unnecessary redraws)
    const currentDataUrl = canvas.toDataURL("image/png")
    if (currentDataUrl === drawnImageUrl) return
    
    const img = new Image()
    img.onload = () => {
      const ctx = canvas.getContext("2d")
      if (!ctx) return
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      ctx.fillStyle = "white"
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    }
    img.src = drawnImageUrl
  }, [step, drawnImageUrl, isOpen])

  const getMousePos = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    if (!canvas) return { x: 0, y: 0 }
    const rect = canvas.getBoundingClientRect()
    const scaleX = canvas.width / rect.width
    const scaleY = canvas.height / rect.height
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY
    }
  }

  const startDrawing = (e: React.MouseEvent<HTMLCanvasElement>) => {
    e.preventDefault()
    e.stopPropagation()
    if (step !== "drawing") return
    setIsDrawing(true)
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return
    
    const pos = getMousePos(e)
    ctx.beginPath()
    ctx.moveTo(pos.x, pos.y)
    
    if (drawingMode === "eraser") {
      ctx.globalCompositeOperation = "destination-out"
      ctx.lineWidth = 20
    } else {
      ctx.globalCompositeOperation = "source-over"
      ctx.strokeStyle = "#000000"
      ctx.lineWidth = 4
    }
    ctx.lineCap = "round"
    ctx.lineJoin = "round"
  }

  const draw = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDrawing || step !== "drawing") return
    e.preventDefault()
    e.stopPropagation()
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return
    
    const pos = getMousePos(e)
    ctx.lineTo(pos.x, pos.y)
    ctx.stroke()
    
    // Update drawn image URL after drawing
    const imageDataUrl = canvas.toDataURL("image/png")
    setDrawnImageUrl(imageDataUrl)
    // Don't clear refinement history here - preserve it when navigating back and forth
    // History will only be cleared when explicitly starting fresh (clear canvas, upload, modal reset)
  }

  const stopDrawing = () => {
    setIsDrawing(false)
  }

  const clearCanvas = () => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return
    ctx.fillStyle = "white"
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    setDrawnImageUrl(null)
    setRefinedImageUrl(null) // Clear refined image when canvas is cleared
    setRefinementHistory([]) // Clear refinement history
  }

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    
    // Check if it's an image
    if (!file.type.startsWith('image/')) {
      alert('Please select an image file')
      return
    }
    
    // Clear refined image and history when uploading new image
    setRefinedImageUrl(null)
    setRefinementHistory([])
    
    const reader = new FileReader()
    reader.onload = (event) => {
      const img = new Image()
      img.onload = () => {
        const canvas = canvasRef.current
        if (!canvas) return
        const ctx = canvas.getContext("2d")
        if (!ctx) return
        
        // Clear canvas
        ctx.fillStyle = "white"
        ctx.fillRect(0, 0, canvas.width, canvas.height)
        
        // Draw uploaded image to canvas
        const maxSize = Math.max(img.width, img.height)
        const scale = Math.min(canvas.width / maxSize, canvas.height / maxSize)
        const x = (canvas.width - img.width * scale) / 2
        const y = (canvas.height - img.height * scale) / 2
        
        ctx.drawImage(img, x, y, img.width * scale, img.height * scale)
        
        // Store the image data URL
        const imageDataUrl = canvas.toDataURL("image/png")
        setDrawnImageUrl(imageDataUrl)
      }
      img.src = event.target?.result as string
    }
    reader.readAsDataURL(file)
    
    // Reset input
    e.target.value = ''
  }

  if (!isOpen) return null

  return (
    <div className={styles.backdrop} onMouseDown={(e) => {
      if (!isLoading && !isRefining && e.target === e.currentTarget) {
        onClose()
      }
    }} role="dialog" aria-modal="true">
      <div className={styles.modal} onMouseDown={(e) => e.stopPropagation()} style={{ maxWidth: "1200px", width: "min(1200px, calc(100vw - 40px))", display: "flex", gap: "24px", flexDirection: "row" }}>
        {/* Left side: Drawing or Refined Image */}
        <div style={{ flex: "1", display: "flex", flexDirection: "column" }}>
          <h2 style={{ marginTop: 0, marginBottom: "16px", color: "rgba(255, 255, 255, 0.95)", fontSize: "18px", fontWeight: 600 }}>
            {step === "drawing" ? "Draw Your Object" : step === "refining" ? "Refined Image" : "Generating 3D Model..."}
          </h2>
          
          {step === "drawing" && (
            <>
              <div 
                style={{ 
                  marginBottom: "16px", 
                  border: "2px solid rgba(255, 255, 255, 0.18)", 
                  borderRadius: "8px", 
                  overflow: "hidden", 
                  background: "white",
                  position: "relative",
                  zIndex: 10,
                  pointerEvents: "auto"
                }}
                onMouseDown={(e) => e.stopPropagation()}
                onMouseMove={(e) => e.stopPropagation()}
                onMouseUp={(e) => e.stopPropagation()}
              >
                <canvas
                  ref={canvasRef}
                  width={512}
                  height={512}
                  onMouseDown={startDrawing}
                  onMouseMove={draw}
                  onMouseUp={stopDrawing}
                  onMouseLeave={stopDrawing}
                  style={{ 
                    display: "block", 
                    width: "100%", 
                    height: "auto",
                    cursor: "crosshair",
                    touchAction: "none",
                    pointerEvents: "auto",
                    userSelect: "none",
                    WebkitUserSelect: "none"
                  }}
                />
              </div>
              
              <div style={{ display: "flex", gap: "8px", marginBottom: "16px", alignItems: "center" }}>
                <label
                  style={{
                    padding: "8px 16px",
                    background: "rgba(255, 255, 255, 0.08)",
                    border: "1px solid rgba(255, 255, 255, 0.18)",
                    borderRadius: "6px",
                    color: "rgba(255, 255, 255, 0.9)",
                    cursor: "pointer",
                    fontSize: "14px",
                    pointerEvents: "auto",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "6px"
                  }}
                >
                  Upload Image
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleImageUpload}
                    style={{ display: "none" }}
                  />
                </label>
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    setDrawingMode("pencil")
                  }}
                  style={{
                    padding: "8px 12px",
                    background: drawingMode === "pencil" ? "rgba(88, 242, 135, 0.2)" : "rgba(255, 255, 255, 0.08)",
                    border: `1px solid ${drawingMode === "pencil" ? "rgba(88, 242, 135, 0.5)" : "rgba(255, 255, 255, 0.18)"}`,
                    borderRadius: "6px",
                    color: "rgba(255, 255, 255, 0.9)",
                    cursor: "pointer",
                    fontSize: "14px",
                    pointerEvents: "auto",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "6px"
                  }}
                  title="Pencil"
                >
                  <Pencil size={16} />
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    setDrawingMode("eraser")
                  }}
                  style={{
                    padding: "8px 12px",
                    background: drawingMode === "eraser" ? "rgba(88, 242, 135, 0.2)" : "rgba(255, 255, 255, 0.08)",
                    border: `1px solid ${drawingMode === "eraser" ? "rgba(88, 242, 135, 0.5)" : "rgba(255, 255, 255, 0.18)"}`,
                    borderRadius: "6px",
                    color: "rgba(255, 255, 255, 0.9)",
                    cursor: "pointer",
                    fontSize: "14px",
                    pointerEvents: "auto",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "6px"
                  }}
                  title="Eraser"
                >
                  <Eraser size={16} />
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    clearCanvas()
                  }}
                  style={{
                    padding: "8px 16px",
                    background: "rgba(255, 255, 255, 0.08)",
                    border: "1px solid rgba(255, 255, 255, 0.18)",
                    borderRadius: "6px",
                    color: "rgba(255, 255, 255, 0.9)",
                    cursor: "pointer",
                    fontSize: "14px",
                    pointerEvents: "auto"
                  }}
                >
                  Clear
                </button>
              </div>
              
              <div className={styles.inputRow}>
                <input
                  ref={inputRef}
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="Describe your object (e.g., 'a red car', 'a wooden chair')..."
                  className={styles.input}
                />
              </div>
              
              <div style={{ display: "flex", gap: "8px", marginTop: "12px" }}>
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    void handleGenerateDirectly()
                  }}
                  disabled={!prompt.trim()}
                  style={{
                    flex: 1,
                    padding: "12px 16px",
                    background: "rgba(88, 242, 135, 0.2)",
                    border: "1px solid rgba(88, 242, 135, 0.5)",
                    borderRadius: "6px",
                    color: "rgba(255, 255, 255, 0.9)",
                    cursor: !prompt.trim() ? "not-allowed" : "pointer",
                    fontSize: "14px",
                    fontWeight: 600,
                    pointerEvents: "auto",
                    opacity: !prompt.trim() ? 0.5 : 1
                  }}
                >
                  Generate
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    handleGoToRefine()
                  }}
                  style={{
                    flex: 1,
                    padding: "12px 16px",
                    background: "rgba(255, 255, 255, 0.08)",
                    border: "1px solid rgba(255, 255, 255, 0.18)",
                    borderRadius: "6px",
                    color: "rgba(255, 255, 255, 0.9)",
                    cursor: "pointer",
                    fontSize: "14px",
                    fontWeight: 600,
                    pointerEvents: "auto"
                  }}
                >
                  Refine Image
                </button>
              </div>
              <div style={{ fontSize: "12px", color: "rgba(255, 255, 255, 0.6)", marginTop: "8px" }}>
                Press Ctrl+Enter to generate directly
              </div>
            </>
          )}
          
          {step === "refining" && (
            <>
              {/* Chat history on the left */}
              <div style={{ 
                flex: "1", 
                display: "flex", 
                flexDirection: "column",
                maxHeight: "600px",
                overflowY: "auto",
                paddingRight: "8px"
              }}>
                <h4 style={{ margin: "0 0 16px 0", color: "rgba(255, 255, 255, 0.9)", fontSize: "16px", fontWeight: 600 }}>
                  Refinement History
                </h4>
                <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                  {refinementHistory.length === 0 && drawnImageUrl && (
                    <div style={{
                      padding: "8px",
                      background: "rgba(255, 255, 255, 0.05)",
                      borderRadius: "8px",
                      border: "1px solid rgba(255, 255, 255, 0.1)"
                    }}>
                      <div style={{ fontSize: "12px", color: "rgba(255, 255, 255, 0.7)", marginBottom: "6px" }}>
                        Original Drawing
                      </div>
                      <img 
                        src={drawnImageUrl} 
                        alt="Original" 
                        style={{
                          width: "150px",
                          height: "auto",
                          borderRadius: "6px",
                          maxWidth: "100%"
                        }}
                      />
                    </div>
                  )}
                  {refinementHistory.map((item, index) => (
                    <div 
                      key={index}
                      style={{
                        padding: "8px",
                        background: item.type === "user" ? "rgba(88, 242, 135, 0.1)" : "rgba(255, 255, 255, 0.05)",
                        borderRadius: "8px",
                        border: `1px solid ${item.type === "user" ? "rgba(88, 242, 135, 0.2)" : "rgba(255, 255, 255, 0.1)"}`,
                        alignSelf: item.type === "user" ? "flex-end" : "flex-start",
                        maxWidth: "70%"
                      }}
                    >
                      {item.type === "user" && item.prompt && (
                        <div style={{ fontSize: "13px", color: "rgba(255, 255, 255, 0.9)", marginBottom: "6px" }}>
                          {item.prompt}
                        </div>
                      )}
                      <img 
                        src={item.imageUrl} 
                        alt={item.type === "user" ? "Input" : "Refined"} 
                        style={{
                          width: "150px",
                          height: "auto",
                          borderRadius: "6px",
                          maxWidth: "100%"
                        }}
                      />
                      <div style={{ fontSize: "10px", color: "rgba(255, 255, 255, 0.5)", marginTop: "4px" }}>
                        {item.type === "user" ? "You" : "Refined"}
                      </div>
                    </div>
                  ))}
                  {isRefining && (
                    <div style={{
                      padding: "12px",
                      background: "rgba(88, 242, 135, 0.1)",
                      borderRadius: "8px",
                      border: "1px solid rgba(88, 242, 135, 0.2)",
                      alignSelf: "flex-end",
                      maxWidth: "80%"
                    }}>
                      <div style={{ fontSize: "14px", color: "rgba(255, 255, 255, 0.9)" }}>
                        {refinementStatus || "Refining..."}
                      </div>
                    </div>
                  )}
                </div>
              </div>
              
              <div style={{ marginBottom: "12px", marginTop: "16px" }}>
                <label style={{ display: "block", marginBottom: "8px", color: "rgba(255, 255, 255, 0.9)", fontSize: "14px" }}>
                  Model
                </label>
                <div style={{ display: "flex", gap: "8px", marginBottom: "16px" }}>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      setSelectedModel("nano-banana")
                    }}
                    style={{
                      flex: 1,
                      padding: "8px 16px",
                      background: selectedModel === "nano-banana" ? "rgba(88, 242, 135, 0.2)" : "rgba(255, 255, 255, 0.08)",
                      border: `1px solid ${selectedModel === "nano-banana" ? "rgba(88, 242, 135, 0.5)" : "rgba(255, 255, 255, 0.18)"}`,
                      borderRadius: "6px",
                      color: "rgba(255, 255, 255, 0.9)",
                      cursor: "pointer",
                      fontSize: "14px",
                      pointerEvents: "auto"
                    }}
                  >
                    nano-banana
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      setSelectedModel("nano-banana-pro")
                    }}
                    style={{
                      flex: 1,
                      padding: "8px 16px",
                      background: selectedModel === "nano-banana-pro" ? "rgba(88, 242, 135, 0.2)" : "rgba(255, 255, 255, 0.08)",
                      border: `1px solid ${selectedModel === "nano-banana-pro" ? "rgba(88, 242, 135, 0.5)" : "rgba(255, 255, 255, 0.18)"}`,
                      borderRadius: "6px",
                      color: "rgba(255, 255, 255, 0.9)",
                      cursor: "pointer",
                      fontSize: "14px",
                      pointerEvents: "auto"
                    }}
                  >
                    nano-banana-pro
                  </button>
                </div>
              </div>
              
              <div className={styles.inputRow} style={{ marginBottom: "12px" }}>
                <input
                  value={refinementPrompt}
                  onChange={(e) => setRefinementPrompt(e.target.value)}
                  placeholder="Describe how to refine the image (e.g., 'make it more colorful', 'add shadows')..."
                  className={styles.input}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey && !isRefining && refinementPrompt.trim()) {
                      e.preventDefault()
                      void handleRefineImage()
                    }
                  }}
                />
                <button
                  type="button"
                  className={styles.send}
                  onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    void handleRefineImage()
                  }}
                  disabled={isRefining || !refinementPrompt.trim()}
                  aria-label="Refine Image"
                >
                  →
                </button>
              </div>
              
              <div style={{ display: "flex", gap: "8px", marginTop: "12px" }}>
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    // Load the latest refined image into the canvas, or original drawing if no refinement
                    const imageToLoad = refinedImageUrl || drawnImageUrl
                    if (imageToLoad && canvasRef.current) {
                      const img = new Image()
                      img.onload = () => {
                        const canvas = canvasRef.current
                        if (!canvas) return
                        const ctx = canvas.getContext("2d")
                        if (!ctx) return
                        ctx.clearRect(0, 0, canvas.width, canvas.height)
                        ctx.fillStyle = "white"
                        ctx.fillRect(0, 0, canvas.width, canvas.height)
                        ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
                        // Update drawn image URL
                        const imageDataUrl = canvas.toDataURL("image/png")
                        setDrawnImageUrl(imageDataUrl)
                      }
                      img.src = imageToLoad
                    }
                    setStep("drawing")
                  }}
                  style={{
                    padding: "10px 16px",
                    background: "rgba(255, 255, 255, 0.08)",
                    border: "1px solid rgba(255, 255, 255, 0.18)",
                    borderRadius: "6px",
                    color: "rgba(255, 255, 255, 0.9)",
                    cursor: "pointer",
                    fontSize: "14px",
                    pointerEvents: "auto"
                  }}
                >
                  Back to Drawing
                </button>
                {refinedImageUrl && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      void handleProceedTo3D()
                    }}
                    disabled={isRefining}
                    style={{
                      flex: 1,
                      padding: "12px 16px",
                      background: "rgba(88, 242, 135, 0.3)",
                      border: "1px solid rgba(88, 242, 135, 0.6)",
                      borderRadius: "6px",
                      color: "rgba(255, 255, 255, 0.95)",
                      cursor: isRefining ? "not-allowed" : "pointer",
                      fontSize: "16px",
                      fontWeight: 600,
                      pointerEvents: "auto",
                      opacity: isRefining ? 0.5 : 1
                    }}
                  >
                    Generate Model
                  </button>
                )}
              </div>
            </>
          )}
          
          {step === "generating" && (
            <>
              {(generationStatus || isLoading) && (
                <div style={{ 
                  marginBottom: "16px", 
                  padding: "12px", 
                  background: "rgba(88, 242, 135, 0.1)", 
                  border: "1px solid rgba(88, 242, 135, 0.3)", 
                  borderRadius: "8px",
                  color: "rgba(255, 255, 255, 0.9)",
                  fontSize: "14px"
                }}>
                  {generationStatus || "Generating 3D model..."}
                </div>
              )}
            </>
          )}
        </div>
        
        {/* Right side: Preview / Latest Refined Image */}
        <div style={{ flex: "1", display: "flex", flexDirection: "column" }}>
          <h3 style={{ marginTop: 0, marginBottom: "16px", color: "rgba(255, 255, 255, 0.95)", fontSize: "16px", fontWeight: 600 }}>
            {step === "generating" ? "3D Preview" : step === "refining" ? "Latest Refined Image" : "Preview"}
          </h3>
          {step === "refining" && (
            <>
              {refinedImageUrl ? (
                <div style={{ marginBottom: "16px" }}>
                  <img 
                    src={refinedImageUrl} 
                    alt="Latest Refined" 
                    style={{
                      width: "100%",
                      height: "auto",
                      border: "2px solid rgba(255, 255, 255, 0.18)",
                      borderRadius: "8px"
                    }}
                  />
                </div>
              ) : drawnImageUrl ? (
                <div style={{ marginBottom: "16px" }}>
                  <img 
                    src={drawnImageUrl} 
                    alt="Original Drawing" 
                    style={{
                      width: "100%",
                      height: "auto",
                      border: "2px solid rgba(255, 255, 255, 0.18)",
                      borderRadius: "8px"
                    }}
                  />
                  <div style={{ fontSize: "12px", color: "rgba(255, 255, 255, 0.6)", marginTop: "8px", textAlign: "center" }}>
                    Original drawing - refine to see results
                  </div>
                </div>
              ) : (
                <div style={{
                  width: "100%",
                  aspectRatio: "1",
                  border: "2px solid rgba(255, 255, 255, 0.18)",
                  borderRadius: "8px",
                  background: "#1a1a1a",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "rgba(255, 255, 255, 0.6)",
                  marginBottom: "16px"
                }}>
                  {isRefining ? refinementStatus : "Refined image will appear here"}
                </div>
              )}
            </>
          )}
          {step === "generating" && (
            <canvas
              ref={previewCanvasRef}
              style={{
                width: "100%",
                height: "400px",
                border: "2px solid rgba(255, 255, 255, 0.18)",
                borderRadius: "8px",
                background: "#1a1a1a"
              }}
            />
          )}
          {step === "generating" && !previewModelUrl && isLoading && (
            <div style={{ 
              marginTop: "16px", 
              textAlign: "center", 
              color: "rgba(255, 255, 255, 0.6)",
              fontSize: "14px"
            }}>
              Model will appear here when ready...
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
