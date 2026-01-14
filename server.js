import express from 'express'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import https from 'https'
import http from 'http'
import { config } from 'dotenv'
import { existsSync } from 'fs'

// Load environment variables
config()

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const app = express()
const PORT = process.env.PORT || 3000

// Get API keys from environment
const meshyKey = process.env.MESHY_API_KEY || process.env.VITE_MESHY_API_KEY

// CORS middleware for all API routes
app.use('/api', (req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Range')
  if (req.method === 'OPTIONS') {
    res.status(200).end()
    return
  }
  next()
})

// Parse JSON bodies with increased limit for base64 image data
app.use(express.json({ limit: '50mb' }))
app.use(express.urlencoded({ extended: true, limit: '50mb' }))

// ========== Meshy Text-to-Image API for Skybox ==========
app.post('/api/skybox', async (req, res) => {
  try {
    if (!meshyKey) {
      res.status(500).json({ error: 'Missing MESHY_API_KEY (or VITE_MESHY_API_KEY) in environment' })
      return
    }

    const { prompt, ai_model } = req.body
    if (!prompt || !prompt.trim()) {
      res.status(400).json({ error: 'Missing prompt' })
      return
    }

    // Ensure ai_model is provided (required by Meshy API)
    const model = ai_model || 'nano-banana'

    const requestBody = {
      prompt: prompt.trim(),
      aspect_ratio: '16:9', // Landscape for skybox
      ai_model: model, // Required field
    }

    console.log('[/api/skybox] Request body:', JSON.stringify(requestBody, null, 2))

    const meshyResponse = await fetch('https://api.meshy.ai/openapi/v1/text-to-image', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${meshyKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    })

    if (!meshyResponse.ok) {
      const errorText = await meshyResponse.text()
      res.status(meshyResponse.status).json({ error: `Meshy.ai API error: ${errorText}` })
      return
    }

    const meshyData = await meshyResponse.json()
    const taskId = meshyData.result

    if (!taskId) {
      res.status(500).json({ error: 'Meshy.ai API did not return a task ID' })
      return
    }

    res.json({
      taskId,
      status: meshyData.status || 'pending',
    })
  } catch (e) {
    const status = e?.status || e?.response?.status || 500
    const message = e?.message || e?.body || e?.responseText || 'Skybox API error'
    console.error('[/api/skybox] error:', e)
    res.status(status).json({ error: message })
  }
})

