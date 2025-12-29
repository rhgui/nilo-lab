export type GenerateSkyboxResult = {
  imageUrl: string
}

export type GenerateSkyboxOptions = {
  prompt: string
}

export async function generateSkyboxImage({ prompt }: GenerateSkyboxOptions): Promise<GenerateSkyboxResult> {
  const res = await fetch("/api/skybox", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prompt }),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => "")
    throw new Error(`Skybox API failed (${res.status}): ${text}`)
  }

  const data = (await res.json()) as { imageUrl?: string }
  if (!data.imageUrl) throw new Error("Skybox API response missing imageUrl")
  return { imageUrl: data.imageUrl }
}

