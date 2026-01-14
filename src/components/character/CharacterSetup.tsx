import { useEffect, useRef, useState } from "react"
import * as THREE from "three"
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js"
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
  thumbnailUrl?: string
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
  const [_generationProgress, setGenerationProgress] = useState({ attempts: 0, estimatedTime: 0, loadingPercent: 0 })
  const [isModelLoaded, setIsModelLoaded] = useState(false)
  const [isModelLoading, setIsModelLoading] = useState(false)
  const [balance, setBalance] = useState<{ balance?: number } | null>(null)
  const [poseMode, setPoseMode] = useState<"a-pose" | "t-pose" | "sitting" | "none" | "">("")
  const [generationStatus, setGenerationStatus] = useState<string>("")
  const [selectedModelVersion, setSelectedModelVersion] = useState<"meshy-4" | "meshy-5" | "latest">("latest")
  const [playerColorHex, setPlayerColorHex] = useState<string>(() => sessionStorage.getItem("playerColor") || "#4aa3ff")
  const savedModelsStorage = useStorage((root: any) => root?.savedModels)
  const savedModels: SavedModel[] = savedModelsStorage ? Array.from(savedModelsStorage) : []
  const addSavedModel = useMutation(({ storage }: any, model: SavedModel) => {
    const models = storage.get("savedModels")
    if (models) {
      const existing: SavedModel[] = [...models]
      const filtered = existing.filter((m: SavedModel) => m.modelUrl !== model.modelUrl)
      const updated = [model, ...filtered].slice(0, 20)
      while (models.length > 0) {
        models.delete(models.length - 1)
      }
      updated.forEach((m: SavedModel) => models.push(m))
    }
  }, [])
  const rotationRef = useRef({ x: 0, y: 0 })
  const zoomDistanceRef = useRef(3.0)
  
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const sceneRef = useRef<THREE.Scene | null>(null)
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null)
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null)
  const modelRef = useRef<THREE.Group | null>(null)
  const animationFrameRef = useRef<number | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const timeRemainingSpriteRef = useRef<{ sprite: THREE.Sprite; texture: THREE.Texture } | null>(null)

  useEffect(() => {
    if (!canvasRef.current) {
      const timeout = setTimeout(() => {
        if (canvasRef.current && !sceneRef.current) {
        }
      }, 50)
      return () => clearTimeout(timeout)
    }

    if (sceneRef.current) {
      return
    }
    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x1a1a1a)
    sceneRef.current = scene

    const canvasWrapper = canvasRef.current?.parentElement
    const width = canvasWrapper?.clientWidth || 800
    const height = canvasWrapper?.clientHeight || 600

    const camera = new THREE.PerspectiveCamera(
      50,
      width / height,
      0.1,
      1000
    )
    const initialY = 1.5
    camera.position.set(0, initialY, zoomDistanceRef.current)
    camera.lookAt(0, 0, 0)
    cameraRef.current = camera

    const renderer = new THREE.WebGLRenderer({ 
      canvas: canvasRef.current,
      antialias: true 
    })
    renderer.setSize(width, height)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    rendererRef.current = renderer

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6)
    scene.add(ambientLight)
    
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8)
    directionalLight.position.set(5, 10, 5)
    scene.add(directionalLight)

    const placeholderGroup = new THREE.Group()
    const capsuleGeometry = new THREE.CapsuleGeometry(0.3, 1.2, 8, 16)
    const capsuleMaterial = new THREE.MeshStandardMaterial({ 
      color: parseInt(playerColorHex.replace("#", ""), 16),
      roughness: 0.4,
      metalness: 0.1
    })
    const capsule = new THREE.Mesh(capsuleGeometry, capsuleMaterial)
    placeholderGroup.add(capsule)
    placeholderGroup.userData = { isPlaceholder: true }
    scene.add(placeholderGroup)
    modelRef.current = placeholderGroup

    setIsSceneReady(true)

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault()
      const delta = e.deltaY > 0 ? 1.1 : 0.9
      zoomDistanceRef.current = Math.max(1.0, Math.min(10.0, zoomDistanceRef.current * delta))
      if (camera) {
        const yOffset = 1.5
        camera.position.set(0, yOffset, zoomDistanceRef.current)
        camera.lookAt(0, 0, 0)
      }
    }
    
    if (canvasRef.current) {
      canvasRef.current.addEventListener('wheel', handleWheel, { passive: false })
    }

    const animate = () => {
        animationFrameRef.current = requestAnimationFrame(animate)
        
        if (modelRef.current) {
          modelRef.current.rotation.y = rotationRef.current.y
          modelRef.current.rotation.x = rotationRef.current.x
        }
        
        renderer.render(scene, camera)
      }
    animate()

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
      if (canvasRef.current) {
        canvasRef.current.removeEventListener('wheel', handleWheel)
      }
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current)
      }
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
  }, [])

  useEffect(() => {
    if (modelRef.current && modelRef.current.userData.isPlaceholder) {
      const capsule = modelRef.current.children[0] as THREE.Mesh
      if (capsule && capsule.material instanceof THREE.MeshStandardMaterial) {
        const colorNum = parseInt(playerColorHex.replace("#", ""), 16)
        capsule.material.color.setHex(colorNum)
      }
    }
  }, [playerColorHex])

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

  const statusSpriteRef = useRef<{ sprite: THREE.Sprite; texture: THREE.Texture } | null>(null)

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

  const handleLoadError = (
    error: unknown,
    modelUrl: string,
    loadUrl: string,
    triedProxy: boolean,
    onRetryWithProxy: () => void
  ) => {
    console.error("Error loading GLTF model:", error)
    setIsModelLoaded(false)
    setIsModelLoading(false)
    setGenerationProgress({ attempts: 0, estimatedTime: 0, loadingPercent: 0 })
    
    // Provide helpful error message
    const errorMsg = error && typeof error === 'object' && 'message' in error ? String(error.message) : "Unknown error"
    const errorMsgLower = errorMsg.toLowerCase()
    
    console.error("❌ Model load error details:", {
      modelUrl,
      loadUrl,
      error: errorMsg,
      triedProxy,
      isAnimationUrl: modelUrl?.includes('/Animation_') || modelUrl?.includes('running') || modelUrl?.includes('walking'),
      urlLength: modelUrl?.length
    })
    
    const isMeshyUrl = modelUrl.includes('assets.meshy.ai')
    const isCorsError = errorMsgLower.includes('cors') || 
                       errorMsgLower.includes('cross-origin') ||
                       errorMsgLower.includes('access-control') ||
                       (error && typeof error === 'object' && 'type' in error && String(error.type).toLowerCase().includes('cors'))
    
    if (isCorsError && !triedProxy && !isMeshyUrl) {
      console.log("🔄 CORS error detected for non-Meshy URL, retrying with proxy...")
      onRetryWithProxy()
      return
    }
    
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
    } else if (isCorsError && !isMeshyUrl) {
      alert("Failed to load model: CORS error. The model URL may not be accessible from this domain.")
    } else {
      alert(`Failed to load 3D model: ${errorMsg}`)
    }
  }

  useEffect(() => {
    if (!modelUrl) {
      return
    }
    
    if (!isSceneReady || !sceneRef.current) {
      return
    }
    
    try {
      new URL(modelUrl)
    } catch (e) {
      console.error("Invalid model URL format:", modelUrl)
      return
    }

    if (modelRef.current && !modelRef.current.userData?.isPlaceholder && modelRef.current.userData?.modelUrl === modelUrl) {
      setIsModelLoaded(true)
      return
    }
    
    setIsModelLoaded(false)
    setIsModelLoading(true)
    
    if (sceneRef.current) {
      sceneRef.current.traverse((child) => {
        if (child.userData?.modelUrl === modelUrl && child !== modelRef.current) {
          child.removeFromParent()
        }
      })
    }

    const oldModel = modelRef.current
    if (oldModel) {
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

    const loader = new GLTFLoader()
    const isMeshyUrl = modelUrl.includes('assets.meshy.ai')
    const loadUrl = isMeshyUrl ? `/api/meshy/proxy?url=${encodeURIComponent(modelUrl)}` : modelUrl
    
    const onLoadSuccess = (gltf: { scene: THREE.Group; animations?: THREE.AnimationClip[] }) => {
      const newModel = gltf.scene
      
      const bbox = new THREE.Box3().setFromObject(newModel)
      const center = bbox.getCenter(new THREE.Vector3())
      const size = bbox.getSize(new THREE.Vector3())
      const maxDim = Math.max(size.x, size.y, size.z)
      const scaleFactor = 1.5 / maxDim

      newModel.scale.set(scaleFactor, scaleFactor, scaleFactor)
      newModel.rotation.y = Math.PI
      newModel.position.set(-center.x * scaleFactor, -center.y * scaleFactor, -center.z * scaleFactor)
      
      newModel.userData = { modelUrl, rotationY: Math.PI }
      
      if (sceneRef.current) {
        sceneRef.current.add(newModel)
        modelRef.current = newModel
        setIsModelLoaded(true)
        setIsModelLoading(false)
        
        const stillGenerating = generationStatus && (
          generationStatus.includes("Mesh complete") || 
          generationStatus.includes("Texture complete") ||
          generationStatus.includes("Texturing")
        )
        
        if (!stillGenerating) {
          setIsGenerating(false)
          setGenerationStatus("")
        }
        
        setGenerationProgress({ attempts: 0, estimatedTime: 0, loadingPercent: 0 })
        
        if (timeRemainingSpriteRef.current) {
          const bbox = new THREE.Box3().setFromObject(newModel)
          const center = bbox.getCenter(new THREE.Vector3())
          const size = bbox.getSize(new THREE.Vector3())
          timeRemainingSpriteRef.current.sprite.position.set(center.x, center.y + size.y * 0.5 + 1, center.z)
        }
      } else {
        console.error("Scene not available when trying to add model!")
      }
    }
    
    const onProgress = (progress: ProgressEvent) => {
      if (progress.lengthComputable) {
        const percentComplete = (progress.loaded / progress.total) * 100
        setGenerationProgress({ 
          attempts: Math.floor(percentComplete / 10), 
          estimatedTime: 0,
          loadingPercent: percentComplete 
        })
      }
    }
    
    const onError = (error: unknown) => {
      if (!isMeshyUrl) {
        console.log("🔄 Error loading non-Meshy URL, retrying with proxy...")
        const proxyUrl = `/api/meshy/proxy?url=${encodeURIComponent(modelUrl)}`
        setIsModelLoading(true)
        loader.load(
          proxyUrl,
          onLoadSuccess,
          onProgress,
          (proxyError: unknown) => {
            handleLoadError(proxyError, modelUrl, proxyUrl, true, () => {})
          }
        )
        return
      }
      
      handleLoadError(error, modelUrl, loadUrl, true, () => {})
    }
    
    loader.load(loadUrl, onLoadSuccess, onProgress, onError)
  }, [modelUrl, isSceneReady])

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

  const generateModel = async () => {
    if (!prompt.trim() || !poseMode) return

    console.log("[Meshy] ===== Starting character generation =====")
    console.log("[Meshy] Selected model version:", selectedModelVersion)
    console.log("[Meshy] Selected pose:", poseMode)
    console.log("[Meshy] Prompt:", prompt.trim())

    setIsGenerating(true)
    setGenerationStatus("Generating 3D model...")
    setGenerationProgress({ attempts: 0, estimatedTime: 50, loadingPercent: 0 })
    try {
      const payload: any = {
        prompt: prompt.trim(),
        texture_prompt: prompt.trim(),
        model: selectedModelVersion,
      }
      
      if (poseMode !== "none") {
        payload.pose_mode = poseMode
        console.log("[Meshy] Including pose_mode:", poseMode)
      } else {
        console.log("[Meshy] Skipping pose_mode (None selected)")
      }
      
      console.log("[Meshy] Request payload:", payload)
      
      const response = await fetch("/api/meshy/generate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      })

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`Failed to generate model: ${response.status} ${response.statusText}. ${errorText}`)
      }

      const data = await response.json()
      
      if (data.taskId) {
        let attempts = 0
        const maxAttempts = 120
        const pollInterval = 5000
        
        const estimatedTotalAttempts = 10
        const estimatedTotalSeconds = estimatedTotalAttempts * (pollInterval / 1000)
        
        const pollResult = async (): Promise<void> => {
          try {
            const statusResponse = await fetch(`/api/meshy/status/${encodeURIComponent(data.taskId)}`)
            if (!statusResponse.ok) {
              throw new Error("Failed to check status")
            }
            
            const statusData = await statusResponse.json()
            
            attempts++
            const apiProgress = statusData.progress !== undefined && statusData.progress !== null
              ? statusData.progress
              : null
            const elapsedSeconds = attempts * (pollInterval / 1000)
            const estimatedRemaining = Math.max(0, estimatedTotalSeconds - elapsedSeconds)
            const loadingPercent = apiProgress !== null ? apiProgress : Math.min((attempts / maxAttempts) * 90, 90)
            
            if (statusData.status === "PENDING" || statusData.status === "IN_PROGRESS") {
              setGenerationStatus(`Generating 3D model... ${Math.round(loadingPercent)}%`)
              setIsGenerating(true) // Ensure it stays true
            } else if (statusData.status === "SUCCEEDED" || statusData.status === "completed") {
              setGenerationStatus("Adding textures...")
              setIsGenerating(true)
            }
            
            setGenerationProgress({ attempts, estimatedTime: estimatedRemaining, loadingPercent })
            
            if (statusData.status === "completed" || statusData.status === "SUCCEEDED") {
              if (statusData.modelUrl) {
                setGenerationStatus("Mesh complete")
                setModelUrl(statusData.modelUrl)
                setIsModelLoading(true)
                
                const texturePrompt = data.texturePrompt || prompt.trim()
                if (texturePrompt) {
                  setGenerationStatus("Texturing model...")
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
                          
                          retextureAttempts++
                          const retextureProgress = retextureStatusData.progress !== undefined && retextureStatusData.progress !== null
                            ? retextureStatusData.progress
                            : Math.min((retextureAttempts / retextureMaxAttempts) * 90, 90)
                          const estimatedRemaining = Math.max(0, estimatedRetextureSeconds - (retextureAttempts * (retexturePollInterval / 1000)))
                          setGenerationProgress({ attempts: attempts + retextureAttempts, estimatedTime: estimatedRemaining, loadingPercent: retextureProgress })
                          
                          if (retextureStatusData.status === "PENDING" || retextureStatusData.status === "IN_PROGRESS") {
                            setGenerationStatus(`Texturing model... ${Math.round(retextureProgress)}%`)
                            setIsGenerating(true)
                            if (retextureAttempts < retextureMaxAttempts) {
                              setTimeout(pollRetextureResult, retexturePollInterval)
                              return
                            }
                          }
                          
                          if (retextureStatusData.status === "completed" || retextureStatusData.status === "SUCCEEDED") {
                            const retexturedModelUrl = retextureStatusData.model_urls?.glb || retextureStatusData.modelUrl
                            if (retexturedModelUrl) {
                              setGenerationStatus("Texture complete")
                              setModelUrl(retexturedModelUrl)
                              setIsModelLoading(true)
                              
                              const newSavedModel: SavedModel = {
                                prompt: prompt.trim(),
                                modelUrl: retexturedModelUrl,
                                timestamp: Date.now(),
                                thumbnailUrl: retextureStatusData.thumbnail_url
                              }
                              addSavedModel(newSavedModel)
                              setIsGenerating(false)
                              setGenerationStatus("Complete")
                              try {
                                await fetch("/api/meshy/balance")
                              } catch (e) {
                                console.warn("[Balance] Failed to refresh:", e)
                              }
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
                          const newSavedModel: SavedModel = {
                            prompt: prompt.trim(),
                            modelUrl: statusData.modelUrl,
                            timestamp: Date.now(),
                            thumbnailUrl: statusData.thumbnailUrl
                          }
                          addSavedModel(newSavedModel)
                          setModelUrl(statusData.modelUrl)
                          setIsModelLoading(true)
                        }
                      }
                      
                      setTimeout(pollRetextureResult, 2000)
                      return
                    } else {
                      const errorText = await retextureResponse.text()
                      console.warn("Failed to create retexture task, using original model:", errorText)
                    }
                  } catch (error) {
                    console.error("Error creating retexture task:", error)
                  }
                }
                
                const newSavedModel: SavedModel = {
                  prompt: prompt.trim(),
                  modelUrl: statusData.modelUrl,
                  timestamp: Date.now(),
                  thumbnailUrl: statusData.thumbnailUrl
                }
                addSavedModel(newSavedModel)
                
                setGenerationStatus("Loading model...")
                setModelUrl(statusData.modelUrl)
                setIsModelLoading(true)
                return
              } else {
                console.warn("Status is SUCCEEDED but no modelUrl provided")
                if (attempts < maxAttempts) {
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
              if (attempts < maxAttempts) {
                setTimeout(pollResult, pollInterval)
              } else {
                setIsGenerating(false)
                setGenerationProgress({ attempts: 0, estimatedTime: 0, loadingPercent: 0 })
                throw new Error("Model generation timed out")
              }
            } else {
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
        
        setTimeout(pollResult, 2000)
      } else if (data.modelUrl) {
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

  const loadTestModel = () => {
    const sampleUrl = "https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/master/2.0/Duck/glTF-Binary/Duck.glb"
    setModelUrl(sampleUrl)
  }

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    const fileName = file.name.toLowerCase()
    if (!fileName.endsWith('.glb') && !fileName.endsWith('.gltf')) {
      alert("Please upload a GLB or GLTF file")
      return
    }

    const fileUrl = URL.createObjectURL(file)
    setModelUrl(fileUrl)
  }

  const handleMeshyUrl = () => {
    const url = testModelUrl.trim()
    if (!url) {
      alert("Please enter a GLB URL")
      return
    }

    if (!url.toLowerCase().endsWith('.glb') && !url.toLowerCase().endsWith('.gltf')) {
      alert("Please enter a direct GLB or GLTF file URL (must end with .glb or .gltf)")
      return
    }

    setModelUrl(url)
  }

  const loadCustomModel = () => {
    handleMeshyUrl()
  }


  const submit = () => {
    const n = name.trim()
    if (!n) return
    
    const finalModelUrl = modelUrl

    try {
      if (playerColorHex) {
        sessionStorage.setItem("playerColor", playerColorHex)
      } else {
        sessionStorage.removeItem("playerColor")
      }
    } catch {
    }
    
    if (finalModelUrl && !isModelLoaded) {
      const checkLoaded = setInterval(() => {
        if (isModelLoaded) {
          clearInterval(checkLoaded)
          onConfirm(n, finalModelUrl)
        }
      }, 100)
      
      setTimeout(() => {
        clearInterval(checkLoaded)
        onConfirm(n, finalModelUrl)
      }, 5000)
    } else {
      onConfirm(n, finalModelUrl || undefined)
    }
  }

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  return (
    <div className={styles.fullScreenContainer} role="dialog" aria-modal="true" style={{ position: "relative" }}>
      {isGenerating && (
        <div 
          className={styles.generatingBorder}
          style={{
            position: "absolute",
            inset: 0,
            pointerEvents: "none",
            zIndex: 1,
          }}
        />
      )}
      <div
        className={styles.canvasWrapper}
        ref={containerRef}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        <canvas ref={canvasRef} className={styles.canvas} />
        {isDragging && <div className={styles.dragHint}>Drag to rotate | Mouse wheel to zoom</div>}
      </div>

      <div className={styles.topLeftPanel}>
        <h2 className={styles.panelTitle}>Create Your Character</h2>
        
        {balance !== null && (
          <div className={styles.balanceInfo}>
            Credits: {balance.balance !== undefined ? balance.balance.toLocaleString() : "N/A"}
          </div>
        )}

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
                onChange={(e) => setPoseMode(e.target.value as "a-pose" | "t-pose" | "sitting" | "none" | "")}
                disabled={isGenerating}
                style={{ marginTop: "8px" }}
              >
                <option value="">Select pose mode...</option>
                <option value="none">None</option>
                <option value="a-pose">A-Pose</option>
                <option value="t-pose">T-Pose</option>
                <option value="sitting">Sitting</option>
              </select>
              
              <select
                className={styles.promptInput}
                value={selectedModelVersion}
                onChange={(e) => setSelectedModelVersion(e.target.value as "meshy-4" | "meshy-5" | "latest")}
                disabled={isGenerating}
                style={{ marginTop: "8px" }}
              >
                <option value="latest">Latest</option>
                <option value="meshy-5">Meshy-5</option>
                <option value="meshy-4">Meshy-4</option>
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
              
              <label 
                className={styles.testButton} 
                style={{ 
                  display: "flex", 
                  alignItems: "center", 
                  justifyContent: "center", 
                  cursor: isGenerating ? "not-allowed" : "pointer", 
                  marginTop: "8px",
                  opacity: isGenerating ? 0.5 : 1,
                  pointerEvents: isGenerating ? "none" : "auto"
                }}
              >
                Upload GLB/GLTF
                <input
                  type="file"
                  accept=".glb,.gltf"
                  onChange={handleFileUpload}
                  disabled={isGenerating}
                  style={{ display: "none" }}
                />
              </label>

              <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginTop: "8px" }}>
                <input
                  className={styles.promptInput}
                  value={testModelUrl}
                  onChange={(e) => setTestModelUrl(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !isGenerating) loadCustomModel()
                  }}
                  placeholder="Paste direct GLB/GLTF URL..."
                  disabled={isGenerating}
                  style={{ width: "100%", fontSize: "12px" }}
                />
                <button
                  className={styles.testButton}
                  onClick={loadCustomModel}
                  disabled={!testModelUrl.trim() || isGenerating}
                  title="Load model from URL"
                  style={{ width: "100%" }}
                >
                  Load URL
                </button>
              </div>
              
        </div>
      </div>

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
        
        <div className={styles.inputGroup} style={{ marginTop: "12px" }}>
          <label className={styles.label} style={{ fontSize: "14px", color: "rgba(255, 255, 255, 0.9)" }}>
            Player Color
          </label>
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <input
              type="color"
              value={playerColorHex}
              onChange={(e) => {
                setPlayerColorHex(e.target.value)
                if (modelRef.current && modelRef.current.userData.isPlaceholder) {
                  const capsule = modelRef.current.children[0] as THREE.Mesh
                  if (capsule && capsule.material instanceof THREE.MeshStandardMaterial) {
                    const colorNum = parseInt(e.target.value.replace("#", ""), 16)
                    capsule.material.color.setHex(colorNum)
                  }
                }
              }}
              disabled={isGenerating}
              style={{ 
                width: 50, 
                height: 50, 
                borderRadius: "8px", 
                border: "2px solid rgba(255, 255, 255, 0.3)", 
                cursor: isGenerating ? "not-allowed" : "pointer",
                padding: 0
              }}
            />
            <span style={{ fontSize: "14px", color: "rgba(255, 255, 255, 0.7)", fontFamily: "monospace" }}>
              {playerColorHex.toUpperCase()}
            </span>
          </div>
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
                        console.log("[CharacterSetup] Selecting community model:", saved.modelUrl, saved.prompt)
                        if (modelRef.current && sceneRef.current) {
                          const oldModel = modelRef.current
                          sceneRef.current.remove(oldModel)
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
                    setModelUrl(saved.modelUrl)
                    setPrompt(saved.prompt)
                    setIsModelLoading(true)
                    setIsModelLoaded(false)
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
                      </div>
                    </button>
                  </div>
                ))}
              </div>
        </div>
      )}

    </div>
  )
}