// Check skybox task status
app.get('/api/skybox/status/:taskId', async (req, res) => {
  try {
    if (!meshyKey) {
      res.status(500).json({ error: 'Missing MESHY_API_KEY (or VITE_MESHY_API_KEY) in environment' })
      return
    }

    const { taskId } = req.params

    const meshyResponse = await fetch(`https://api.meshy.ai/openapi/v1/text-to-image/${taskId}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${meshyKey}`,
      },
    })

    if (!meshyResponse.ok) {
      const errorText = await meshyResponse.text()
      res.status(meshyResponse.status).json({ error: `Meshy.ai API error: ${errorText}` })
      return
    }

    const meshyData = await meshyResponse.json()
    
    // Log the raw response from Meshy API
    console.log('[/api/skybox/status] 📦 Raw Meshy API response:', JSON.stringify(meshyData, null, 2))
    console.log('[/api/skybox/status] Status:', meshyData.status)
    console.log('[/api/skybox/status] Has image_urls?', !!meshyData.image_urls)
    console.log('[/api/skybox/status] image_urls type:', typeof meshyData.image_urls)
    console.log('[/api/skybox/status] image_urls is array?', Array.isArray(meshyData.image_urls))
    if (Array.isArray(meshyData.image_urls)) {
      console.log('[/api/skybox/status] image_urls length:', meshyData.image_urls.length)
      if (meshyData.image_urls.length > 0) {
        console.log('[/api/skybox/status] image_urls[0]:', meshyData.image_urls[0])
      }
    }
    
    // Parse image_urls array - Meshy returns image_urls as an array
    // According to Meshy API docs: https://docs.meshy.ai/en/api/text-to-image
    // Response format when SUCCEEDED:
    // {
    //   "id": "...",
    //   "status": "SUCCEEDED",
    //   "progress": 100,
    //   "image_urls": ["https://assets.meshy.ai/..."]
    // }
    let imageUrl = null
    
    // Check for image_urls array first (primary method per Meshy API docs)
    if (meshyData.image_urls !== undefined && meshyData.image_urls !== null) {
      if (Array.isArray(meshyData.image_urls) && meshyData.image_urls.length > 0) {
        imageUrl = meshyData.image_urls[0] // Get first image URL
        console.log('[/api/skybox/status] ✅ Found image URL from image_urls array:', imageUrl)
      } else if (Array.isArray(meshyData.image_urls) && meshyData.image_urls.length === 0) {
        console.warn('[/api/skybox/status] ⚠️ image_urls array exists but is empty (length: 0)')
      } else {
        console.warn('[/api/skybox/status] ⚠️ image_urls exists but is not an array. Type:', typeof meshyData.image_urls, 'Value:', meshyData.image_urls)
      }
    } else {
      console.warn('[/api/skybox/status] ⚠️ image_urls is undefined or null')
    }
    
    // Fallback to other possible locations (shouldn't be needed per Meshy API docs)
    if (!imageUrl) {
      if (meshyData.result?.image_url) {
        imageUrl = meshyData.result.image_url
        console.log('[/api/skybox/status] ✅ Found image URL from result.image_url:', imageUrl)
      } else if (meshyData.image_url) {
        imageUrl = meshyData.image_url
        console.log('[/api/skybox/status] ✅ Found image URL from image_url:', imageUrl)
      } else {
        console.error('[/api/skybox/status] ❌ No image URL found in response.')
        console.error('[/api/skybox/status] Status:', meshyData.status)
        console.error('[/api/skybox/status] Available keys:', Object.keys(meshyData))
        console.error('[/api/skybox/status] Full response:', JSON.stringify(meshyData, null, 2))
      }
    }
    
    const status = meshyData.status || 'PENDING'
    const progress = meshyData.progress !== undefined ? meshyData.progress : null

    // If we have an image URL from Meshy CDN, proxy it through our server to avoid CORS issues
    let proxiedImageUrl = imageUrl
    if (imageUrl && imageUrl.includes('assets.meshy.ai')) {
      // Proxy the image URL through our server
      proxiedImageUrl = `/api/meshy/proxy?url=${encodeURIComponent(imageUrl)}`
      console.log('[/api/skybox/status] 🔄 Proxying Meshy image URL through server:', proxiedImageUrl)
    }

    // Log the response we're sending back
    const responseData = {
      taskId,
      imageUrl: proxiedImageUrl, // Use proxied URL if it's from Meshy CDN
      status,
      progress,
      error: meshyData.error || meshyData.task_error?.message,
    }
    console.log('[/api/skybox/status] Sending response:', JSON.stringify(responseData, null, 2))

    res.json(responseData)
  } catch (e) {
    const status = e?.status || e?.response?.status || 500
    const message = e?.message || e?.body || e?.responseText || 'Meshy.ai API error'
    console.error('[/api/skybox/status] error:', e)
    res.status(status).json({ error: message })
  }
})

// ========== Meshy API Routes ==========

// Generate 3D model
app.post('/api/meshy/generate', async (req, res) => {
  try {
    if (!meshyKey) {
      res.status(500).json({ error: 'Missing MESHY_API_KEY (or VITE_MESHY_API_KEY) in environment' })
      return
    }

    const { prompt, texture_prompt, pose_mode } = req.body
    if (!prompt || !prompt.trim()) {
      res.status(400).json({ error: 'Missing prompt' })
      return
    }

    const requestBody = {
      prompt: prompt.trim(),
      mode: 'preview',
      ai_model: 'meshy-5',
      should_remesh: false,
    }

    if (pose_mode) {
      requestBody.pose_mode = pose_mode
    }

    const meshyResponse = await fetch('https://api.meshy.ai/openapi/v2/text-to-3d', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${meshyKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    })

    if (!meshyResponse.ok) {
      const errorText = await meshyResponse.text()
      res.status(meshyResponse.status).json({ error: `Meshy.ai API error: ${errorText}` })
      return
    }

    const meshyData = await meshyResponse.json()
    const taskId = meshyData.result

    if (!taskId) {
      res.status(500).json({ error: 'Meshy.ai API did not return a task ID' })
      return
    }

    res.json({
      taskId,
      status: meshyData.status || 'pending',
      texturePrompt: texture_prompt || null,
    })
  } catch (e) {
    const status = e?.status || e?.response?.status || 500
    const message = e?.message || e?.body || e?.responseText || 'Meshy.ai API error'
    console.error('[/api/meshy/generate] error:', e)
    res.status(status).json({ error: message })
  }
})

