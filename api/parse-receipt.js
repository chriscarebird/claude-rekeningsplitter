/**
 * Vercel serverless function — proxies receipt images to the Anthropic API.
 * The ANTHROPIC_API_KEY environment variable is set in the Vercel dashboard
 * and never exposed to the browser.
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return res.status(500).json({ error: 'Server is missing ANTHROPIC_API_KEY configuration.' })
  }

  const { imageBase64, mediaType } = req.body ?? {}
  if (!imageBase64 || !mediaType) {
    return res.status(400).json({ error: 'imageBase64 and mediaType are required.' })
  }

  let anthropicRes
  try {
    anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens: 1024,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: { type: 'base64', media_type: mediaType, data: imageBase64 },
              },
              {
                type: 'text',
                text: 'Extract every line item from this receipt. Return ONLY a valid JSON array — no markdown, no explanation. Each element must have exactly these fields: {"name": string, "total": number, "quantity": number}. The total should be the full price for that line (unit price × quantity). If quantity is not shown, use 1.',
              },
            ],
          },
        ],
      }),
    })
  } catch (err) {
    return res.status(502).json({ error: `Failed to reach Anthropic API: ${err.message}` })
  }

  const data = await anthropicRes.json()

  if (!anthropicRes.ok) {
    return res.status(anthropicRes.status).json({ error: data?.error?.message ?? 'Anthropic API error' })
  }

  return res.status(200).json(data)
}
