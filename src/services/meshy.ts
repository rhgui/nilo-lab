/**
 * Meshy.ai API service for 3D model generation
 * 
 * Note: You'll need to set up your Meshy.ai API key in your environment variables
 * Add MESHY_API_KEY to your .env file or environment
 */

export type MeshyGenerateRequest = {
  prompt: string
  mode?: "preview" | "full"
  style?: string
}

export type MeshyGenerateResponse = {
  taskId: string
  status: "pending" | "processing" | "completed" | "failed"
  modelUrl?: string
  error?: string
}

/**
 * Generate a 3D model using Meshy.ai API
 * This is a placeholder - adjust based on Meshy.ai's actual API documentation
 */
export async function generateMeshyModel(
  prompt: string,
  apiKey?: string
): Promise<MeshyGenerateResponse> {
  const key = apiKey || import.meta.env.VITE_MESHY_API_KEY

  if (!key) {
    throw new Error("Meshy.ai API key not found. Please set VITE_MESHY_API_KEY in your environment.")
  }

  // This is a placeholder implementation
  // You'll need to check Meshy.ai's actual API documentation for the correct endpoints
  const response = await fetch("https://api.meshy.ai/v2/image-to-3d", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      prompt,
      mode: "preview",
    }),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Meshy.ai API error: ${error}`)
  }

  const data = await response.json()
  return data
}

/**
 * Check the status of a generation task
 */
export async function checkMeshyTaskStatus(
  taskId: string,
  apiKey?: string
): Promise<MeshyGenerateResponse> {
  const key = apiKey || import.meta.env.VITE_MESHY_API_KEY

  if (!key) {
    throw new Error("Meshy.ai API key not found.")
  }

  const response = await fetch(`https://api.meshy.ai/v2/image-to-3d/${taskId}`, {
    method: "GET",
    headers: {
      "Authorization": `Bearer ${key}`,
    },
  })

  if (!response.ok) {
    throw new Error(`Failed to check task status: ${response.statusText}`)
  }

  return response.json()
}