// Check task status
app.get('/api/meshy/status/:taskId', async (req, res) => {
  if (!meshyKey) {
    res.status(500).json({ error: 'Missing MESHY_API_KEY (or VITE_MESHY_API_KEY) in environment' })
    return
  }

  const { taskId } = req.params

  // Try text-to-3d endpoint first, then retexture, then rigging, then animations
  // Increase timeout to 30 seconds for slow connections
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 30000) // 30 second timeout
  
  const fetchOptions = {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${meshyKey}`,
    },
    signal: controller.signal,
  }
  
  try {
      let meshyResponse = await fetch(`https://api.meshy.ai/openapi/v2/text-to-3d/${taskId}`, fetchOptions)
      clearTimeout(timeoutId)

      if (meshyResponse.status === 404) {
        const controller2 = new AbortController()
        const timeoutId2 = setTimeout(() => controller2.abort(), 30000)
        meshyResponse = await fetch(`https://api.meshy.ai/openapi/v1/retexture/${taskId}`, {
          ...fetchOptions,
          signal: controller2.signal,
        })
        clearTimeout(timeoutId2)
      }

      if (meshyResponse.status === 404) {
        const controller3 = new AbortController()
        const timeoutId3 = setTimeout(() => controller3.abort(), 30000)
        meshyResponse = await fetch(`https://api.meshy.ai/openapi/v1/rigging/${taskId}`, {
          ...fetchOptions,
          signal: controller3.signal,
        })
        clearTimeout(timeoutId3)
      }

      if (meshyResponse.status === 404) {
        const controller4 = new AbortController()
        const timeoutId4 = setTimeout(() => controller4.abort(), 30000)
        meshyResponse = await fetch(`https://api.meshy.ai/openapi/v1/animations/${taskId}`, {
          ...fetchOptions,
          signal: controller4.signal,
        })
        clearTimeout(timeoutId4)
      }

      if (!meshyResponse.ok) {
        const errorText = await meshyResponse.text()
        res.status(meshyResponse.status).json({ error: `Meshy.ai API error: ${errorText}` })
        return
      }

      const meshyData = await meshyResponse.json()
      const modelUrl = meshyData.model_urls?.glb || meshyData.result?.rigged_character_glb_url || null
      const thumbnailUrl = meshyData.thumbnail_url || null
      const status = meshyData.status || 'PENDING'
      const progress = meshyData.progress !== undefined ? meshyData.progress : null

      const responseObj = {
        taskId,
        modelUrl,
        thumbnailUrl,
        model_urls: meshyData.model_urls,
        status,
        progress,
        error: meshyData.task_error?.message,
        type: meshyData.type,
      }

      if (meshyData.result !== undefined) {
        responseObj.result = meshyData.result
      }

      res.json(responseObj)
    } catch (e) {
      clearTimeout(timeoutId)
      if (e.name === 'AbortError') {
        console.error('[/api/meshy/status] Request timeout after 30 seconds')
        res.status(504).json({ error: 'Request timeout - Meshy API took too long to respond' })
        return
      }
      const status = e?.status || e?.response?.status || 500
      const message = e?.message || e?.body || e?.responseText || 'Meshy.ai API error'
      console.error('[/api/meshy/status] error:', e)
      res.status(status).json({ error: message })
    }
})

