export type GenerateSkyboxResult = {
  imageUrl: string
}

export type GenerateSkyboxOptions = {
  prompt: string
  aiModel?: 'nano-banana' | 'nano-banana-pro'
  onProgress?: (progress: number) => void
}

export type SkyboxStatusResponse = {
  taskId: string
  imageUrl: string | null
  status: string
  progress: number | null
  error?: string
}

export async function generateSkyboxImage({ prompt, aiModel = 'nano-banana', onProgress }: GenerateSkyboxOptions): Promise<GenerateSkyboxResult> {
  // Create task
  const res = await fetch("/api/skybox", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prompt, ai_model: aiModel }),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => "")
    throw new Error(`Skybox API failed (${res.status}): ${text}`)
  }

  const data = (await res.json()) as { taskId?: string; status?: string }
  if (!data.taskId) throw new Error("Skybox API response missing taskId")

  // Poll for completion with progress updates
  let attempts = 0
  const maxAttempts = 120
  const pollInterval = 2000

  const pollStatus = async (): Promise<string> => {
    const statusRes = await fetch(`/api/skybox/status/${encodeURIComponent(data.taskId!)}`)
    if (!statusRes.ok) {
      const errorText = await statusRes.text().catch(() => "")
      throw new Error(`Failed to check skybox status (${statusRes.status}): ${errorText}`)
    }

    const statusData = (await statusRes.json()) as SkyboxStatusResponse
    attempts++

    // Debug logging
    console.log(`[meshySkybox] Status check ${attempts}:`, {
      status: statusData.status,
      progress: statusData.progress,
      hasImageUrl: !!statusData.imageUrl,
      imageUrl: statusData.imageUrl ? statusData.imageUrl.substring(0, 150) + "..." : null,
      isProxied: statusData.imageUrl?.startsWith('/api/meshy/proxy'),
      fullResponse: statusData, // Log full response for debugging
    })

    // Update progress if available
    if (statusData.progress !== null && statusData.progress !== undefined && onProgress) {
      onProgress(statusData.progress)
    } else if (onProgress && (statusData.status === "PENDING" || statusData.status === "IN_PROGRESS")) {
      // Estimate progress based on attempts if not provided
      onProgress(Math.min((attempts / maxAttempts) * 90, 90))
    }

    if (statusData.status === "SUCCEEDED" || statusData.status === "completed") {
      if (statusData.imageUrl) {
        if (onProgress) onProgress(100)
        return statusData.imageUrl
      }
      // Status is SUCCEEDED but imageUrl is null - this can happen if image_urls
      // hasn't been populated yet. Retry a few times with short delays.
      if (attempts < maxAttempts) {
        console.warn(`[meshySkybox] Status SUCCEEDED but no imageUrl yet. Retrying... (attempt ${attempts}/${maxAttempts})`)
        await new Promise((resolve) => setTimeout(resolve, 500)) // Short delay before retry
        return pollStatus()
      }
      // Log full response for debugging
      console.error("[meshySkybox] Status SUCCEEDED but no imageUrl after retries. Full response:", statusData)
      throw new Error("Skybox generation completed but no image URL returned. Check server logs for details.")
    }

    if (statusData.status === "FAILED" || statusData.status === "failed") {
      throw new Error(statusData.error || "Skybox generation failed")
    }

    if (attempts >= maxAttempts) {
      throw new Error("Skybox generation timed out")
    }

    await new Promise((resolve) => setTimeout(resolve, pollInterval))
    return pollStatus()
  }

  const imageUrl = await pollStatus()
  return { imageUrl }
}

