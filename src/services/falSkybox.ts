import { fal } from "@fal-ai/client"

export type GenerateSkyboxResult = {
  imageUrl: string
}

export type GenerateSkyboxOptions = {
  prompt: string
}

function getFalKey() {
  // Vite exposes VITE_* env vars to the browser build.
  // For production, route requests through a server so you don't ship your key.
  const key = import.meta.env.VITE_FAL_KEY as string | undefined
  if (!key) {
    throw new Error(
      "Missing VITE_FAL_KEY. Add it to a .env.local file (VITE_FAL_KEY=...) and restart the dev server.",
    )
  }
  return key
}

let configured = false
function ensureConfigured() {
  if (configured) return
  fal.config({ credentials: getFalKey() })
  configured = true
}

export async function generateSkyboxImage({ prompt }: GenerateSkyboxOptions): Promise<GenerateSkyboxResult> {
  ensureConfigured()

  // Baseline model; swap as needed.
  const result = await fal.subscribe("fal-ai/flux/schnell", {
    input: {
      prompt,
      image_size: "landscape_16_9",
      num_inference_steps: 4,
    },
  })

  // Different models / SDK versions may nest output under `data`.
  const r: any = result as any
  const imageUrl =
    (r?.images?.[0]?.url as string | undefined) ??
    (r?.data?.images?.[0]?.url as string | undefined) ??
    (r?.data?.image?.url as string | undefined) ??
    (r?.output?.[0]?.url as string | undefined) ??
    (r?.data?.output?.[0]?.url as string | undefined)

  if (!imageUrl) {
    const keys = Object.keys(r ?? {})
    const dataKeys = Object.keys(r?.data ?? {})
    // eslint-disable-next-line no-console
    console.error("fal.ai unexpected response shape:", { keys, dataKeys, result: r })
    throw new Error("fal.ai response missing image url (check console for response shape)")
  }

  return { imageUrl }
}