// Retexture
app.post('/api/meshy/retexture', async (req, res) => {
  try {
    if (!meshyKey) {
      res.status(500).json({ error: 'Missing MESHY_API_KEY (or VITE_MESHY_API_KEY) in environment' })
      return
    }

    const { input_task_id, model_url, text_style_prompt, enable_pbr } = req.body

    if (!input_task_id && !model_url) {
      res.status(400).json({ error: 'Missing input_task_id or model_url' })
      return
    }

    if (!text_style_prompt || !text_style_prompt.trim()) {
      res.status(400).json({ error: 'Missing text_style_prompt' })
      return
    }

    const requestBody = {
      text_style_prompt: text_style_prompt.trim(),
      enable_pbr: enable_pbr ?? false,
    }

    if (input_task_id) {
      requestBody.input_task_id = input_task_id
    } else {
      requestBody.model_url = model_url
    }

    const meshyResponse = await fetch('https://api.meshy.ai/openapi/v1/retexture', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${meshyKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    })

    if (!meshyResponse.ok) {
      const errorText = await meshyResponse.text()
      console.error('[/api/meshy/retexture] Meshy API error:', meshyResponse.status, errorText)
      res.status(meshyResponse.status).json({ error: `Meshy.ai API error: ${errorText}` })
      return
    }

    const meshyData = await meshyResponse.json()
    const retextureTaskId = meshyData.result

    if (!retextureTaskId) {
      console.error('[/api/meshy/retexture] No task ID in response:', meshyData)
      res.status(500).json({ error: 'Meshy.ai API did not return a retexture task ID' })
      return
    }

    res.json({
      taskId: retextureTaskId,
      status: 'pending',
    })
  } catch (e) {
    const status = e?.status || e?.response?.status || 500
    const message = e?.message || e?.body || e?.responseText || 'Meshy.ai API error'
    console.error('[/api/meshy/retexture] error:', e)
    console.error('[/api/meshy/retexture] error stack:', e?.stack)
    res.status(status).json({ error: message })
  }
})

