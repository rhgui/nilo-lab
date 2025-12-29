import { defineConfig, loadEnv } from "vite"
import react from "@vitejs/plugin-react"

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "")
  const falKey = env.FAL_KEY || env.VITE_FAL_KEY
  const meshyKey = env.MESHY_API_KEY || env.VITE_MESHY_API_KEY

  let falConfigured = false

  return {
    server: {
      host: "0.0.0.0", // Allow external connections
      port: 5173,
      strictPort: false, 
    },
    plugins: [
      react(),
      {
        name: "fal-skybox-api",
        configureServer(server) {
          // Add CORS headers for all API routes
          server.middlewares.use((req, res, next) => {
            if (req.url?.startsWith("/api/")) {
              res.setHeader("Access-Control-Allow-Origin", "*")
              res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
              res.setHeader("Access-Control-Allow-Headers", "Content-Type")
              if (req.method === "OPTIONS") {
                res.statusCode = 200
                res.end()
                return
              }
            }
            next()
          })
          server.middlewares.use("/api/skybox", async (req, res) => {
            try {
              if (req.method !== "POST") {
                res.statusCode = 405
                res.end("Method Not Allowed")
                return
              }

              if (!falKey) {
                res.statusCode = 500
                res.end("Missing FAL_KEY (or VITE_FAL_KEY) in environment")
                return
              }

              const chunks: Buffer[] = []
              req.on("data", (c) => chunks.push(Buffer.from(c)))
              await new Promise<void>((resolve) => req.on("end", () => resolve()))
              const body = Buffer.concat(chunks).toString("utf8")
              const json = JSON.parse(body || "{}") as { prompt?: string }
              const prompt = (json.prompt ?? "").trim()
              if (!prompt) {
                res.statusCode = 400
                res.end("Missing prompt")
                return
              }

              const mod = await import("@fal-ai/client")
              const fal = mod.fal

              if (!falConfigured) {
                fal.config({ credentials: falKey })
                falConfigured = true
              }

              const result = await fal.subscribe("fal-ai/flux/schnell", {
                input: {
                  prompt,
                  image_size: "landscape_16_9",
                  num_inference_steps: 4,
                },
              })

              const r: any = result as any
              const imageUrl =
                (r?.data?.images?.[0]?.url as string | undefined) ??
                (r?.images?.[0]?.url as string | undefined) ??
                (r?.data?.image?.url as string | undefined) ??
                (r?.output?.[0]?.url as string | undefined)

              if (!imageUrl) {
                res.statusCode = 502
                res.end("fal response missing image url")
                return
              }

              res.setHeader("content-type", "application/json")
              res.statusCode = 200
              res.end(JSON.stringify({ imageUrl }))
            } catch (e: any) {
              // Bubble up useful error info (fal throws ApiError with status + body).
              const status =
                (typeof e?.status === "number" && e.status) ||
                (typeof e?.response?.status === "number" && e.response.status) ||
                500

              const message =
                (typeof e?.message === "string" && e.message) ||
                (typeof e?.body === "string" && e.body) ||
                (typeof e?.responseText === "string" && e.responseText) ||
                "Skybox API error"

              // eslint-disable-next-line no-console
              console.error("[/api/skybox] error:", e)

              res.statusCode = status
              res.end(message)
            }
          })

          // Meshy.ai API endpoint for generating 3D models from text
          // Documentation: https://docs.meshy.ai/en/api/text-to-3d
          server.middlewares.use("/api/meshy/generate", async (req, res) => {
            try {
              if (req.method !== "POST") {
                res.statusCode = 405
                res.end("Method Not Allowed")
                return
              }

              if (!meshyKey) {
                res.statusCode = 500
                res.end("Missing MESHY_API_KEY (or VITE_MESHY_API_KEY) in environment")
                return
              }

              const chunks: Buffer[] = []
              req.on("data", (c) => chunks.push(Buffer.from(c)))
              await new Promise<void>((resolve) => req.on("end", () => resolve()))
              const body = Buffer.concat(chunks).toString("utf8")
              const json = JSON.parse(body || "{}") as { prompt?: string; texture_prompt?: string; pose_mode?: string }
              const prompt = (json.prompt ?? "").trim()
              const texturePrompt = (json.texture_prompt ?? "").trim()
              const poseMode = json.pose_mode
              if (!prompt) {
                res.statusCode = 400
                res.end("Missing prompt")
                return
              }

              // Call Meshy.ai Text-to-3D API
              // Documentation: https://docs.meshy.ai/en/api/text-to-3d
              const requestBody: any = {
                prompt: prompt.trim(),
                mode: "preview", // Use preview mode for faster generation
                ai_model: "meshy-5", // meshy-6 costs 20 credits, meshy-5 and meshy-4 cost 5
                should_remesh: false, // Skip remeshing for faster generation
              }
              
              // Add pose_mode if provided (a-pose or t-pose)
              if (poseMode) {
                requestBody.pose_mode = poseMode
              }
              
              const meshyResponse = await fetch("https://api.meshy.ai/openapi/v2/text-to-3d", {
                method: "POST",
                headers: {
                  "Authorization": `Bearer ${meshyKey}`,
                  "Content-Type": "application/json",
                },
                body: JSON.stringify(requestBody),
              })
              // Note: Preview mode may not include textures. For full textures, use mode: "premium" or wait for texture stage
              // art_style is not a valid parameter for text-to-3d API - textures come from the model generation itself

              if (!meshyResponse.ok) {
                const errorText = await meshyResponse.text()
                res.statusCode = meshyResponse.status
                res.end(`Meshy.ai API error: ${errorText}`)
                return
              }

              const meshyData = (await meshyResponse.json()) as {
                result?: string // Task ID
                status?: string
              }

              const taskId = meshyData.result
              if (!taskId) {
                res.statusCode = 500
                res.end("Meshy.ai API did not return a task ID")
                return
              }

              res.setHeader("content-type", "application/json")
              res.statusCode = 200
              res.end(JSON.stringify({
                taskId: taskId,
                status: meshyData.status || "pending",
                texturePrompt: texturePrompt || null, // Return texture_prompt if provided
              }))
            } catch (e: any) {
              const status =
                (typeof e?.status === "number" && e.status) ||
                (typeof e?.response?.status === "number" && e.response.status) ||
                500

              const message =
                (typeof e?.message === "string" && e.message) ||
                (typeof e?.body === "string" && e.body) ||
                (typeof e?.responseText === "string" && e.responseText) ||
                "Meshy.ai API error"

              // eslint-disable-next-line no-console
              console.error("[/api/meshy/generate] error:", e)

              res.statusCode = status
              res.end(message)
            }
          })

          // Meshy.ai API endpoint for fetching model by task ID (for public models)
          server.middlewares.use("/api/meshy/model/", async (req, res) => {
            // Handle CORS preflight
            if (req.method === "OPTIONS") {
              res.setHeader("Access-Control-Allow-Origin", "*")
              res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS")
              res.setHeader("Access-Control-Allow-Headers", "Content-Type")
              res.statusCode = 200
              res.end()
              return
            }

            try {
              if (req.method !== "GET") {
                res.statusCode = 405
                res.end("Method Not Allowed")
                return
              }

              if (!meshyKey) {
                res.statusCode = 500
                res.end("Missing MESHY_API_KEY (or VITE_MESHY_API_KEY) in environment")
                return
              }

              // Extract task ID from URL: /api/meshy/model/{taskId}
              const urlParts = (req.url || "").split("/")
              const modelIndex = urlParts.indexOf("model")
              const taskId = modelIndex >= 0 && modelIndex < urlParts.length - 1
                ? urlParts[modelIndex + 1]
                : null

              if (!taskId) {
                res.statusCode = 400
                res.end("Missing task ID")
                return
              }

              // Fetch model details from Meshy.ai API
              const meshyResponse = await fetch(`https://api.meshy.ai/openapi/v2/text-to-3d/${taskId}`, {
                method: "GET",
                headers: {
                  "Authorization": `Bearer ${meshyKey}`,
                },
              })

              if (!meshyResponse.ok) {
                const errorText = await meshyResponse.text()
                res.statusCode = meshyResponse.status
                res.end(`Meshy.ai API error: ${errorText}`)
                return
              }

              const meshyData = (await meshyResponse.json()) as {
                status?: string
                model_urls?: {
                  glb?: string
                  preview?: string
                }
                task_error?: {
                  message?: string
                }
              }

              const glbUrl = meshyData.model_urls?.glb || null

              res.setHeader("content-type", "application/json")
              res.statusCode = 200
              res.end(JSON.stringify({
                taskId: taskId,
                glbUrl: glbUrl,
                status: meshyData.status,
                error: meshyData.task_error?.message,
              }))
            } catch (e: any) {
              const status =
                (typeof e?.status === "number" && e.status) ||
                (typeof e?.response?.status === "number" && e.response.status) ||
                500

              const message =
                (typeof e?.message === "string" && e.message) ||
                (typeof e?.body === "string" && e.body) ||
                (typeof e?.responseText === "string" && e.responseText) ||
                "Meshy.ai API error"

              // eslint-disable-next-line no-console
              console.error("[/api/meshy/model] error:", e)

              res.statusCode = status
              res.end(message)
            }
          })

          // Meshy.ai API endpoint for creating a retexture task
          // Documentation: https://docs.meshy.ai/en/api/retexture#create-a-retexture-task
          // IMPORTANT: This must be registered before the status endpoint middleware
          server.middlewares.use("/api/meshy/retexture", async (req, res) => {
            try {
              if (req.method !== "POST") {
                res.statusCode = 405
                res.end("Method Not Allowed")
                return
              }

              if (!meshyKey) {
                res.statusCode = 500
                res.end("Missing MESHY_API_KEY (or VITE_MESHY_API_KEY) in environment")
                return
              }

              const chunks: Buffer[] = []
              req.on("data", (c) => chunks.push(Buffer.from(c)))
              await new Promise<void>((resolve) => req.on("end", () => resolve()))
              const body = Buffer.concat(chunks).toString("utf8")
              const json = JSON.parse(body || "{}") as { input_task_id?: string; model_url?: string; text_style_prompt?: string; enable_pbr?: boolean }
              const inputTaskId = json.input_task_id?.trim()
              const modelUrl = json.model_url?.trim()
              const textStylePrompt = json.text_style_prompt?.trim()

              if (!inputTaskId && !modelUrl) {
                res.statusCode = 400
                res.end("Missing input_task_id or model_url")
                return
              }

              if (!textStylePrompt) {
                res.statusCode = 400
                res.end("Missing text_style_prompt")
                return
              }

              // Call Meshy.ai Retexture API
              // Documentation: https://docs.meshy.ai/en/api/retexture#create-a-retexture-task
              const requestBody: any = {
                text_style_prompt: textStylePrompt,
                enable_pbr: json.enable_pbr ?? false,
              }
              
              // Use input_task_id if provided, otherwise use model_url
              if (inputTaskId) {
                requestBody.input_task_id = inputTaskId
              } else {
                requestBody.model_url = modelUrl
              }

              const meshyResponse = await fetch("https://api.meshy.ai/openapi/v1/retexture", {
                method: "POST",
                headers: {
                  "Authorization": `Bearer ${meshyKey}`,
                  "Content-Type": "application/json",
                },
                body: JSON.stringify(requestBody),
              })

              if (!meshyResponse.ok) {
                const errorText = await meshyResponse.text()
                res.statusCode = meshyResponse.status
                res.end(`Meshy.ai API error: ${errorText}`)
                return
              }

              const meshyData = (await meshyResponse.json()) as {
                result?: string // Retexture Task ID
              }

              const retextureTaskId = meshyData.result
              if (!retextureTaskId) {
                res.statusCode = 500
                res.end("Meshy.ai API did not return a retexture task ID")
                return
              }

              res.setHeader("content-type", "application/json")
              res.statusCode = 200
              res.end(JSON.stringify({
                taskId: retextureTaskId,
                status: "pending",
              }))
            } catch (e: any) {
              const status =
                (typeof e?.status === "number" && e.status) ||
                (typeof e?.response?.status === "number" && e.response.status) ||
                500

              const message =
                (typeof e?.message === "string" && e.message) ||
                (typeof e?.body === "string" && e.body) ||
                (typeof e?.responseText === "string" && e.responseText) ||
                "Meshy.ai API error"

              // eslint-disable-next-line no-console
              console.error("[/api/meshy/retexture] error:", e)

              res.statusCode = status
              res.end(message)
            }
          })

          // Meshy.ai API endpoint for checking balance/credits
          // Documentation: https://docs.meshy.ai/en/api/balance
          server.middlewares.use("/api/meshy/balance", async (req, res) => {
            try {
              if (req.method !== "GET") {
                res.statusCode = 405
                res.end("Method Not Allowed")
                return
              }

              if (!meshyKey) {
                res.statusCode = 500
                res.end("Missing MESHY_API_KEY (or VITE_MESHY_API_KEY) in environment")
                return
              }

              // Call Meshy.ai Balance API
              const meshyResponse = await fetch("https://api.meshy.ai/openapi/v1/balance", {
                method: "GET",
                headers: {
                  "Authorization": `Bearer ${meshyKey}`,
                },
              })

              if (!meshyResponse.ok) {
                const errorText = await meshyResponse.text()
                res.statusCode = meshyResponse.status
                res.end(`Meshy.ai API error: ${errorText}`)
                return
              }

              const meshyData = await meshyResponse.json()

              res.setHeader("content-type", "application/json")
              res.statusCode = 200
              res.end(JSON.stringify(meshyData))
            } catch (e: any) {
              const status =
                (typeof e?.status === "number" && e.status) ||
                (typeof e?.response?.status === "number" && e.response.status) ||
                500

              const message =
                (typeof e?.message === "string" && e.message) ||
                (typeof e?.body === "string" && e.body) ||
                (typeof e?.responseText === "string" && e.responseText) ||
                "Meshy.ai API error"

              // eslint-disable-next-line no-console
              console.error("[/api/meshy/balance] error:", e)

              res.statusCode = status
              res.end(message)
            }
          })

          // Meshy.ai API endpoint for checking task status
          server.middlewares.use((req, res, next) => {
            if (req.url?.startsWith("/api/meshy/status/") && req.method === "GET") {
              const urlParts = req.url.split("/")
              const statusIndex = urlParts.indexOf("status")
              const taskId = statusIndex >= 0 && statusIndex < urlParts.length - 1
                ? urlParts[statusIndex + 1]
                : null

              if (!taskId) {
                res.statusCode = 400
                res.end("Missing task ID")
                return
              }

              if (!meshyKey) {
                res.statusCode = 500
                res.end("Missing MESHY_API_KEY (or VITE_MESHY_API_KEY) in environment")
                return
              }

              // Process the status check asynchronously
              ;(async () => {
                try {
                  // Check task status with Meshy.ai API
                  // Try text-to-3d endpoint first, then retexture endpoint, then rigging endpoint
                  // Documentation: 
                  // - https://docs.meshy.ai/en/api/text-to-3d
                  // - https://docs.meshy.ai/en/api/retexture
                  // - https://docs.meshy.ai/en/api/rigging-and-animation
                  let meshyResponse = await fetch(`https://api.meshy.ai/openapi/v2/text-to-3d/${taskId}`, {
                    method: "GET",
                    headers: {
                      "Authorization": `Bearer ${meshyKey}`,
                    },
                  })
                  
                  // If text-to-3d endpoint returns 404, try retexture endpoint
                  if (meshyResponse.status === 404) {
                    meshyResponse = await fetch(`https://api.meshy.ai/openapi/v1/retexture/${taskId}`, {
                      method: "GET",
                      headers: {
                        "Authorization": `Bearer ${meshyKey}`,
                      },
                    })
                    // If retexture also returns 404, try rigging endpoint
                    // IMPORTANT: Rigging endpoint returns result.basic_animations with animation URLs
                    if (meshyResponse.status === 404) {
                      console.log(`[/api/meshy/status/${taskId}] Trying rigging endpoint...`)
                      meshyResponse = await fetch(`https://api.meshy.ai/openapi/v1/rigging/${taskId}`, {
                        method: "GET",
                        headers: {
                          "Authorization": `Bearer ${meshyKey}`,
                        },
                      })
                      console.log(`[/api/meshy/status/${taskId}] Rigging endpoint response status:`, meshyResponse.status)
                    }
                    // If rigging also returns 404, try animations endpoint
                    if (meshyResponse.status === 404) {
                      console.log(`[/api/meshy/status/${taskId}] Trying animations endpoint...`)
                      meshyResponse = await fetch(`https://api.meshy.ai/openapi/v1/animations/${taskId}`, {
                        method: "GET",
                        headers: {
                          "Authorization": `Bearer ${meshyKey}`,
                        },
                      })
                      console.log(`[/api/meshy/status/${taskId}] Animations endpoint response status:`, meshyResponse.status)
                    }
                  }

                  if (!meshyResponse.ok) {
                    const errorText = await meshyResponse.text()
                    res.statusCode = meshyResponse.status
                    res.end(`Meshy.ai API error: ${errorText}`)
                    return
                  }

              // Parse the response - for rigging tasks, this should include result.basic_animations
              const meshyData = (await meshyResponse.json()) as {
                status?: string
                model_urls?: {
                  glb?: string
                  preview?: string
                }
                result?: {
                  rigged_character_glb_url?: string
                  rigged_character_fbx_url?: string
                  basic_animations?: {
                    walking_glb_url?: string
                    walking_fbx_url?: string
                    walking_armature_glb_url?: string
                    running_glb_url?: string
                    running_fbx_url?: string
                    running_armature_glb_url?: string
                  }
                  // Animation task result structure
                  animation_glb_url?: string
                  animation_fbx_url?: string
                  processed_usdz_url?: string
                  processed_armature_fbx_url?: string
                  processed_animation_fps_fbx_url?: string
                }
                task_error?: {
                  message?: string
                }
                type?: string // Task type: "text-to-3d", "retexture", "rig", "animate", etc.
              }
              
              // Log the raw response immediately to see what Meshy actually returns
              console.log(`[/api/meshy/status/${taskId}] 📦 Raw Meshy API Response (before parsing):`, JSON.stringify(meshyData, null, 2))

              // For retexture tasks, model_urls.glb is the textured model
              // For text-to-3d tasks, model_urls.glb is also the model
              // For rigging tasks, result.rigged_character_glb_url is the rigged model
              const modelUrl = meshyData.model_urls?.glb || meshyData.result?.rigged_character_glb_url || null
              const status = meshyData.status || "PENDING"

              // Log the FULL raw response from Meshy API for debugging
              console.log(`[/api/meshy/status/${taskId}] 🔍 Full Meshy API Response:`, JSON.stringify(meshyData, null, 2))
              console.log(`[/api/meshy/status/${taskId}] Status: ${status}, Model URL: ${modelUrl || "null"}, Type: ${meshyData.type || "unknown"}, Has Result: ${!!meshyData.result}`)
              
              // Deep search for animation-related keys
              const responseStr = JSON.stringify(meshyData)
              if (responseStr.toLowerCase().includes("animation") || responseStr.toLowerCase().includes("running") || responseStr.toLowerCase().includes("walking")) {
                console.log(`[/api/meshy/status/${taskId}] 🎬 Found animation-related keywords in response!`)
                // Try to extract animation URLs
                const animMatches = responseStr.match(/"([^"]*running[^"]*\.glb[^"]*)"/gi) || []
                const walkMatches = responseStr.match(/"([^"]*walking[^"]*\.glb[^"]*)"/gi) || []
                if (animMatches.length > 0) console.log(`[/api/meshy/status/${taskId}] 🎬 Potential animation URLs found:`, animMatches)
                if (walkMatches.length > 0) console.log(`[/api/meshy/status/${taskId}] 🎬 Potential walking URLs found:`, walkMatches)
              }
              
              if (meshyData.result) {
                console.log(`[/api/meshy/status/${taskId}] ✅ Result object:`, JSON.stringify(meshyData.result, null, 2))
                if (meshyData.result.basic_animations) {
                  console.log(`[/api/meshy/status/${taskId}] ✅ Found basic_animations:`, JSON.stringify(meshyData.result.basic_animations, null, 2))
                } else {
                  console.log(`[/api/meshy/status/${taskId}] ⚠️ Result exists but no basic_animations found`)
                  // Check if animations might be at a different path in result
                  if (typeof meshyData.result === "object") {
                    const resultKeys = Object.keys(meshyData.result)
                    console.log(`[/api/meshy/status/${taskId}] Result keys:`, resultKeys)
                    for (const key of resultKeys) {
                      if (key.toLowerCase().includes("anim") || key.toLowerCase().includes("run") || key.toLowerCase().includes("walk")) {
                        console.log(`[/api/meshy/status/${taskId}] 🎬 Found potential animation key in result: ${key}`, (meshyData.result as any)[key])
                      }
                    }
                  }
                }
              } else {
                console.log(`[/api/meshy/status/${taskId}] ⚠️ No 'result' field in Meshy API response`)
                console.log(`[/api/meshy/status/${taskId}] Available keys:`, Object.keys(meshyData))
                // Check all top-level keys for animation-related content
                for (const key of Object.keys(meshyData)) {
                  if (key.toLowerCase().includes("anim") || key.toLowerCase().includes("run") || key.toLowerCase().includes("walk")) {
                    console.log(`[/api/meshy/status/${taskId}] 🎬 Found potential animation key at top level: ${key}`, (meshyData as any)[key])
                  }
                }
              }

              res.setHeader("content-type", "application/json")
              res.statusCode = 200
              
              // Build response object - ensure result is included even if undefined
              const responseObj: any = {
                taskId: taskId,
                modelUrl: modelUrl, // Return GLB URL
                model_urls: meshyData.model_urls, // Also return full model_urls object for retexture tasks
                status: status, // Return status as-is: "SUCCEEDED", "FAILED", "PENDING", "IN_PROGRESS", "CANCELED"
                error: meshyData.task_error?.message,
                type: meshyData.type, // Return task type
              }
              
              // IMPORTANT: Always include result field for rigging tasks (contains basic_animations)
              // Even if undefined, we want to pass it through so client can see it's missing
              if (meshyData.result !== undefined) {
                responseObj.result = meshyData.result
                console.log(`[/api/meshy/status/${taskId}] ✅ Including result in response:`, JSON.stringify(meshyData.result, null, 2))
              } else {
                console.log(`[/api/meshy/status/${taskId}] ⚠️ result is undefined - Meshy API may not have returned it`)
              }
              
              res.end(JSON.stringify(responseObj))
                } catch (e: any) {
                  const status =
                    (typeof e?.status === "number" && e.status) ||
                    (typeof e?.response?.status === "number" && e.response.status) ||
                    500

                  const message =
                    (typeof e?.message === "string" && e.message) ||
                    (typeof e?.body === "string" && e.body) ||
                    (typeof e?.responseText === "string" && e.responseText) ||
                    "Meshy.ai API error"

                  // eslint-disable-next-line no-console
                  console.error("[/api/meshy/status] error:", e)

                  res.statusCode = status
                  res.end(message)
                }
              })()
              return // Don't call next() since we're handling the request
            }
            next() // Continue to next middleware for other routes
          })

          // Meshy.ai API endpoint for creating a rigging task
          // Documentation: https://docs.meshy.ai/en/api/rigging-and-animation
          server.middlewares.use("/api/meshy/rigging", async (req, res) => {
            try {
              if (req.method !== "POST") {
                res.statusCode = 405
                res.end("Method Not Allowed")
                return
              }

              if (!meshyKey) {
                res.statusCode = 500
                res.end("Missing MESHY_API_KEY (or VITE_MESHY_API_KEY) in environment")
                return
              }

              const chunks: Buffer[] = []
              req.on("data", (c) => chunks.push(Buffer.from(c)))
              await new Promise<void>((resolve) => req.on("end", () => resolve()))
              const body = Buffer.concat(chunks).toString("utf8")
              const json = JSON.parse(body || "{}") as { input_task_id?: string; model_url?: string; height_meters?: number }
              const inputTaskId = json.input_task_id?.trim()
              const modelUrl = json.model_url?.trim()
              const heightMeters = json.height_meters

              if (!inputTaskId && !modelUrl) {
                res.statusCode = 400
                res.end("Missing input_task_id or model_url")
                return
              }

              // Call Meshy.ai Rigging API
              // Documentation: https://docs.meshy.ai/en/api/rigging-and-animation
              // Note: Animations should be automatically generated when rigging completes
              const requestBody: any = {}
              
              if (inputTaskId) {
                requestBody.input_task_id = inputTaskId
              } else {
                requestBody.model_url = modelUrl
              }
              
              if (heightMeters) {
                requestBody.height_meters = heightMeters
              }

              console.log(`[/api/meshy/rigging] Creating rigging task with body:`, JSON.stringify(requestBody, null, 2))

              const meshyResponse = await fetch("https://api.meshy.ai/openapi/v1/rigging", {
                method: "POST",
                headers: {
                  "Authorization": `Bearer ${meshyKey}`,
                  "Content-Type": "application/json",
                },
                body: JSON.stringify(requestBody),
              })
              
              if (!meshyResponse.ok) {
                const errorText = await meshyResponse.text()
                console.error(`[/api/meshy/rigging] Meshy API error response:`, errorText)
              }

              if (!meshyResponse.ok) {
                const errorText = await meshyResponse.text()
                res.statusCode = meshyResponse.status
                res.end(`Meshy.ai API error: ${errorText}`)
                return
              }

              const meshyData = (await meshyResponse.json()) as {
                result?: string // Rigging Task ID
              }

              const riggingTaskId = meshyData.result
              if (!riggingTaskId) {
                res.statusCode = 500
                res.end("Meshy.ai API did not return a rigging task ID")
                return
              }

              res.setHeader("content-type", "application/json")
              res.statusCode = 200
              res.end(JSON.stringify({
                taskId: riggingTaskId,
                status: "pending",
              }))
            } catch (e: any) {
              const status =
                (typeof e?.status === "number" && e.status) ||
                (typeof e?.response?.status === "number" && e.response.status) ||
                500

              const message =
                (typeof e?.message === "string" && e.message) ||
                (typeof e?.body === "string" && e.body) ||
                (typeof e?.responseText === "string" && e.responseText) ||
                "Meshy.ai API error"

              // eslint-disable-next-line no-console
              console.error("[/api/meshy/rigging] error:", e)

              res.statusCode = status
              res.end(message)
            }
          })

          // Meshy.ai API endpoint for creating an animation task
          // Documentation: https://docs.meshy.ai/en/api/rigging-and-animation
          server.middlewares.use("/api/meshy/animations", async (req, res) => {
            try {
              if (req.method !== "POST") {
                res.statusCode = 405
                res.end("Method Not Allowed")
                return
              }

              if (!meshyKey) {
                res.statusCode = 500
                res.end("Missing MESHY_API_KEY (or VITE_MESHY_API_KEY) in environment")
                return
              }

              const chunks: Buffer[] = []
              req.on("data", (c) => chunks.push(Buffer.from(c)))
              await new Promise<void>((resolve) => req.on("end", () => resolve()))
              const body = Buffer.concat(chunks).toString("utf8")
              const json = JSON.parse(body || "{}") as { 
                rig_task_id?: string
                input_task_id?: string // Support both for backwards compatibility
                action_id?: number | string
              }
              // Meshy Animation API requires rig_task_id (not input_task_id)
              const rigTaskId = json.rig_task_id?.trim() || json.input_task_id?.trim()
              // action_id must be an integer (numeric ID from Meshy animation library)
              // Common IDs: 1 (Walking_Woman), 30 (Casual_Walk), 14 (Run_02), 15 (Run_03), 16 (RunFast)
              let actionId: number | undefined
              if (typeof json.action_id === "number") {
                actionId = json.action_id
              } else if (typeof json.action_id === "string") {
                // Try to parse string to number
                const parsed = parseInt(json.action_id, 10)
                if (!isNaN(parsed)) {
                  actionId = parsed
                }
              }

              if (!rigTaskId) {
                res.statusCode = 400
                res.end("Missing rig_task_id")
                return
              }

              if (actionId === undefined || actionId === null) {
                res.statusCode = 400
                res.end("Missing or invalid action_id (must be a number, e.g., 1 for walking, 14 for running)")
                return
              }

              // Call Meshy.ai Animations API
              // Documentation: https://docs.meshy.ai/en/api/rigging-and-animation
              // action_id must be an integer from the animation library
              // rig_task_id is the required field name (not input_task_id)
              const requestBody: any = {
                rig_task_id: rigTaskId,
                action_id: actionId
              }

              console.log(`[/api/meshy/animations] Creating animation task with body:`, JSON.stringify(requestBody, null, 2))

              const meshyResponse = await fetch("https://api.meshy.ai/openapi/v1/animations", {
                method: "POST",
                headers: {
                  "Authorization": `Bearer ${meshyKey}`,
                  "Content-Type": "application/json",
                },
                body: JSON.stringify(requestBody),
              })
              
              if (!meshyResponse.ok) {
                const errorText = await meshyResponse.text()
                console.error(`[/api/meshy/animations] Meshy API error response:`, errorText)
                res.statusCode = meshyResponse.status
                res.end(`Meshy.ai API error: ${errorText}`)
                return
              }

              const meshyData = (await meshyResponse.json()) as {
                result?: string // Animation Task ID
              }

              const animationTaskId = meshyData.result
              if (!animationTaskId) {
                res.statusCode = 500
                res.end("Meshy.ai API did not return an animation task ID")
                return
              }

              res.setHeader("content-type", "application/json")
              res.statusCode = 200
              res.end(JSON.stringify({
                taskId: animationTaskId,
                status: "pending",
              }))
            } catch (e: any) {
              const status =
                (typeof e?.status === "number" && e.status) ||
                (typeof e?.response?.status === "number" && e.response.status) ||
                500

              const message =
                (typeof e?.message === "string" && e.message) ||
                (typeof e?.body === "string" && e.body) ||
                (typeof e?.responseText === "string" && e.responseText) ||
                "Meshy.ai API error"

              console.error("[/api/meshy/animations] error:", e)

              res.statusCode = status
              res.end(message)
            }
          })

          // Proxy endpoint for Meshy.ai GLB files (CORS workaround)
          // CRITICAL: This must be a raw pass-through for Meshy signed URLs to work
          // Meshy uses CloudFront signed URLs which are VERY strict:
          // - URL must be forwarded byte-for-byte (no decode/encode)
          // - Range headers must be forwarded
          // - Response must be streamed (not buffered)
          // - All headers must be forwarded
          server.middlewares.use("/api/meshy/proxy", async (req, res) => {
            // Handle CORS preflight
            if (req.method === "OPTIONS") {
              res.setHeader("Access-Control-Allow-Origin", "*")
              res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS")
              res.setHeader("Access-Control-Allow-Headers", "Content-Type, Range")
              res.statusCode = 200
              res.end()
              return
            }

            try {
              if (req.method !== "GET") {
                res.statusCode = 405
                res.end("Method Not Allowed")
                return
              }

              // Extract URL from query params
              // Use URL parsing but preserve the original URL parameter exactly
              const urlObj = new URL(req.url || "", `http://${req.headers.host}`)
              const urlParam = urlObj.searchParams.get("url")
              if (!urlParam) {
                res.statusCode = 400
                res.end("Missing url parameter")
                return
              }
              
              console.log(`[/api/meshy/proxy] Fetching GLB from Meshy`)
              console.log(`[/api/meshy/proxy] URL: ${urlParam.substring(0, 150)}...`)
              console.log(`[/api/meshy/proxy] Is signed URL: ${urlParam.includes('Signature=')}`)

              // Build headers - keep minimal to avoid breaking CloudFront signature validation
              // IMPORTANT: Do NOT forward browser User-Agent, Via, X-Forwarded-For, or other
              // proxy-revealing headers - CloudFront may block these to enforce no-CORS policy
              const headers: Record<string, string> = {}
              
              // Forward Range header if present (required for partial content requests)
              if (req.headers.range) {
                headers["Range"] = req.headers.range
              }
              
              // Set a minimal, non-browser User-Agent
              // CloudFront signed URLs may reject browser-like User-Agents or empty ones
              headers["User-Agent"] = "curl/8.0.0"
              
              // Do NOT forward Referer - CloudFront signed URLs may validate it and reject localhost
              // Do NOT forward Origin - same reason
              
              // Add basic headers
              headers["Accept"] = "*/*"
              
              // Log headers after they're created
              console.log(`[/api/meshy/proxy] Headers being sent:`, JSON.stringify(headers, null, 2))
              
              // Use Node's native https/http modules for complete control over headers
              // This allows us to completely omit User-Agent header
              const https = await import("https")
              const http = await import("http")
              
              const targetUrl = new URL(urlParam)
              const isHttps = targetUrl.protocol === "https:"
              const client = isHttps ? https : http
              
              // Make request with streaming support
              await new Promise<void>((resolve, reject) => {
                const requestOptions = {
                  hostname: targetUrl.hostname,
                  port: targetUrl.port || (isHttps ? 443 : 80),
                  path: targetUrl.pathname + targetUrl.search,
                  method: "GET",
                  headers: {
                    ...headers,
                    // Explicitly do NOT include User-Agent - Node won't add one if we don't set it
                  },
                }
                
                const nodeReq = client.request(requestOptions, (nodeRes) => {
                  // Check if request was blocked
                  if (nodeRes.statusCode && nodeRes.statusCode >= 400) {
                    // Read error response
                    const chunks: Buffer[] = []
                    nodeRes.on("data", (chunk) => chunks.push(chunk))
                    nodeRes.on("end", () => {
                      const errorText = Buffer.concat(chunks).toString()
                      console.error(`[/api/meshy/proxy] Meshy returned ${nodeRes.statusCode}: ${errorText}`)
                      console.error(`[/api/meshy/proxy] Request URL: ${urlParam.substring(0, 200)}...`)
                      console.error(`[/api/meshy/proxy] Request headers sent:`, headers)
                      console.error(`[/api/meshy/proxy] Response headers:`, nodeRes.headers)
                      
                      // Forward the error status and message
                      res.statusCode = nodeRes.statusCode || 500
                      res.setHeader("Content-Type", "text/plain")
                      res.end(`Meshy API error: ${nodeRes.statusCode} ${errorText}`)
                      resolve()
                    })
                    return
                  }
                  
                  // Forward status code
                  res.statusCode = nodeRes.statusCode || 200
                  
                  // Forward ALL headers from Meshy response (CRITICAL)
                  Object.entries(nodeRes.headers).forEach(([key, value]) => {
                    if (value) {
                      // Don't forward content-encoding if we're not handling it
                      // But do forward everything else including Accept-Ranges, Content-Range, etc.
                      if (key.toLowerCase() !== "content-encoding" || res.statusCode === 206) {
                        const headerValue = Array.isArray(value) ? value.join(", ") : value
                        res.setHeader(key, headerValue)
                      }
                    }
                  })
                  
                  // Add CORS headers (in addition to forwarded headers)
                  res.setHeader("Access-Control-Allow-Origin", "*")
                  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS")
                  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Range")
                  
                  // Stream the response body directly (CRITICAL for Range requests and large files)
                  nodeRes.pipe(res)
                  
                  // Handle stream completion
                  nodeRes.on("end", () => {
                    resolve()
                  })
                  
                  // Handle stream errors
                  nodeRes.on("error", (err) => {
                    console.error("[/api/meshy/proxy] Stream error:", err)
                    if (!res.headersSent) {
                      res.statusCode = 500
                      res.end(`Stream error: ${err.message}`)
                    } else {
                      res.destroy()
                    }
                    reject(err)
                  })
                })
                
                nodeReq.on("error", (err) => {
                  console.error(`[/api/meshy/proxy] Request error:`, err)
                  if (!res.headersSent) {
                    res.statusCode = 500
                    res.end(`Proxy request error: ${err.message || "Unknown error"}`)
                  }
                  reject(err)
                })
                
                res.on("close", () => {
                  // Clean up request if client disconnects
                  nodeReq.destroy()
                })
                
                nodeReq.end()
              })
            } catch (e: any) {
              // eslint-disable-next-line no-console
              console.error("[/api/meshy/proxy] error:", e)
              if (!res.headersSent) {
                res.statusCode = 500
                res.end(`Proxy error: ${e.message || "Unknown error"}`)
              }
            }
          })
        },
      },
    ],
  }
})
