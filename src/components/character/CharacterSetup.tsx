import { useEffect, useRef, useState } from "react"
import * as THREE from "three"
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js"
import { AnimationMixer } from "three"
import { useStorage, useMutation } from "../../liveblocks.config"
import styles from "./characterSetup.module.css"

export type CharacterSetupProps = {
  initialName?: string
  onConfirm: (name: string, modelUrl?: string) => void
}

type SavedModel = {
  prompt: string
  modelUrl: string
  timestamp: number
  animations?: {
    running?: string
    walking?: string
  }
}

export default function CharacterSetup({ initialName, onConfirm }: CharacterSetupProps) {
  const [name, setName] = useState(initialName ?? "")
  const [prompt, setPrompt] = useState("")
  const [isGenerating, setIsGenerating] = useState(false)
  const [modelUrl, setModelUrl] = useState<string | null>(null)
  const [testModelUrl, setTestModelUrl] = useState("")
  const [isSceneReady, setIsSceneReady] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const [lastMousePos, setLastMousePos] = useState({ x: 0, y: 0 })
  const [generationProgress, setGenerationProgress] = useState({ attempts: 0, estimatedTime: 0, loadingPercent: 0 })
  const [isModelLoaded, setIsModelLoaded] = useState(false)
  const [isModelLoading, setIsModelLoading] = useState(false)
  const [balance, setBalance] = useState<{ balance?: number } | null>(null)
  const [poseMode, setPoseMode] = useState<"a-pose" | "t-pose" | "">("")
  const [generationStatus, setGenerationStatus] = useState<string>("")
  const [availableAnimations, setAvailableAnimations] = useState<{
    running?: string
    walking?: string
  } | null>(null)
  const [selectedAnimation, setSelectedAnimation] = useState<string>("")
  const [baseRiggedModelUrl, setBaseRiggedModelUrl] = useState<string | null>(null) // Store base rigged model URL separately
  const savedModelsStorage = useStorage((root: any) => root?.savedModels)
  // LiveList is iterable, convert to array using Array.from()
  const savedModels: SavedModel[] = savedModelsStorage ? Array.from(savedModelsStorage) : []
  const addSavedModel = useMutation(({ storage }: any, model: SavedModel) => {
    const models = storage.get("savedModels")
    if (models) {
      // Remove duplicates and keep last 20
      const existing: SavedModel[] = [...models]
      const filtered = existing.filter((m: SavedModel) => m.modelUrl !== model.modelUrl)
      const updated = [model, ...filtered].slice(0, 20)
      // Clear and repopulate
      while (models.length > 0) {
        models.delete(models.length - 1)
      }
      updated.forEach((m: SavedModel) => models.push(m))
    }
  }, [])
  const rotationRef = useRef({ x: 0, y: 0 })
  
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const sceneRef = useRef<THREE.Scene | null>(null)
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null)
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null)
  const modelRef = useRef<THREE.Group | null>(null)
  const animationFrameRef = useRef<number | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const timeRemainingSpriteRef = useRef<{ sprite: THREE.Sprite; texture: THREE.Texture } | null>(null)

  // Function to create a time remaining sprite
  const createTimeRemainingSprite = (seconds: number) => {
    const canvas = document.createElement("canvas")
    canvas.width = 256
    canvas.height = 64
    const ctx = canvas.getContext("2d")
    if (!ctx) return null

    ctx.clearRect(0, 0, canvas.width, canvas.height)
    
    // Background
    ctx.fillStyle = "rgba(0, 0, 0, 0.7)"
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    
    // Text
    ctx.font = "600 24px system-ui, -apple-system, Segoe UI, Roboto, Arial"
    ctx.textAlign = "center"
    ctx.textBaseline = "middle"
    ctx.fillStyle = "rgba(255, 157, 77, 0.95)"
    const text = `${Math.ceil(seconds)}s remaining`
    ctx.fillText(text, canvas.width / 2, canvas.height / 2)

    const tex = new THREE.CanvasTexture(canvas)
    tex.colorSpace = THREE.SRGBColorSpace
    tex.needsUpdate = true

    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false })
    const sprite = new THREE.Sprite(mat)
    sprite.scale.set(1.5, 0.4, 1)

    return { sprite, texture: tex }
  }

  // Initialize Three.js scene
  // Use useEffect with retry logic since the modal/dialog might not be fully mounted yet
  useEffect(() => {
    console.log("Scene initialization useEffect running...", {
      hasCanvas: !!canvasRef.current
    })
    
    if (!canvasRef.current) {
      console.warn("Canvas not ready, will retry in 50ms...")
      // Retry after a short delay
      const timeout = setTimeout(() => {
        // Check again - the canvas should be attached by now
        if (canvasRef.current && !sceneRef.current) {
          console.log("Canvas ready on retry, will initialize...")
          // Force re-run by triggering a state update or just let it retry naturally
        }
      }, 50)
      return () => clearTimeout(timeout)
    }

    // If scene is already initialized, don't reinitialize
    if (sceneRef.current) {
      console.log("Scene already initialized, skipping")
      return
    }

    console.log("Initializing Three.js scene...")
    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x1a1a1a)
    sceneRef.current = scene

    // Use canvas wrapper dimensions (parent of canvas)
    const canvasWrapper = canvasRef.current?.parentElement
    const width = canvasWrapper?.clientWidth || 800
    const height = canvasWrapper?.clientHeight || 600

    const camera = new THREE.PerspectiveCamera(
      50,
      width / height,
      0.1,
      1000
    )
    camera.position.set(0, 1.5, 3)
    camera.lookAt(0, 0, 0)
    cameraRef.current = camera

    const renderer = new THREE.WebGLRenderer({ 
      canvas: canvasRef.current,
      antialias: true 
    })
    renderer.setSize(width, height)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    rendererRef.current = renderer

    // Add lights
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6)
    scene.add(ambientLight)
    
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8)
    directionalLight.position.set(5, 10, 5)
    scene.add(directionalLight)

    // Add a simple placeholder character (capsule)
    const placeholderGroup = new THREE.Group()
    const capsuleGeometry = new THREE.CapsuleGeometry(0.3, 1.2, 8, 16)
    const capsuleMaterial = new THREE.MeshStandardMaterial({ 
      color: 0x4aa3ff,
      roughness: 0.4,
      metalness: 0.1
    })
    const capsule = new THREE.Mesh(capsuleGeometry, capsuleMaterial)
    placeholderGroup.add(capsule)
    placeholderGroup.userData = { isPlaceholder: true } // Mark as placeholder
    scene.add(placeholderGroup)
    modelRef.current = placeholderGroup

    // Mark scene as ready
    setIsSceneReady(true)
    console.log("Scene initialized and ready")

      // Animation loop
      const animate = () => {
        animationFrameRef.current = requestAnimationFrame(animate)
        
        if (modelRef.current) {
          modelRef.current.rotation.y = rotationRef.current.y
          modelRef.current.rotation.x = rotationRef.current.x
          
          // Update animation mixer if present
          const mixer = (modelRef.current.userData as any)?.mixer as THREE.AnimationMixer | undefined
          if (mixer) {
            mixer.update(0.016) // ~60fps
          }
        }
        
        renderer.render(scene, camera)
      }
      animate()

    // Handle resize
    const handleResize = () => {
      const canvasWrapper = canvasRef.current?.parentElement
      const width = canvasWrapper?.clientWidth || 800
      const height = canvasWrapper?.clientHeight || 600
      if (!camera || !renderer) return
      camera.aspect = width / height
      camera.updateProjectionMatrix()
      renderer.setSize(width, height)
    }
    window.addEventListener("resize", handleResize)

    return () => {
      window.removeEventListener("resize", handleResize)
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current)
      }
      // Clean up time remaining sprite
      if (timeRemainingSpriteRef.current) {
        scene.remove(timeRemainingSpriteRef.current.sprite)
        timeRemainingSpriteRef.current.texture.dispose()
        ;(timeRemainingSpriteRef.current.sprite.material as THREE.Material).dispose()
        timeRemainingSpriteRef.current = null
      }
      renderer.dispose()
      scene.clear()
      setIsSceneReady(false)
    }
  }, []) // Run on mount and retry if refs aren't ready yet

  // Fetch balance on mount
  useEffect(() => {
    const fetchBalance = async () => {
      try {
        const response = await fetch("/api/meshy/balance")
        if (response.ok) {
          const data = await response.json()
          setBalance(data)
        }
      } catch (error) {
        console.error("Failed to fetch balance:", error)
      }
    }
    fetchBalance()
  }, [])

  // Function to create a status sprite
  const createStatusSprite = (status: string) => {
    const canvas = document.createElement("canvas")
    canvas.width = 256
    canvas.height = 64
    const ctx = canvas.getContext("2d")
    if (!ctx) return null

    ctx.clearRect(0, 0, canvas.width, canvas.height)
    
    // Background
    ctx.fillStyle = "rgba(0, 0, 0, 0.7)"
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    
    // Text
    ctx.font = "600 20px system-ui, -apple-system, Segoe UI, Roboto, Arial"
    ctx.textAlign = "center"
    ctx.textBaseline = "middle"
    ctx.fillStyle = "rgba(255, 255, 255, 0.95)"
    ctx.fillText(status, canvas.width / 2, canvas.height / 2)

    const tex = new THREE.CanvasTexture(canvas)
    tex.colorSpace = THREE.SRGBColorSpace
    tex.needsUpdate = true

    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false })
    const sprite = new THREE.Sprite(mat)
    sprite.scale.set(1.5, 0.4, 1)

    return { sprite, texture: tex }
  }
  
  const statusSpriteRef = useRef<{ sprite: THREE.Sprite; texture: THREE.Texture } | null>(null)

  // Cleanup sprites on unmount
  useEffect(() => {
    return () => {
      if (timeRemainingSpriteRef.current && sceneRef.current) {
        sceneRef.current.remove(timeRemainingSpriteRef.current.sprite)
        timeRemainingSpriteRef.current.texture.dispose()
        ;(timeRemainingSpriteRef.current.sprite.material as THREE.Material).dispose()
        timeRemainingSpriteRef.current = null
      }
      if (statusSpriteRef.current && sceneRef.current) {
        sceneRef.current.remove(statusSpriteRef.current.sprite)
        statusSpriteRef.current.texture.dispose()
        ;(statusSpriteRef.current.sprite.material as THREE.Material).dispose()
        statusSpriteRef.current = null
      }
    }
  }, [])

  // Load 3D model when URL is available and scene is ready
  useEffect(() => {
    if (!modelUrl) {
      return // No model URL yet, wait
    }
    
    if (!isSceneReady || !sceneRef.current) {
      console.log("Waiting for scene to be ready...", { isSceneReady, hasScene: !!sceneRef.current })
      return // Scene not ready yet, wait
    }
    
    // Validate URL format
    try {
      new URL(modelUrl) // Validate it's a proper URL
    } catch (e) {
      console.error("Invalid model URL format:", modelUrl)
      return
    }

    // Don't reload if we already have this model (and it's not the placeholder)
    if (modelRef.current && !modelRef.current.userData?.isPlaceholder && modelRef.current.userData?.modelUrl === modelUrl) {
      console.log("Model already loaded:", modelUrl)
      setIsModelLoaded(true) // Ensure loaded state is set
      return
    }
    
    // Reset loaded state when loading new model
    setIsModelLoaded(false)
    setIsModelLoading(true) // Show loading indicator
    
    // Prevent duplicate loading - check if model is already in scene
    if (sceneRef.current) {
      sceneRef.current.traverse((child) => {
        if (child.userData?.modelUrl === modelUrl && child !== modelRef.current) {
          console.log("Model already exists in scene, removing duplicate")
          child.removeFromParent()
        }
      })
    }

    console.log("Loading model from URL:", modelUrl)
    console.log("Scene available:", !!sceneRef.current)
    console.log("Current model ref:", modelRef.current)

    // Remove old model (including placeholder)
    const oldModel = modelRef.current
    if (oldModel) {
      console.log("Removing old model/placeholder")
      sceneRef.current?.remove(oldModel)
      oldModel.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose()
          if (Array.isArray(child.material)) {
            child.material.forEach((mat) => mat.dispose())
          } else {
            child.material.dispose()
          }
        }
      })
      modelRef.current = null
    }

    // Load GLB/GLTF file (Meshy.ai outputs GLB)
    console.log("Starting GLTFLoader for:", modelUrl)
    const loader = new GLTFLoader()
    
    // Check if URL needs proxying
    // ALL Meshy URLs must go through proxy due to CORS restrictions (Meshy doesn't send CORS headers)
    // The proxy is designed to handle signed URLs by preserving the URL byte-for-byte
    const needsProxy = modelUrl.includes('assets.meshy.ai')
    const loadUrl = needsProxy ? `/api/meshy/proxy?url=${encodeURIComponent(modelUrl)}` : modelUrl
    
    console.log("Loading model from:", loadUrl, needsProxy ? "(via proxy - required for CORS)" : "(direct)")
    
    loader.load(
      loadUrl,
      (gltf: { scene: THREE.Group; animations?: THREE.AnimationClip[] }) => {
        console.log("Model loaded successfully! GLTF object:", gltf)
        console.log("Scene from GLTF:", gltf.scene)
        console.log("Animations in GLTF:", gltf.animations?.length || 0)
        // Add new model
        const newModel = gltf.scene
        
        // Center and scale the model
        const bbox = new THREE.Box3().setFromObject(newModel)
        const center = bbox.getCenter(new THREE.Vector3())
        const size = bbox.getSize(new THREE.Vector3())
        const maxDim = Math.max(size.x, size.y, size.z)
        const scaleFactor = 1.5 / maxDim // Scale to fit in a 1.5 unit space

        newModel.scale.set(scaleFactor, scaleFactor, scaleFactor)
        // Rotate 180 degrees on Y axis to face opposite direction (for gameplay)
        // Apply rotation to the root of the model
        newModel.rotation.y = Math.PI
        
        // Center the model: place center at origin (0, 0, 0)
        // After scaling, we need to offset by the scaled center
        newModel.position.set(-center.x * scaleFactor, -center.y * scaleFactor, -center.z * scaleFactor)
        
        // Store the model URL in userData to prevent reloading
        newModel.userData = { modelUrl, rotationY: Math.PI } // Store rotation so it persists
        
        // Setup animations if available (animation GLB files contain the full animated model)
        if (gltf.animations && gltf.animations.length > 0) {
          console.log("✅ Found animations in GLB file:", gltf.animations.length, "animations")
          const mixer = new AnimationMixer(newModel)
          
          // Play all animations
          gltf.animations.forEach((clip) => {
            const action = mixer.clipAction(clip)
            action.play()
            console.log("▶️ Playing animation:", clip.name, "duration:", clip.duration)
          })
          
          // Store mixer reference for cleanup
          const oldMixer = (newModel.userData as any).mixer
          if (oldMixer) {
            oldMixer.stopAllAction()
            oldMixer.uncacheRoot(newModel)
          }
          (newModel.userData as any).mixer = mixer
          
          // Update mixer in animation loop
          if (animationFrameRef.current) {
            const updateMixer = () => {
              if (mixer && animationFrameRef.current && newModel) {
                mixer.update(0.016) // ~60fps
                requestAnimationFrame(updateMixer)
              }
            }
            updateMixer()
          }
          
          console.log("✅ Animations loaded and playing:", gltf.animations.map(a => a.name))
        } else {
          // Check if this is an animation URL (from Meshy animation tasks)
          const isAnimationUrl = modelUrl && (
            modelUrl.includes('/animations/') || 
            modelUrl.includes('/tasks/') && availableAnimations && (
              availableAnimations.running === modelUrl || 
              availableAnimations.walking === modelUrl
            )
          )
          if (isAnimationUrl) {
            console.warn("⚠️ Animation GLB file loaded but contains no animation clips. This might be a static model in an animated pose.")
            console.warn("⚠️ Meshy animation GLB files may not include animation clips - they might be pre-baked poses.")
          }
        }
        
        if (sceneRef.current) {
          sceneRef.current.add(newModel)
          modelRef.current = newModel
          setIsModelLoaded(true) // Mark model as loaded
          setIsModelLoading(false) // Stop loading indicator
          
          // Store as base model if it's the rigged model (not an animation URL)
          if (modelUrl && !modelUrl.includes('/Animation_') && !availableAnimations?.running?.includes(modelUrl) && !availableAnimations?.walking?.includes(modelUrl)) {
            setBaseRiggedModelUrl(modelUrl)
          }
          
          // Only set isGenerating to false if we're not in the middle of generation stages
          // Check generationStatus to see if we're still in the pipeline
          const stillGenerating = generationStatus && (
            generationStatus.includes("Mesh complete") || 
            generationStatus.includes("Texture complete") ||
            generationStatus.includes("Rigging") ||
            generationStatus.includes("Texturing")
          )
          
          if (!stillGenerating) {
            // No active generation stages, this was a standalone model load
            setIsGenerating(false)
            setGenerationStatus("")
          }
          // Otherwise, keep isGenerating true - retexture/rigging will set it to false when done
          
          setGenerationProgress({ attempts: 0, estimatedTime: 0, loadingPercent: 0 }) // Clear progress
          
          // Update time remaining sprite position if it exists
          if (timeRemainingSpriteRef.current) {
            const bbox = new THREE.Box3().setFromObject(newModel)
            const center = bbox.getCenter(new THREE.Vector3())
            const size = bbox.getSize(new THREE.Vector3())
            timeRemainingSpriteRef.current.sprite.position.set(center.x, center.y + size.y * 0.5 + 1, center.z)
          }
          
          console.log("Model added to scene successfully!")
          console.log("Scene children count:", sceneRef.current.children.length)
          console.log("Model position:", newModel.position)
          console.log("Model rotation:", newModel.rotation)
          console.log("Model scale:", newModel.scale)
        } else {
          console.error("Scene not available when trying to add model!")
        }
      },
      (progress) => {
        // Progress callback
        if (progress.lengthComputable) {
          const percentComplete = (progress.loaded / progress.total) * 100
          console.log("Loading progress:", percentComplete.toFixed(2) + "%")
          // Update progress bar during model loading
          setGenerationProgress({ 
            attempts: Math.floor(percentComplete / 10), 
            estimatedTime: 0,
            loadingPercent: percentComplete 
          })
        }
      },
      (error: unknown) => {
        console.error("Error loading GLTF model:", error)
        setIsModelLoaded(false) // Mark as not loaded on error
        setIsModelLoading(false) // Stop loading indicator
        setGenerationProgress({ attempts: 0, estimatedTime: 0, loadingPercent: 0 }) // Clear progress
        
        // Provide helpful error message
        const errorMsg = error && typeof error === 'object' && 'message' in error ? String(error.message) : "Unknown error"
        console.error("❌ Model load error details:", {
          modelUrl,
          loadUrl,
          error: errorMsg,
          isAnimationUrl: modelUrl?.includes('/Animation_') || modelUrl?.includes('running') || modelUrl?.includes('walking'),
          urlLength: modelUrl?.length
        })
        if (errorMsg.includes('403') || errorMsg.includes('Forbidden')) {
          const isAnimation = modelUrl?.includes('/Animation_') || modelUrl?.includes('running') || modelUrl?.includes('walking')
          const isArmature = modelUrl?.includes('armature')
          
          let errorDetails = `Failed to load ${isAnimation ? 'animation' : isArmature ? 'armature' : 'model'}: CloudFront is blocking the request (403 Forbidden).\n\n`
          errorDetails += `URL: ${modelUrl?.substring(0, 100)}...\n\n`
          errorDetails += `This is likely due to:\n`
          errorDetails += `- CloudFront signed URLs with IP restrictions (cannot be proxied)\n`
          errorDetails += `- The signature includes client IP, but proxy uses server IP\n`
          errorDetails += `- Meshy's CloudFront policy may prevent server-side proxying\n\n`
          errorDetails += `Possible solutions:\n`
          errorDetails += `1. Contact Meshy support - they control CloudFront config\n`
          errorDetails += `2. Ask if they can provide URLs without IP restrictions for proxying\n`
          errorDetails += `3. Check if URLs have expired (even if Expires timestamp looks valid)\n`
          errorDetails += `4. Try generating a fresh model and test immediately\n\n`
          errorDetails += `Check server console for detailed proxy logs.`
          
          console.error("❌ CloudFront 403 Error - This indicates IP restrictions in signed URLs")
          console.error("The proxy cannot work if CloudFront validates client IP in the signature")
          alert(errorDetails)
        } else if (errorMsg.includes('CORS')) {
          alert("Failed to load model: CORS error. The model URL may not be accessible from this domain.")
        } else {
          alert(`Failed to load 3D model: ${errorMsg}`)
        }
      }
    )
  }, [modelUrl, isSceneReady]) // Re-run when modelUrl or scene readiness changes

  // Handle mouse drag for rotation
  const handleMouseDown = (e: React.MouseEvent) => {
    setIsDragging(true)
    setLastMousePos({ x: e.clientX, y: e.clientY })
  }

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return
    
    const deltaX = e.clientX - lastMousePos.x
    const deltaY = e.clientY - lastMousePos.y
    
    rotationRef.current = {
      y: rotationRef.current.y + deltaX * 0.01,
      x: Math.max(-Math.PI / 2, Math.min(Math.PI / 2, rotationRef.current.x - deltaY * 0.01))
    }
    
    setLastMousePos({ x: e.clientX, y: e.clientY })
  }

  const handleMouseUp = () => {
    setIsDragging(false)
  }

  // Generate 3D model with Meshy.ai
  const generateModel = async () => {
    if (!prompt.trim() || !poseMode) return

    setIsGenerating(true)
    setGenerationStatus("Generating 3D model...")
    setGenerationProgress({ attempts: 0, estimatedTime: 50, loadingPercent: 0 }) // Show progress immediately
    try {
      // Use the prompt as texture_prompt to ensure textures are applied
      // The refine task will use this to add textures to the model
      const response = await fetch("/api/meshy/generate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ 
          prompt: prompt.trim(),
          texture_prompt: prompt.trim(), // Use same prompt for texture generation
          pose_mode: poseMode
        }),
      })

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`Failed to generate model: ${response.status} ${response.statusText}. ${errorText}`)
      }

      const data = await response.json()
      
      // Meshy.ai returns a task ID, then we poll for the result
      if (data.taskId) {
        // Poll for the result
        let attempts = 0
        const maxAttempts = 120 // 10 minutes max (5 second intervals)
        const pollInterval = 5000 // 5 seconds
        
        const estimatedTotalAttempts = 10
        const estimatedTotalSeconds = estimatedTotalAttempts * (pollInterval / 1000)
        
        const pollResult = async (): Promise<void> => {
          try {
            const statusResponse = await fetch(`/api/meshy/status/${encodeURIComponent(data.taskId)}`)
            if (!statusResponse.ok) {
              throw new Error("Failed to check status")
            }
            
            const statusData = await statusResponse.json()
            console.log("Status check:", JSON.stringify(statusData, null, 2))
            
            // Update status
            if (statusData.status === "PENDING" || statusData.status === "IN_PROGRESS") {
              setGenerationStatus("Generating 3D model...")
            } else if (statusData.status === "SUCCEEDED" || statusData.status === "completed") {
              setGenerationStatus("Adding textures...")
            }
            
            // Update progress
            attempts++
            const elapsedSeconds = attempts * (pollInterval / 1000)
            const estimatedRemaining = Math.max(0, estimatedTotalSeconds - elapsedSeconds)
            setGenerationProgress({ attempts, estimatedTime: estimatedRemaining, loadingPercent: 0 })
            
            // Meshy.ai returns status as "SUCCEEDED", "FAILED", "PENDING", "IN_PROGRESS", "CANCELED"
            if (statusData.status === "completed" || statusData.status === "SUCCEEDED") {
              console.log("Status is SUCCEEDED! Full response:", JSON.stringify(statusData, null, 2))
              if (statusData.modelUrl) {
                // Reload model in 3D viewer when mesh finishes
                // Keep isGenerating true - we still have retexture and rigging stages
                setGenerationStatus("Mesh complete")
                setModelUrl(statusData.modelUrl)
                setIsModelLoading(true)
                
                // If we have a texture_prompt, create a retexture task to add textures
                const texturePrompt = data.texturePrompt || prompt.trim()
                if (texturePrompt) {
                  // Keep isGenerating true - retexture is next stage
                  setGenerationStatus("Texturing model...")
                  console.log("Creating retexture task with text_style_prompt:", texturePrompt)
                  try {
                    const retextureResponse = await fetch("/api/meshy/retexture", {
                      method: "POST",
                      headers: {
                        "Content-Type": "application/json",
                      },
                      body: JSON.stringify({
                        input_task_id: data.taskId,
                        text_style_prompt: texturePrompt,
                        enable_pbr: false,
                      }),
                    })

                    if (retextureResponse.ok) {
                      const retextureData = await retextureResponse.json()
                      console.log("Retexture task created:", retextureData)
                      
                      // Poll for retexture task completion
                      let retextureAttempts = 0
                      const retextureMaxAttempts = 120
                      const retexturePollInterval = 5000
                      const estimatedRetextureSeconds = 10 * (retexturePollInterval / 1000)
                      
                      const pollRetextureResult = async (): Promise<void> => {
                        try {
                          const retextureStatusResponse = await fetch(`/api/meshy/status/${encodeURIComponent(retextureData.taskId)}`)
                          if (!retextureStatusResponse.ok) {
                            throw new Error("Failed to check retexture status")
                          }
                          
                          const retextureStatusData = await retextureStatusResponse.json()
                          console.log("Retexture status check:", JSON.stringify(retextureStatusData, null, 2))
                          
                          retextureAttempts++
                          const estimatedRemaining = Math.max(0, estimatedRetextureSeconds - (retextureAttempts * (retexturePollInterval / 1000)))
                          setGenerationProgress({ attempts: attempts + retextureAttempts, estimatedTime: estimatedRemaining, loadingPercent: 0 })
                          
                          if (retextureStatusData.status === "completed" || retextureStatusData.status === "SUCCEEDED") {
                            // Retexture API returns model_urls.glb
                            const retexturedModelUrl = retextureStatusData.model_urls?.glb || retextureStatusData.modelUrl
                            if (retexturedModelUrl) {
                              // Reload model in 3D viewer when texture finishes
                              setGenerationStatus("Texture complete")
                              setModelUrl(retexturedModelUrl)
                              setIsModelLoading(true)
                              
                              // After retexture completes, create rigging task
                              // Keep isGenerating true - rigging is still part of generation
                              setGenerationStatus("Rigging model...")
                              console.log("Retexture task succeeded! Creating rigging task...")
                              try {
                                const riggingResponse = await fetch("/api/meshy/rigging", {
                                  method: "POST",
                                  headers: {
                                    "Content-Type": "application/json",
                                  },
                                  body: JSON.stringify({
                                    input_task_id: retextureData.taskId,
                                    height_meters: 1.7, // Standard human height
                                    // Note: Meshy should automatically generate basic_animations when rigging
                                  }),
                                })

                                if (riggingResponse.ok) {
                                  const riggingData = await riggingResponse.json()
                                  console.log("Rigging task created:", riggingData)
                                  
                                  // Poll for rigging task completion
                                  let riggingAttempts = 0
                                  const riggingMaxAttempts = 120
                                  const riggingPollInterval = 5000
                                  const estimatedRiggingSeconds = 15 * (riggingPollInterval / 1000)
                                  
                                  const pollRiggingResult = async (): Promise<void> => {
                                    try {
                                      const riggingStatusResponse = await fetch(`/api/meshy/status/${encodeURIComponent(riggingData.taskId)}`)
                                      if (!riggingStatusResponse.ok) {
                                        throw new Error("Failed to check rigging status")
                                      }
                                      
                                      const riggingStatusData = await riggingStatusResponse.json()
                                      console.log("Rigging status check:", JSON.stringify(riggingStatusData, null, 2))
                                      
                                      riggingAttempts++
                                      const estimatedRemaining = Math.max(0, estimatedRiggingSeconds - (riggingAttempts * (riggingPollInterval / 1000)))
                                      setGenerationProgress({ attempts: attempts + retextureAttempts + riggingAttempts, estimatedTime: estimatedRemaining, loadingPercent: 0 })
                                      
                                      if (riggingStatusData.status === "completed" || riggingStatusData.status === "SUCCEEDED") {
                                        // Rigging API returns result.rigged_character_glb_url or modelUrl
                                        const riggedModelUrl = riggingStatusData.result?.rigged_character_glb_url || riggingStatusData.modelUrl
                                        if (riggedModelUrl) {
                                          setGenerationStatus("Rigging complete")
                                          console.log("🎬 Rigging task succeeded! Full response:", JSON.stringify(riggingStatusData, null, 2))
                                          console.log("🔍 Checking for animations in response structure...")
                                          console.log("Response keys:", Object.keys(riggingStatusData))
                                          console.log("Using rigged model URL:", riggedModelUrl)
                                          
                                          // Store base rigged model URL for armature workflow
                                          setBaseRiggedModelUrl(riggedModelUrl)
                                          if (riggingStatusData.result) {
                                          console.log("Result object:", riggingStatusData.result)
                                            console.log("Result keys:", Object.keys(riggingStatusData.result))
                                          } else {
                                            console.warn("⚠️ No 'result' field in response - animations may not be available")
                                          }
                                          
                                          // Store animation URLs for selection - check multiple possible paths
                                          const animations: { running?: string; walking?: string } = {}
                                          
                                          // Check result.basic_animations (primary path)
                                          // PREFER armature URLs - they contain only skeleton + animation data
                                          // and work better through proxy (avoid 403 on full animated GLBs)
                                          if (riggingStatusData.result?.basic_animations) {
                                            console.log("✅ Found basic_animations in result:", riggingStatusData.result.basic_animations)
                                            // Use armature URLs - they're more reliable through proxy and contain animation clips
                                            if (riggingStatusData.result.basic_animations.running_armature_glb_url) {
                                              animations.running = riggingStatusData.result.basic_animations.running_armature_glb_url
                                              console.log("✅ Using running_armature_glb_url (skeleton + animation only):", animations.running)
                                            } else if (riggingStatusData.result.basic_animations.running_glb_url) {
                                              animations.running = riggingStatusData.result.basic_animations.running_glb_url
                                              console.log("⚠️ Falling back to running_glb_url (may have 403 issues):", animations.running)
                                            }
                                            if (riggingStatusData.result.basic_animations.walking_armature_glb_url) {
                                              animations.walking = riggingStatusData.result.basic_animations.walking_armature_glb_url
                                              console.log("✅ Using walking_armature_glb_url (skeleton + animation only):", animations.walking)
                                            } else if (riggingStatusData.result.basic_animations.walking_glb_url) {
                                              animations.walking = riggingStatusData.result.basic_animations.walking_glb_url
                                              console.log("⚠️ Falling back to walking_glb_url (may have 403 issues):", animations.walking)
                                            }
                                          }
                                          
                                          // Check top-level basic_animations (alternative path)
                                          if (!animations.running && !animations.walking && riggingStatusData.basic_animations) {
                                            console.log("✅ Found basic_animations at top level:", riggingStatusData.basic_animations)
                                            if (riggingStatusData.basic_animations.running_glb_url) {
                                              animations.running = riggingStatusData.basic_animations.running_glb_url
                                            }
                                            if (riggingStatusData.basic_animations.walking_glb_url) {
                                              animations.walking = riggingStatusData.basic_animations.walking_glb_url
                                            }
                                          }
                                          
                                          // Check if animations might be nested in model_urls or elsewhere
                                          const responseStr = JSON.stringify(riggingStatusData)
                                          if (responseStr.toLowerCase().includes("animation") || responseStr.toLowerCase().includes("running") || responseStr.toLowerCase().includes("walking")) {
                                            console.warn("⚠️ Found animation-related keywords in response, but structure may be different")
                                            console.warn("Full response string search:", responseStr)
                                          }
                                          
                                          // Deep search for animation URLs in the entire response
                                          const deepSearchAnimations = (obj: any, path = ""): void => {
                                            if (!obj || typeof obj !== "object") return
                                            
                                            for (const [key, value] of Object.entries(obj)) {
                                              const currentPath = path ? `${path}.${key}` : key
                                              
                                              // Check if this looks like an animation URL
                                              if (typeof value === "string" && value.includes(".glb") && (key.toLowerCase().includes("run") || key.toLowerCase().includes("walk") || key.toLowerCase().includes("anim"))) {
                                                console.log(`🔍 Found potential animation at ${currentPath}:`, value)
                                                if (key.toLowerCase().includes("run")) {
                                                  animations.running = value
                                                } else if (key.toLowerCase().includes("walk")) {
                                                  animations.walking = value
                                                }
                                              }
                                              
                                              // Recursively search nested objects
                                              if (typeof value === "object" && value !== null) {
                                                deepSearchAnimations(value, currentPath)
                                              }
                                            }
                                          }
                                          
                                          // Perform deep search if animations not found in expected locations
                                          if (!animations.running && !animations.walking) {
                                            console.log("🔍 Performing deep search for animations in response...")
                                            deepSearchAnimations(riggingStatusData)
                                          }
                                          
                                          // If no animations found in rigging response, create animation tasks
                                          if (!animations.running && !animations.walking) {
                                            console.log("🎬 No basic_animations in rigging response. Creating separate animation tasks...")
                                            
                                            // Create animation tasks for running and walking
                                            // action_id must be an integer from Meshy animation library
                                            // Common IDs: 1 (Walking_Woman), 30 (Casual_Walk), 14 (Run_02), 15 (Run_03), 16 (RunFast)
                                            const createAnimationTask = async (actionId: number, animType: "running" | "walking"): Promise<string | null> => {
                                              try {
                                                const animResponse = await fetch("/api/meshy/animations", {
                                                  method: "POST",
                                                  headers: {
                                                    "Content-Type": "application/json",
                                                  },
                                                  body: JSON.stringify({
                                                    rig_task_id: riggingData.taskId, // Meshy API requires rig_task_id, not input_task_id
                                                    action_id: actionId, // Must be an integer
                                                  }),
                                                })
                                                
                                                if (animResponse.ok) {
                                                  const animData = await animResponse.json()
                                                  console.log(`✅ Created ${animType} animation task:`, animData.taskId)
                                                  return animData.taskId
                                                } else {
                                                  const errorText = await animResponse.text()
                                                  console.warn(`Failed to create ${animType} animation task (action_id: ${actionId}):`, errorText)
                                                  return null
                                                }
                                              } catch (error) {
                                                console.error(`Error creating ${animType} animation task:`, error)
                                                return null
                                              }
                                            }
                                            
                                            // Use numeric action IDs from Meshy animation library
                                            // Walking: 1 (Walking_Woman) or 30 (Casual_Walk)
                                            // Running: 14 (Run_02), 15 (Run_03), or 16 (RunFast)
                                            const runningTaskId = await createAnimationTask(14, "running") // Run_02
                                            const walkingTaskId = await createAnimationTask(1, "walking") // Walking_Woman
                                            
                                            if (runningTaskId || walkingTaskId) {
                                              setGenerationStatus("Creating animations...")
                                              
                                              // Poll for animation tasks
                                              const pollAnimationTask = async (taskId: string, animType: "running" | "walking"): Promise<string | null> => {
                                                let attempts = 0
                                                const maxAttempts = 120
                                                const pollInterval = 5000
                                                
                                                return new Promise((resolve) => {
                                                  const poll = async () => {
                                                    try {
                                                      const statusRes = await fetch(`/api/meshy/status/${encodeURIComponent(taskId)}`)
                                                      if (!statusRes.ok) {
                                                        resolve(null)
                                                        return
                                                      }
                                                      
                                                      const statusData = await statusRes.json()
                                                      attempts++
                                                      
                                                      if (statusData.status === "SUCCEEDED" || statusData.status === "completed") {
                                                        // Animation task result contains animation_glb_url
                                                        const animUrl = statusData.result?.animation_glb_url || statusData.modelUrl
                                                        if (animUrl) {
                                                          console.log(`✅ ${animType} animation task succeeded:`, animUrl)
                                                          resolve(animUrl)
                                                        } else {
                                                          console.warn(`⚠️ ${animType} animation task succeeded but no URL found`)
                                                          resolve(null)
                                                        }
                                                      } else if (statusData.status === "FAILED" || statusData.status === "failed") {
                                                        console.warn(`⚠️ ${animType} animation task failed`)
                                                        resolve(null)
                                                      } else if (attempts < maxAttempts) {
                                                        setTimeout(poll, pollInterval)
                                                      } else {
                                                        console.warn(`⚠️ ${animType} animation task timed out`)
                                                        resolve(null)
                                                      }
                                                    } catch (error) {
                                                      console.error(`Error polling ${animType} animation task:`, error)
                                                      resolve(null)
                                                    }
                                                  }
                                                  
                                                  setTimeout(poll, 2000)
                                                })
                                              }
                                              
                                              // Poll for both animations
                                              const [runningUrl, walkingUrl] = await Promise.all([
                                                runningTaskId ? pollAnimationTask(runningTaskId, "running") : Promise.resolve(null),
                                                walkingTaskId ? pollAnimationTask(walkingTaskId, "walking") : Promise.resolve(null),
                                              ])
                                              
                                              if (runningUrl) animations.running = runningUrl
                                              if (walkingUrl) animations.walking = walkingUrl
                                            } else {
                                              console.warn("⚠️ Failed to create animation tasks")
                                            }
                                          }
                                          
                                            // Store in sessionStorage for use in World
                                          if (Object.keys(animations).length > 0) {
                                            sessionStorage.setItem("playerAnimations", JSON.stringify(animations))
                                            console.log("💾 Stored animations in sessionStorage:", animations)
                                          }
                                          
                                          // Show animation selection UI if animations are available
                                          if (Object.keys(animations).length > 0) {
                                            setAvailableAnimations(animations)
                                            // Default to running if available
                                            const defaultAnim = animations.running || animations.walking || ""
                                            setSelectedAnimation(defaultAnim)
                                            console.log("🎨 Animation selection UI will be shown")
                                            
                                            // Reload model in 3D viewer when rigging finishes
                                            const newSavedModel: SavedModel = {
                                              prompt: prompt.trim(),
                                              modelUrl: riggedModelUrl,
                                              timestamp: Date.now(),
                                              animations: animations
                                            }
                                            addSavedModel(newSavedModel)
                                            
                                            // Load the default animation model instead of rigged model
                                            if (defaultAnim) {
                                              console.log("🎬 Loading default animation model:", defaultAnim)
                                              setModelUrl(defaultAnim)
                                            } else {
                                              setModelUrl(riggedModelUrl)
                                            }
                                            setIsModelLoading(true)
                                            setIsGenerating(false)
                                            return
                                          } else {
                                            console.warn("⚠️ No animations available - animation selection UI will not be shown")
                                            
                                            // Reload model in 3D viewer when rigging finishes (no animations)
                                            const newSavedModel: SavedModel = {
                                              prompt: prompt.trim(),
                                              modelUrl: riggedModelUrl,
                                              timestamp: Date.now()
                                            }
                                            addSavedModel(newSavedModel)
                                            setModelUrl(riggedModelUrl)
                                            setIsModelLoading(true)
                                            setIsGenerating(false)
                                            return
                                          }
                                        }
                                      } else if (riggingStatusData.status === "failed" || riggingStatusData.status === "FAILED") {
                                        console.warn("Rigging task failed, using retextured model:", riggingStatusData.error)
                                        // Fall through to use retextured model
                                      } else if (riggingStatusData.status === "PENDING" || riggingStatusData.status === "IN_PROGRESS") {
                                        if (riggingAttempts < riggingMaxAttempts) {
                                          setTimeout(pollRiggingResult, riggingPollInterval)
                                          return
                                        } else {
                                          console.warn("Rigging task timed out, using retextured model")
                                          // Fall through to use retextured model
                                        }
                                      }
                                      
                                      // If rigging didn't complete or failed, use retextured model
                                      console.log("Using retextured model (rigging not available or failed):", retexturedModelUrl)
                                      const newSavedModel: SavedModel = {
                                        prompt: prompt.trim(),
                                        modelUrl: retexturedModelUrl,
                                        timestamp: Date.now()
                                      }
                                      addSavedModel(newSavedModel)
                                      setModelUrl(retexturedModelUrl)
                                      setIsModelLoading(true)
                                      setIsGenerating(false) // All stages complete
                                    } catch (error) {
                                      console.error("Error polling rigging task:", error)
                                      // Fall back to retextured model
                                      const newSavedModel: SavedModel = {
                                        prompt: prompt.trim(),
                                        modelUrl: retexturedModelUrl,
                                        timestamp: Date.now()
                                      }
                                      addSavedModel(newSavedModel)
                                      setModelUrl(retexturedModelUrl)
                                      setIsModelLoading(true)
                                    }
                                  }
                                  
                                  // Start polling rigging task
                                  setTimeout(pollRiggingResult, 2000)
                                  return
                                } else {
                                  const errorText = await riggingResponse.text()
                                  console.warn("Failed to create rigging task, using retextured model:", errorText)
                                  // Fall through to use retextured model
                                }
                              } catch (error) {
                                console.error("Error creating rigging task:", error)
                                // Fall through to use retextured model
                              }
                              
                              // Use retextured model if rigging fails
                              const newSavedModel: SavedModel = {
                                prompt: prompt.trim(),
                                modelUrl: retexturedModelUrl,
                                timestamp: Date.now()
                              }
                              addSavedModel(newSavedModel)
                              setModelUrl(retexturedModelUrl)
                              setIsModelLoading(true)
                              return
                            }
                          } else if (retextureStatusData.status === "failed" || retextureStatusData.status === "FAILED") {
                            console.warn("Retexture task failed, using original model:", retextureStatusData.error)
                            // Fall through to use original model
                          } else if (retextureStatusData.status === "PENDING" || retextureStatusData.status === "IN_PROGRESS") {
                            if (retextureAttempts < retextureMaxAttempts) {
                              setTimeout(pollRetextureResult, retexturePollInterval)
                              return
                            } else {
                              console.warn("Retexture task timed out, using original model")
                              // Fall through to use original model
                            }
                          }
                          
                          // If retexture didn't complete or failed, use original model
                          console.log("Using original model (retexture not available or failed):", statusData.modelUrl)
                          const newSavedModel: SavedModel = {
                            prompt: prompt.trim(),
                            modelUrl: statusData.modelUrl,
                            timestamp: Date.now()
                          }
                          addSavedModel(newSavedModel)
                          setModelUrl(statusData.modelUrl)
                          setIsModelLoading(true)
                        } catch (error) {
                          console.error("Error polling retexture task:", error)
                          // Fall back to original model
                          const newSavedModel: SavedModel = {
                            prompt: prompt.trim(),
                            modelUrl: statusData.modelUrl,
                            timestamp: Date.now()
                          }
                          addSavedModel(newSavedModel)
                          setModelUrl(statusData.modelUrl)
                          setIsModelLoading(true)
                        }
                      }
                      
                      // Start polling retexture task
                      setTimeout(pollRetextureResult, 2000)
                      return
                    } else {
                      const errorText = await retextureResponse.text()
                      console.warn("Failed to create retexture task, using original model:", errorText)
                      // Fall through to use original model
                    }
                  } catch (error) {
                    console.error("Error creating retexture task:", error)
                    // Fall through to use original model
                  }
                }
                
                // Use original model (no texture prompt or retexture failed)
                console.log("Model generation succeeded! Setting model URL:", statusData.modelUrl)
                console.log("Current modelUrl state before update:", modelUrl)
                
                // Save model to shared history
                const newSavedModel: SavedModel = {
                  prompt: prompt.trim(),
                  modelUrl: statusData.modelUrl,
                  timestamp: Date.now()
                }
                addSavedModel(newSavedModel)
                
                setGenerationStatus("Loading model...")
                setModelUrl(statusData.modelUrl)
                setIsModelLoading(true) // Start loading indicator
                // Keep isGenerating true until model loads - it will be set to false in the model loading callback
                // Don't clear progress yet - wait for model to load
                console.log("Model URL state updated, useEffect should trigger model loading")
                return // Stop polling - model loading will continue in useEffect
              } else {
                console.warn("Status is SUCCEEDED but no modelUrl provided. Full response:", JSON.stringify(statusData, null, 2))
                // Continue polling in case the URL appears in the next check
                if (attempts < maxAttempts) {
                  console.log("Continuing to poll for modelUrl...")
                  setTimeout(pollResult, pollInterval)
                } else {
                  setIsGenerating(false)
                  setGenerationProgress({ attempts: 0, estimatedTime: 0, loadingPercent: 0 })
                  throw new Error("Model generation completed but no model URL was provided")
                }
              }
            } else if (statusData.status === "failed" || statusData.status === "FAILED") {
              setIsGenerating(false)
              setGenerationProgress({ attempts: 0, estimatedTime: 0, loadingPercent: 0 })
              throw new Error(statusData.error || "Model generation failed")
            } else if (statusData.status === "CANCELED") {
              setIsGenerating(false)
              setGenerationProgress({ attempts: 0, estimatedTime: 0, loadingPercent: 0 })
              throw new Error("Model generation was canceled")
            } else if (statusData.status === "PENDING" || statusData.status === "IN_PROGRESS") {
              // Still processing, poll again
              if (attempts < maxAttempts) {
                console.log(`Still processing... (attempt ${attempts}/${maxAttempts})`)
                setTimeout(pollResult, pollInterval)
              } else {
                setIsGenerating(false)
                setGenerationProgress({ attempts: 0, estimatedTime: 0, loadingPercent: 0 })
                throw new Error("Model generation timed out")
              }
            } else {
              // Unknown status, continue polling
              if (attempts < maxAttempts) {
                console.warn(`Unknown status: ${statusData.status}, continuing to poll...`)
                setTimeout(pollResult, pollInterval)
              } else {
                setIsGenerating(false)
                setGenerationProgress({ attempts: 0, estimatedTime: 0, loadingPercent: 0 })
                throw new Error(`Model generation ended with unknown status: ${statusData.status}`)
              }
            }
          } catch (error) {
            setIsGenerating(false)
            setGenerationProgress({ attempts: 0, estimatedTime: 0, loadingPercent: 0 })
            throw error
          }
        }
        
        // Start polling after a short delay
        setTimeout(pollResult, 2000)
      } else if (data.modelUrl) {
        // Direct URL (if API returns it immediately)
        setModelUrl(data.modelUrl)
      } else {
        throw new Error("Unexpected response format from API")
      }
    } catch (error) {
      console.error("Error generating model:", error)
      let errorMessage = "Failed to generate 3D model."
      
      if (error instanceof Error) {
        if (error.message.includes("404")) {
          errorMessage = "API endpoint not found. Please restart the dev server and ensure MESHY_API_KEY is set in your environment."
        } else if (error.message.includes("500")) {
          errorMessage = "Server error. Please check that MESHY_API_KEY is set correctly in your environment variables."
        } else {
          errorMessage = error.message
        }
      }
      
      alert(errorMessage)
    } finally {
      setIsGenerating(false)
    }
  }

  // Load a test model for debugging
  const loadTestModel = () => {
    // Using a sample GLB model from glTF Sample Models
    // This is a simple duck model that's publicly available
    const sampleUrl = "https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/master/2.0/Duck/glTF-Binary/Duck.glb"
    console.log("🧪 Loading test model:", sampleUrl)
    setModelUrl(sampleUrl)
  }

  // Handle file upload
  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    // Check if it's a GLB/GLTF file
    const fileName = file.name.toLowerCase()
    if (!fileName.endsWith('.glb') && !fileName.endsWith('.gltf')) {
      alert("Please upload a GLB or GLTF file")
      return
    }

    // Create a local URL for the file
    const fileUrl = URL.createObjectURL(file)
    console.log("Loading uploaded file:", file.name)
    setModelUrl(fileUrl)
  }

  // Handle direct GLB URL only
  const handleMeshyUrl = () => {
    const url = testModelUrl.trim()
    if (!url) {
      alert("Please enter a GLB URL")
      return
    }

    // Validate it's a GLB/GLTF URL
    if (!url.toLowerCase().endsWith('.glb') && !url.toLowerCase().endsWith('.gltf')) {
      alert("Please enter a direct GLB or GLTF file URL (must end with .glb or .gltf)")
      return
    }

    // Load the direct GLB URL
    console.log("Loading model from direct GLB URL:", url)
    setModelUrl(url)
  }

  // Load a custom model URL (for testing with Meshy.ai generated models)
  const loadCustomModel = () => {
    handleMeshyUrl()
  }

  // Function to add animations to a saved model
  const addAnimationsToModel = async (saved: SavedModel) => {
    if (isGenerating || isModelLoading) return
    
    setIsGenerating(true)
    setGenerationStatus("Rigging model...")
    
    try {
      // Step 1: Rig the model first
      const riggingResponse = await fetch("/api/meshy/rigging", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model_url: saved.modelUrl,
          height_meters: 1.7,
        }),
      })

      if (!riggingResponse.ok) {
        const errorText = await riggingResponse.text()
        throw new Error(`Failed to create rigging task: ${errorText}`)
      }

      const riggingData = await riggingResponse.json()
      console.log("Rigging task created for saved model:", riggingData)

      // Step 2: Poll for rigging completion
      let riggingAttempts = 0
      const riggingMaxAttempts = 120
      const riggingPollInterval = 5000

      const pollRigging = async (): Promise<string | null> => {
        const statusRes = await fetch(`/api/meshy/status/${encodeURIComponent(riggingData.taskId)}`)
        if (!statusRes.ok) {
          throw new Error("Failed to check rigging status")
        }

        const statusData = await statusRes.json()
        riggingAttempts++

        if (statusData.status === "SUCCEEDED" || statusData.status === "completed") {
          const riggedUrl = statusData.result?.rigged_character_glb_url || statusData.modelUrl
          
          // Check if basic_animations were included in rigging response
          const animations: { running?: string; walking?: string } = {}
          if (statusData.result?.basic_animations) {
            if (statusData.result.basic_animations.running_glb_url) {
              animations.running = statusData.result.basic_animations.running_glb_url
            }
            if (statusData.result.basic_animations.walking_glb_url) {
              animations.walking = statusData.result.basic_animations.walking_glb_url
            }
          }

          // If animations found, we're done
          if (Object.keys(animations).length > 0) {
            console.log("✅ Found animations in rigging response:", animations)
            sessionStorage.setItem("playerAnimations", JSON.stringify(animations))
            setAvailableAnimations(animations)
            setSelectedAnimation(animations.running || animations.walking || "")
            setModelUrl(riggedUrl || saved.modelUrl)
            setIsGenerating(false)
            return riggedUrl || saved.modelUrl
          }

          // If no animations, create animation tasks
          if (riggedUrl) {
            setGenerationStatus("Creating animations...")
            console.log("No animations in rigging response, creating animation tasks...")

            // Create animation tasks
            // action_id must be an integer from Meshy animation library
            // Common IDs: 1 (Walking_Woman), 30 (Casual_Walk), 14 (Run_02), 15 (Run_03), 16 (RunFast)
            const createAnimationTask = async (actionId: number, animType: "running" | "walking"): Promise<string | null> => {
              try {
                const animResponse = await fetch("/api/meshy/animations", {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                  },
                  body: JSON.stringify({
                    input_task_id: riggingData.taskId,
                    action_id: actionId, // Must be an integer
                  }),
                })

                if (animResponse.ok) {
                  const animData = await animResponse.json()
                  console.log(`✅ Created ${animType} animation task:`, animData.taskId)
                  return animData.taskId
                } else {
                  const errorText = await animResponse.text()
                  console.warn(`Failed to create ${animType} animation task (action_id: ${actionId}):`, errorText)
                  return null
                }
              } catch (error) {
                console.error(`Error creating ${animType} animation task:`, error)
                return null
              }
            }

            // Use numeric action IDs from Meshy animation library
            // Walking: 1 (Walking_Woman) or 30 (Casual_Walk)
            // Running: 14 (Run_02), 15 (Run_03), or 16 (RunFast)
            const runningTaskId = await createAnimationTask(14, "running") // Run_02
            const walkingTaskId = await createAnimationTask(1, "walking") // Walking_Woman

            if (runningTaskId || walkingTaskId) {
              // Poll for animation tasks
              const pollAnimationTask = async (taskId: string, animType: "running" | "walking"): Promise<string | null> => {
                let attempts = 0
                const maxAttempts = 120
                const pollInterval = 5000

                return new Promise((resolve) => {
                  const poll = async () => {
                    try {
                      const statusRes = await fetch(`/api/meshy/status/${encodeURIComponent(taskId)}`)
                      if (!statusRes.ok) {
                        resolve(null)
                        return
                      }

                      const statusData = await statusRes.json()
                      attempts++

                      if (statusData.status === "SUCCEEDED" || statusData.status === "completed") {
                        const animUrl = statusData.result?.animation_glb_url || statusData.modelUrl
                        if (animUrl) {
                          console.log(`✅ ${animType} animation task succeeded:`, animUrl)
                          resolve(animUrl)
                        } else {
                          resolve(null)
                        }
                      } else if (statusData.status === "FAILED" || statusData.status === "failed") {
                        resolve(null)
                      } else if (attempts < maxAttempts) {
                        setTimeout(poll, pollInterval)
                      } else {
                        resolve(null)
                      }
                    } catch (error) {
                      resolve(null)
                    }
                  }
                  setTimeout(poll, 2000)
                })
              }

              const [runningUrl, walkingUrl] = await Promise.all([
                runningTaskId ? pollAnimationTask(runningTaskId, "running") : Promise.resolve(null),
                walkingTaskId ? pollAnimationTask(walkingTaskId, "walking") : Promise.resolve(null),
              ])

              const finalAnimations: { running?: string; walking?: string } = {}
              if (runningUrl) finalAnimations.running = runningUrl
              if (walkingUrl) finalAnimations.walking = walkingUrl

              if (Object.keys(finalAnimations).length > 0) {
                sessionStorage.setItem("playerAnimations", JSON.stringify(finalAnimations))
                setAvailableAnimations(finalAnimations)
                const defaultAnim = finalAnimations.running || finalAnimations.walking || ""
                setSelectedAnimation(defaultAnim)
                console.log("✅ Animations created successfully:", finalAnimations)
                
                // Update the saved model with animations
                // Find and update the saved model in storage
                const savedModelsArray = savedModelsStorage ? Array.from(savedModelsStorage) : []
                const modelIndex = savedModelsArray.findIndex((m: any) => (m as SavedModel).modelUrl === saved.modelUrl)
                if (modelIndex >= 0) {
                  const existingModel = savedModelsArray[modelIndex] as SavedModel
                  const updatedModel: SavedModel = {
                    prompt: existingModel.prompt,
                    modelUrl: existingModel.modelUrl,
                    timestamp: existingModel.timestamp,
                    animations: finalAnimations
                  }
                  // Update in storage
                  const models = savedModelsStorage
                  if (models) {
                    const existing: SavedModel[] = []
                    for (let i = 0; i < models.length; i++) {
                      const m = models.get(i) as SavedModel
                      if (i === modelIndex) {
                        existing.push(updatedModel)
                      } else {
                        existing.push(m)
                      }
                    }
                    // Clear and repopulate
                    while (models.length > 0) {
                      models.delete(models.length - 1)
                    }
                    existing.forEach((m: SavedModel) => models.push(m))
                  }
                }
                
                // Load the default animation model if available
                if (defaultAnim) {
                  setModelUrl(defaultAnim)
                } else {
                  setModelUrl(riggedUrl)
                }
              } else {
                console.warn("⚠️ Animation tasks completed but no URLs found")
                setModelUrl(riggedUrl)
              }
            } else {
              setModelUrl(riggedUrl)
            }

            setIsGenerating(false)
            setGenerationStatus("Animations complete")
            return riggedUrl
          }
        } else if (statusData.status === "FAILED" || statusData.status === "failed") {
          throw new Error(`Rigging failed: ${statusData.error || "Unknown error"}`)
        } else if (riggingAttempts < riggingMaxAttempts) {
          setTimeout(pollRigging, riggingPollInterval)
          return null
        } else {
          throw new Error("Rigging timed out")
        }
        return null
      }

      await pollRigging()
    } catch (error) {
      console.error("Error adding animations to model:", error)
      alert(`Failed to add animations: ${error instanceof Error ? error.message : "Unknown error"}`)
      setIsGenerating(false)
      setGenerationStatus("")
    }
  }

  const submit = () => {
    const n = name.trim()
    if (!n) return
    
    // IMPORTANT: Meshy animation GLB files are static models (no animation clips)
    // So we should use the rigged model URL and store animations separately
    // The rigged model has bones that can be animated, but Meshy's animation GLBs are just poses
    
    // Find the base rigged model URL (not the animation URL)
    let baseModelUrl = modelUrl
    if (modelUrl && availableAnimations) {
      // If current modelUrl is an animation URL, find the base model
      const isAnimationUrl = availableAnimations.running === modelUrl || availableAnimations.walking === modelUrl
      if (isAnimationUrl) {
        // Find the saved model with this animation
        const savedModel = savedModels.find((m: SavedModel) => {
          if (m.animations) {
            return m.animations.running === modelUrl || m.animations.walking === modelUrl
          }
          return false
        })
        if (savedModel) {
          baseModelUrl = savedModel.modelUrl
          console.log("Using base rigged model URL instead of animation URL:", baseModelUrl)
        }
      }
    }
    
    // Ensure animations are saved to sessionStorage before joining
    if (availableAnimations && Object.keys(availableAnimations).length > 0) {
      sessionStorage.setItem("playerAnimations", JSON.stringify(availableAnimations))
      console.log("💾 Saving animations to sessionStorage before joining:", availableAnimations)
    } else {
      // Clear animations if none available
      sessionStorage.removeItem("playerAnimations")
    }
    
    // Use base model URL (rigged model) - animations will be handled separately in World
    const finalModelUrl = baseModelUrl
    
    // If we have a model URL but it's not loaded yet, wait for it
    if (finalModelUrl && !isModelLoaded) {
      // Wait a bit for the model to finish loading
      const checkLoaded = setInterval(() => {
        if (isModelLoaded) {
          clearInterval(checkLoaded)
          onConfirm(n, finalModelUrl)
        }
      }, 100)
      
      // Timeout after 5 seconds
      setTimeout(() => {
        clearInterval(checkLoaded)
        onConfirm(n, finalModelUrl) // Join anyway with the URL
      }, 5000)
    } else {
      onConfirm(n, finalModelUrl || undefined)
    }
  }

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  return (
    <div className={styles.fullScreenContainer} role="dialog" aria-modal="true">
      {/* Full screen 3D viewer */}
      <div
        className={styles.canvasWrapper}
        ref={containerRef}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        <canvas ref={canvasRef} className={styles.canvas} />
        {isDragging && <div className={styles.dragHint}>Drag to rotate</div>}
      </div>

      {/* Top Left: Character Creation Panel */}
      <div className={styles.topLeftPanel}>
        <h2 className={styles.panelTitle}>Create Your Character</h2>
        
        {/* Balance display */}
        {balance !== null && (
          <div className={styles.balanceInfo}>
            Credits: {balance.balance !== undefined ? balance.balance.toLocaleString() : "N/A"}
          </div>
        )}

        {/* Prompt input for AI generation */}
        <div className={styles.promptSection}>
              <input
                className={styles.promptInput}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !isGenerating) generateModel()
                }}
                placeholder="Describe your character (e.g., 'a warrior with armor')"
                disabled={isGenerating}
              />
              <select
                className={styles.promptInput}
                value={poseMode}
                onChange={(e) => setPoseMode(e.target.value as "a-pose" | "t-pose" | "")}
                disabled={isGenerating}
                style={{ marginTop: "8px" }}
              >
                <option value="">Select pose mode...</option>
                <option value="a-pose">A-Pose</option>
                <option value="t-pose">T-Pose</option>
              </select>
              <button
                className={styles.generateButton}
                onClick={generateModel}
                disabled={!prompt.trim() || !poseMode || isGenerating}
              >
                {isGenerating ? (generationStatus ? `Generating (${generationStatus})` : "Generating...") : "Generate 3D Model"}
              </button>
              <button
                className={styles.testButton}
                onClick={loadTestModel}
                disabled={isGenerating}
                title="Load a test model to verify 3D viewer works"
              >
                Load Test Model
              </button>
              
              {/* File Upload */}
              <label className={styles.testButton} style={{ display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", marginTop: "8px" }}>
                Upload GLB/GLTF
                <input
                  type="file"
                  accept=".glb,.gltf"
                  onChange={handleFileUpload}
                  disabled={isGenerating}
                  style={{ display: "none" }}
                />
              </label>

              {/* URL Input */}
              <div style={{ display: "flex", gap: "8px", marginTop: "8px" }}>
                <input
                  className={styles.promptInput}
                  value={testModelUrl}
                  onChange={(e) => setTestModelUrl(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !isGenerating) loadCustomModel()
                  }}
                  placeholder="Paste direct GLB/GLTF URL..."
                  disabled={isGenerating}
                  style={{ flex: 1, fontSize: "12px" }}
                />
                <button
                  className={styles.testButton}
                  onClick={loadCustomModel}
                  disabled={!testModelUrl.trim() || isGenerating}
                  title="Load model from URL"
                  style={{ minWidth: "80px" }}
                >
                  Load URL
                </button>
              </div>
              
        </div>
      </div>

      {/* Top Right: Username & Join */}
      <div className={styles.topRightPanel}>
        <div className={styles.inputGroup}>
          <label className={styles.label}>Your Name</label>
          <input
            ref={inputRef}
            className={styles.input}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit()
            }}
            placeholder="Enter your name..."
            maxLength={24}
          />
        </div>
        <button
          className={styles.button}
          type="button"
          onClick={submit}
          disabled={!name.trim()}
        >
          Join Game
        </button>
      </div>

      {/* Bottom Left: Saved Models Gallery */}
      {savedModels.length > 0 && (
        <div className={styles.bottomLeftPanel}>
          <h3 className={styles.savedModelsTitle}>Community Models</h3>
              <div className={styles.savedModelsGrid}>
                {savedModels.map((saved: SavedModel, index: number) => (
                  <div
                    key={`${saved.modelUrl}-${index}`}
                    className={styles.savedModelCard}
                    style={{ position: "relative", display: "flex", flexDirection: "column" }}
                  >
                    <button
                      onClick={() => {
                        // Always load the base rigged model first
                        setModelUrl(saved.modelUrl)
                        setBaseRiggedModelUrl(saved.modelUrl) // Store as base model
                        setPrompt(saved.prompt)
                        // If model has animations, load them
                        if (saved.animations && Object.keys(saved.animations).length > 0) {
                          setAvailableAnimations(saved.animations)
                          setSelectedAnimation("") // Don't auto-select, let user choose
                          sessionStorage.setItem("playerAnimations", JSON.stringify(saved.animations))
                        } else {
                          setAvailableAnimations(null)
                          setSelectedAnimation("")
                        }
                      }}
                      disabled={isGenerating || isModelLoading}
                      title={saved.prompt}
                      style={{ 
                        flex: 1, 
                        background: "none", 
                        border: "none", 
                        padding: 0, 
                        cursor: isGenerating || isModelLoading ? "not-allowed" : "pointer",
                        textAlign: "left",
                        width: "100%"
                      }}
                    >
                      <div className={styles.savedModelPrompt}>{saved.prompt}</div>
                      <div className={styles.savedModelDate}>
                        {new Date(saved.timestamp).toLocaleDateString()}
                        {saved.animations && Object.keys(saved.animations).length > 0 && (
                          <span style={{ marginLeft: "8px", color: "rgba(88, 242, 135, 0.8)" }}>• Animated</span>
                        )}
                      </div>
                    </button>
                    {/* Only show "Add Animations" button if model doesn't have animations */}
                    {!saved.animations || (Object.keys(saved.animations).length === 0) ? (
                    <button
                      className={styles.testButton}
                      onClick={(e) => {
                        e.stopPropagation()
                          addAnimationsToModel(saved)
                      }}
                      disabled={isGenerating || isModelLoading}
                        style={{ marginTop: "8px", fontSize: "11px", padding: "6px 12px", width: "100%" }}
                        title="Add animations to this model (rigs and creates running/walking animations)"
                    >
                        {isGenerating ? "Adding Animations..." : "Add Animations"}
                    </button>
                    ) : (
                      <div style={{ marginTop: "8px", fontSize: "10px", color: "rgba(88, 242, 135, 0.8)", textAlign: "center" }}>
                        ✓ Has Animations
                      </div>
                    )}
                  </div>
                ))}
              </div>
        </div>
      )}

      {/* Bottom Right: Animation Selection */}
      {availableAnimations && Object.keys(availableAnimations).length > 0 && (
        <div className={styles.bottomRightPanel}>
          <div className={styles.animationSelection}>
            <h3 style={{ marginTop: 0, marginBottom: "12px" }}>Animations Available</h3>
            <label>Select Animation:</label>
            <select
              value={selectedAnimation}
              onChange={(e) => {
                const newSelection = e.target.value
                setSelectedAnimation(newSelection)
                console.log("Animation selection changed to:", newSelection)
                
                // Armature workflow: Keep base model loaded, load armature separately
                if (newSelection && modelRef.current && baseRiggedModelUrl) {
                  console.log("Loading armature animation:", newSelection)
                  setIsModelLoading(true)
                  
                  // Load armature GLB (contains skeleton + animation clip)
                  const armatureLoader = new GLTFLoader()
                  const needsProxy = newSelection.includes('assets.meshy.ai')
                  const loadUrl = needsProxy ? `/api/meshy/proxy?url=${encodeURIComponent(newSelection)}` : newSelection
                  
                  armatureLoader.load(
                    loadUrl,
                    (armatureGltf) => {
                      const animations = armatureGltf.animations
                      if (animations && animations.length > 0) {
                        console.log("✅ Loaded armature with", animations.length, "animation(s)")
                        
                        // Get the base model (should already be loaded)
                        const baseModel = modelRef.current
                        if (baseModel) {
                          // Stop any existing animations
                          const oldMixer = (baseModel.userData as any)?.mixer as AnimationMixer | undefined
                          if (oldMixer) {
                            oldMixer.stopAllAction()
                            oldMixer.uncacheRoot(baseModel)
                          }
                          
                          // Create new mixer for base model
                          const mixer = new AnimationMixer(baseModel)
                          
                          // Apply animation clip from armature to base model
                          for (let i = 0; i < animations.length; i++) {
                            const clip = animations[i]
                            const action = mixer.clipAction(clip)
                            action.play()
                            console.log("▶️ Applied animation:", clip.name, "duration:", clip.duration)
                          }
                          
                          // Store mixer for animation loop
                          (baseModel.userData as any).mixer = mixer
                          
                          setIsModelLoading(false)
                          console.log("✅ Animation applied to base model")
                        } else {
                          console.warn("⚠️ Base model not loaded, cannot apply animation")
                          setIsModelLoading(false)
                        }
                      } else {
                        console.warn("⚠️ Armature GLB contains no animation clips")
                        setIsModelLoading(false)
                      }
                    },
                    undefined,
                    (error) => {
                      console.error("Failed to load armature:", error)
                      setIsModelLoading(false)
                      alert(`Failed to load animation: ${error instanceof Error ? error.message : "Unknown error"}`)
                    }
                  )
                } else if (!newSelection) {
                  // Reset to base rigged model if "None" selected
                  const baseUrl = baseRiggedModelUrl || savedModels.find((m: SavedModel) => {
                    if (m.animations) {
                      return m.animations.running === selectedAnimation || m.animations.walking === selectedAnimation
                    }
                    return false
                  })?.modelUrl
                  
                  if (baseUrl) {
                    console.log("Resetting to base rigged model:", baseUrl)
                    // Stop animations
                    if (modelRef.current) {
                      const mixer = (modelRef.current.userData as any)?.mixer as AnimationMixer | undefined
                      if (mixer) {
                        mixer.stopAllAction()
                        mixer.uncacheRoot(modelRef.current)
                        ;(modelRef.current.userData as any).mixer = null
                      }
                    }
                    // Reload base model if needed
                    if (modelUrl !== baseUrl) {
                      setModelUrl(baseUrl)
                      setIsModelLoading(true)
                    }
                  }
                } else {
                  console.warn("⚠️ Cannot apply animation: base model not loaded or no base URL")
                }
              }}
            >
              <option value="">None (use rigged model)</option>
              {availableAnimations.running && <option value={availableAnimations.running}>Running</option>}
              {availableAnimations.walking && <option value={availableAnimations.walking}>Walking</option>}
            </select>
          </div>
        </div>
      )}
    </div>
  )
}