// Balance
app.get('/api/meshy/balance', async (req, res) => {
  try {
    if (!meshyKey) {
      res.status(500).json({ error: 'Missing MESHY_API_KEY (or VITE_MESHY_API_KEY) in environment' })
      return
    }

    const meshyResponse = await fetch('https://api.meshy.ai/openapi/v1/balance', {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${meshyKey}`,
      },
    })

    if (!meshyResponse.ok) {
      const errorText = await meshyResponse.text()
      res.status(meshyResponse.status).json({ error: `Meshy.ai API error: ${errorText}` })
      return
    }

    const meshyData = await meshyResponse.json()
    res.json(meshyData)
  } catch (e) {
    const status = e?.status || e?.response?.status || 500
    const message = e?.message || e?.body || e?.responseText || 'Meshy.ai API error'
    console.error('[/api/meshy/balance] error:', e)
    res.status(status).json({ error: message })
  }
})

// Rigging
app.post('/api/meshy/rigging', async (req, res) => {
  try {
    if (!meshyKey) {
      res.status(500).json({ error: 'Missing MESHY_API_KEY (or VITE_MESHY_API_KEY) in environment' })
      return
    }

    const { input_task_id, model_url, height_meters } = req.body

    if (!input_task_id && !model_url) {
      res.status(400).json({ error: 'Missing input_task_id or model_url' })
      return
    }

    const requestBody = {}
    if (input_task_id) {
      requestBody.input_task_id = input_task_id
    } else {
      requestBody.model_url = model_url
    }
    if (height_meters) {
      requestBody.height_meters = height_meters
    }

    const meshyResponse = await fetch('https://api.meshy.ai/openapi/v1/rigging', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${meshyKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    })

    if (!meshyResponse.ok) {
      const errorText = await meshyResponse.text()
      res.status(meshyResponse.status).json({ error: `Meshy.ai API error: ${errorText}` })
      return
    }

    const meshyData = await meshyResponse.json()
    const riggingTaskId = meshyData.result

    if (!riggingTaskId) {
      res.status(500).json({ error: 'Meshy.ai API did not return a rigging task ID' })
      return
    }

    res.json({
      taskId: riggingTaskId,
      status: 'pending',
    })
  } catch (e) {
    const status = e?.status || e?.response?.status || 500
    const message = e?.message || e?.body || e?.responseText || 'Meshy.ai API error'
    console.error('[/api/meshy/rigging] error:', e)
    res.status(status).json({ error: message })
  }
})

// Animations
app.post('/api/meshy/animations', async (req, res) => {
  try {
    if (!meshyKey) {
      res.status(500).json({ error: 'Missing MESHY_API_KEY (or VITE_MESHY_API_KEY) in environment' })
      return
    }

    const { rig_task_id, input_task_id, action_id } = req.body
    const rigTaskId = rig_task_id?.trim() || input_task_id?.trim()

    let actionId
    if (typeof action_id === 'number') {
      actionId = action_id
    } else if (typeof action_id === 'string') {
      const parsed = parseInt(action_id, 10)
      if (!isNaN(parsed)) {
        actionId = parsed
      }
    }

    if (!rigTaskId) {
      res.status(400).json({ error: 'Missing rig_task_id' })
      return
    }

    if (actionId === undefined || actionId === null) {
      res.status(400).json({ error: 'Missing or invalid action_id (must be a number)' })
      return
    }

    const requestBody = {
      rig_task_id: rigTaskId,
      action_id: actionId,
    }

    const meshyResponse = await fetch('https://api.meshy.ai/openapi/v1/animations', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${meshyKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    })

    if (!meshyResponse.ok) {
      const errorText = await meshyResponse.text()
      res.status(meshyResponse.status).json({ error: `Meshy.ai API error: ${errorText}` })
      return
    }

    const meshyData = await meshyResponse.json()
    const animationTaskId = meshyData.result

    if (!animationTaskId) {
      res.status(500).json({ error: 'Meshy.ai API did not return an animation task ID' })
      return
    }

    res.json({
      taskId: animationTaskId,
      status: 'pending',
    })
  } catch (e) {
    const status = e?.status || e?.response?.status || 500
    const message = e?.message || e?.body || e?.responseText || 'Meshy.ai API error'
    console.error('[/api/meshy/animations] error:', e)
    res.status(status).json({ error: message })
  }
})

// Proxy for GLB files (CORS workaround)
app.get('/api/meshy/proxy', async (req, res) => {
  try {
    const urlParam = req.query.url
    if (!urlParam || typeof urlParam !== 'string') {
      res.status(400).json({ error: 'Missing url parameter' })
      return
    }

    // Check URL expiration
    const expiresMatch = urlParam.match(/Expires=(\d+)/)
    if (expiresMatch) {
      const expiresTimestamp = parseInt(expiresMatch[1], 10)
      const expiresDate = new Date(expiresTimestamp * 1000)
      const now = new Date()
      if (now > expiresDate) {
        res.status(403).json({ error: `URL expired at ${expiresDate.toISOString()}` })
        return
      }
    }

    // Build headers
    const headers = {}
    if (req.headers.authorization) {
      headers.Authorization = req.headers.authorization
    } else if (meshyKey) {
      headers.Authorization = `Bearer ${meshyKey}`
    }
    if (req.headers.range) {
      headers.Range = req.headers.range
    }
    headers['User-Agent'] = 'curl/8.0.0'
    headers.Accept = '*/*'

    const targetUrl = new URL(urlParam)
    const isHttps = targetUrl.protocol === 'https:'
    const client = isHttps ? https : http

    await new Promise((resolve, reject) => {
      const requestOptions = {
        hostname: targetUrl.hostname,
        port: targetUrl.port || (isHttps ? 443 : 80),
        path: targetUrl.pathname + targetUrl.search,
        method: 'GET',
        headers,
      }

      const nodeReq = client.request(requestOptions, (nodeRes) => {
        if (nodeRes.statusCode && nodeRes.statusCode >= 400) {
          const chunks = []
          nodeRes.on('data', (chunk) => chunks.push(chunk))
          nodeRes.on('end', () => {
            const errorText = Buffer.concat(chunks).toString()
            res.status(nodeRes.statusCode || 500).json({ error: `Meshy API error: ${nodeRes.statusCode} ${errorText}` })
            resolve()
          })
          return
        }

        res.status(nodeRes.statusCode || 200)

        // Forward headers
        Object.entries(nodeRes.headers).forEach(([key, value]) => {
          if (value) {
            if (key.toLowerCase() !== 'content-encoding' || res.statusCode === 206) {
              const headerValue = Array.isArray(value) ? value.join(', ') : value
              res.setHeader(key, headerValue)
            }
          }
        })

        // Add CORS headers
        res.setHeader('Access-Control-Allow-Origin', '*')
        res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Range')

        // Stream response
        nodeRes.pipe(res)

        nodeRes.on('end', () => resolve())
        nodeRes.on('error', (err) => {
          if (!res.headersSent) {
            res.status(500).json({ error: `Stream error: ${err.message}` })
          } else {
            res.destroy()
          }
          reject(err)
        })
      })

      nodeReq.on('error', (err) => {
        if (!res.headersSent) {
          res.status(500).json({ error: `Proxy request error: ${err.message || 'Unknown error'}` })
        }
        reject(err)
      })

      res.on('close', () => {
        nodeReq.destroy()
      })

      nodeReq.end()
    })
  } catch (e) {
    console.error('[/api/meshy/proxy] error:', e)
    if (!res.headersSent) {
      res.status(500).json({ error: `Proxy error: ${e.message || 'Unknown error'}` })
    }
  }
})

// Image to Image (for refining drawings)
app.post('/api/meshy/image-to-image', async (req, res) => {
  try {
    if (!meshyKey) {
      res.status(500).json({ error: 'Missing MESHY_API_KEY (or VITE_MESHY_API_KEY) in environment' })
      return
    }

    const { image_url, reference_image_urls, prompt, ai_model } = req.body

    // Support both old format (image_url) and new format (reference_image_urls)
    let imageUrls = []
    if (reference_image_urls && Array.isArray(reference_image_urls)) {
      imageUrls = reference_image_urls
    } else if (image_url) {
      // Legacy support: convert single image_url to array
      imageUrls = [image_url.trim()]
    }

    if (!imageUrls || imageUrls.length === 0) {
      res.status(400).json({ error: 'Missing image_url or reference_image_urls' })
      return
    }

    if (!prompt || !prompt.trim()) {
      res.status(400).json({ error: 'Missing prompt' })
      return
    }

    // Ensure ai_model is provided (required by Meshy API)
    const model = ai_model || 'nano-banana'

    const requestBody = {
      reference_image_urls: imageUrls,
      prompt: prompt.trim(),
      ai_model: model, // Required field
    }

    console.log('[/api/meshy/image-to-image] Request body:', JSON.stringify({ ...requestBody, reference_image_urls: imageUrls.map(url => url.length > 100 ? url.substring(0, 100) + '...' : url) }, null, 2))

    const meshyResponse = await fetch('https://api.meshy.ai/openapi/v1/image-to-image', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${meshyKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    })

    if (!meshyResponse.ok) {
      const errorText = await meshyResponse.text()
      console.error('[/api/meshy/image-to-image] Meshy API error:', meshyResponse.status, errorText)
      res.status(meshyResponse.status).json({ error: `Meshy.ai API error: ${errorText}` })
      return
    }

    const meshyData = await meshyResponse.json()
    const taskId = meshyData.result

    if (!taskId) {
      console.error('[/api/meshy/image-to-image] No task ID in response:', meshyData)
      res.status(500).json({ error: 'Meshy.ai API did not return a task ID' })
      return
    }

    res.json({
      taskId,
      status: meshyData.status || 'pending',
    })
  } catch (e) {
    const status = e?.status || e?.response?.status || 500
    const message = e?.message || e?.body || e?.responseText || 'Image-to-image API error'
    console.error('[/api/meshy/image-to-image] error:', e)
    res.status(status).json({ error: message })
  }
})

// Check image-to-image task status
app.get('/api/meshy/image-to-image/status/:taskId', async (req, res) => {
  try {
    if (!meshyKey) {
      res.status(500).json({ error: 'Missing MESHY_API_KEY (or VITE_MESHY_API_KEY) in environment' })
      return
    }

    const { taskId } = req.params

    const meshyResponse = await fetch(`https://api.meshy.ai/openapi/v1/image-to-image/${taskId}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${meshyKey}`,
      },
    })

    if (!meshyResponse.ok) {
      const errorText = await meshyResponse.text()
      res.status(meshyResponse.status).json({ error: `Meshy.ai API error: ${errorText}` })
      return
    }

    const meshyData = await meshyResponse.json()
    
    // Parse image_urls array - Meshy returns image_urls as an array
    let imageUrl = null
    
    if (meshyData.image_urls !== undefined && meshyData.image_urls !== null) {
      if (Array.isArray(meshyData.image_urls) && meshyData.image_urls.length > 0) {
        imageUrl = meshyData.image_urls[0]
      }
    }
    
    // Fallback to other possible locations
    if (!imageUrl) {
      if (meshyData.result?.image_url) {
        imageUrl = meshyData.result.image_url
      } else if (meshyData.image_url) {
        imageUrl = meshyData.image_url
      }
    }
    
    // If we have an image URL from Meshy CDN, proxy it through our server to avoid CORS issues
    let proxiedImageUrl = imageUrl
    if (imageUrl && imageUrl.includes('assets.meshy.ai')) {
      proxiedImageUrl = `/api/meshy/proxy?url=${encodeURIComponent(imageUrl)}`
    }

    const status = meshyData.status || 'PENDING'
    const progress = meshyData.progress !== undefined ? meshyData.progress : null

    res.json({
      taskId,
      imageUrl: proxiedImageUrl,
      status,
      progress,
      error: meshyData.error || meshyData.task_error?.message,
    })
  } catch (e) {
    const status = e?.status || e?.response?.status || 500
    const message = e?.message || e?.body || e?.responseText || 'Meshy.ai API error'
    console.error('[/api/meshy/image-to-image/status] error:', e)
    res.status(status).json({ error: message })
  }
})

// Image to 3D
app.post('/api/meshy/image-to-3d', async (req, res) => {
  try {
    if (!meshyKey) {
      res.status(500).json({ error: 'Missing MESHY_API_KEY (or VITE_MESHY_API_KEY) in environment' })
      return
    }

    const { image_url, texture_prompt, should_texture, enable_pbr, pose_mode } = req.body

    if (!image_url) {
      res.status(400).json({ error: 'Missing image_url' })
      return
    }

    const requestBody = {
      image_url: image_url.trim(),
      should_texture: should_texture ?? true,
    }

    if (texture_prompt && texture_prompt.trim()) {
      requestBody.texture_prompt = texture_prompt.trim()
    }

    if (enable_pbr !== undefined) {
      requestBody.enable_pbr = enable_pbr
    }

    if (pose_mode) {
      requestBody.pose_mode = pose_mode
    }

    const meshyResponse = await fetch('https://api.meshy.ai/openapi/v1/image-to-3d', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${meshyKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    })

    if (!meshyResponse.ok) {
      const errorText = await meshyResponse.text()
      console.error('[/api/meshy/image-to-3d] Meshy API error:', meshyResponse.status, errorText)
      res.status(meshyResponse.status).json({ error: `Meshy.ai API error: ${errorText}` })
      return
    }

    const meshyData = await meshyResponse.json()
    const taskId = meshyData.result

    if (!taskId) {
      console.error('[/api/meshy/image-to-3d] No task ID in response:', meshyData)
      res.status(500).json({ error: 'Meshy.ai API did not return a task ID' })
      return
    }

    res.json({
      taskId,
      status: 'pending',
    })
  } catch (e) {
    const status = e?.status || e?.response?.status || 500
    const message = e?.message || e?.body || e?.responseText || 'Meshy.ai API error'
    console.error('[/api/meshy/image-to-3d] error:', e)
    console.error('[/api/meshy/image-to-3d] error stack:', e?.stack)
    res.status(status).json({ error: message })
  }
})

// Serve static files from dist/ if it exists (production build)
// In dev mode, Vite handles the frontend, so we only serve if dist exists
const distPath = join(__dirname, 'dist')
if (existsSync(distPath)) {
  // Serve static files from dist/
  app.use(express.static(distPath))

  // Fallback to index.html for SPA routing
  app.get('*', (req, res) => {
    res.sendFile(join(distPath, 'index.html'))
  })
} else {
  // In dev mode, just handle API routes (Vite serves the frontend)
  app.get('*', (req, res) => {
    if (!req.url.startsWith('/api')) {
      res.status(404).json({ error: 'Not found - use Vite dev server for frontend' })
    }
  })
}

app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`)
  console.log(`📦 Serving static files from ${join(__dirname, 'dist')}`)
  if (!meshyKey) {
    console.warn('⚠️  MESHY_API_KEY not found in environment')
  }
})

