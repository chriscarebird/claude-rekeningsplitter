import { useState, useRef, useCallback } from 'react'

const LS_KEY = 'rekeningsplitter_api_key'

// ─── Constants ────────────────────────────────────────────────────────────────

const STEPS = ['Upload Receipt', 'Add Diners', 'Assign Items', 'Tip', 'Results']

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Resize to fit within MAX_PX on the longest side and re-encode as JPEG.
// Anthropic recommends ≤1568px; large camera photos cause 502 errors.
const MAX_PX = 1568
const JPEG_QUALITY = 0.85

function resizeAndEncode(file) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const objectUrl = URL.createObjectURL(file)
    img.onload = () => {
      URL.revokeObjectURL(objectUrl)
      const { naturalWidth: w, naturalHeight: h } = img
      const scale = Math.min(1, MAX_PX / Math.max(w, h))
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(w * scale)
      canvas.height = Math.round(h * scale)
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height)
      const dataUrl = canvas.toDataURL('image/jpeg', JPEG_QUALITY)
      resolve(dataUrl.split(',')[1])
    }
    img.onerror = reject
    img.src = objectUrl
  })
}

function fmt(n) {
  return Number(n).toFixed(2)
}

// ─── Step components ──────────────────────────────────────────────────────────

function StepUpload({ items, setItems, onNext, apiKey, setApiKey, forgetKey }) {
  const [dragOver, setDragOver] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [previewUrl, setPreviewUrl] = useState(null)
  const fileInputRef = useRef(null)

  const parseReceipt = useCallback(
    async (file) => {
      if (!apiKey.trim()) {
        setError('Please enter your Anthropic API key above.')
        return
      }
      setLoading(true)
      setError(null)
      setPreviewUrl(URL.createObjectURL(file))

      try {
        const b64 = await resizeAndEncode(file)
        const mediaType = 'image/jpeg'

        // In dev, Vite proxies /anthropic → https://api.anthropic.com to avoid CORS.
        // In production builds served from the same origin, use the real URL directly.
        const apiBase = import.meta.env.DEV
          ? '/anthropic'
          : 'https://api.anthropic.com'
        const response = await fetch(`${apiBase}/v1/messages`, {
          method: 'POST',
          headers: {
            'x-api-key': apiKey.trim(),
            'anthropic-version': '2023-06-01',
            'anthropic-dangerous-direct-browser-access': 'true',
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
                    source: { type: 'base64', media_type: mediaType, data: b64 },
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

        if (!response.ok) {
          const body = await response.json().catch(() => ({}))
          throw new Error(body?.error?.message || `API error ${response.status}`)
        }

        const data = await response.json()
        const text = data.content?.[0]?.text ?? ''

        // Strip markdown fences if present
        const cleaned = text.replace(/```(?:json)?\n?/g, '').trim()
        const parsed = JSON.parse(cleaned)

        if (!Array.isArray(parsed)) throw new Error('Response is not an array')

        setItems(
          parsed.map((item, i) => ({
            id: i,
            name: String(item.name ?? 'Item'),
            total: Number(item.total ?? 0),
            quantity: Number(item.quantity ?? 1),
          })),
        )
      } catch (err) {
        setError(err.message)
        // Provide a blank item so the user can manually add items
        if (items.length === 0) {
          setItems([{ id: 0, name: '', total: 0, quantity: 1 }])
        }
      } finally {
        setLoading(false)
      }
    },
    [apiKey, items.length, setItems],
  )

  const handleFile = (file) => {
    if (!file) return
    if (!file.type.startsWith('image/')) {
      setError('Please upload a JPEG or PNG image.')
      return
    }
    parseReceipt(file)
  }

  const handleDrop = (e) => {
    e.preventDefault()
    setDragOver(false)
    handleFile(e.dataTransfer.files[0])
  }

  const updateItem = (id, field, value) => {
    setItems((prev) =>
      prev.map((it) => (it.id === id ? { ...it, [field]: value } : it)),
    )
  }

  const addItem = () => {
    setItems((prev) => [
      ...prev,
      { id: Date.now(), name: '', total: 0, quantity: 1 },
    ])
  }

  const removeItem = (id) => {
    setItems((prev) => prev.filter((it) => it.id !== id))
  }

  const canProceed = items.length > 0 && items.every((it) => it.name.trim())

  return (
    <div className="space-y-6">
      {/* API Key */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Anthropic API Key
        </label>
        <div className="flex gap-2">
          <input
            type="password"
            placeholder="sk-ant-..."
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
          />
          {apiKey && (
            <button
              onClick={forgetKey}
              title="Forget saved key"
              className="px-3 py-2 rounded-lg border border-gray-300 text-xs text-gray-500 hover:border-red-300 hover:text-red-600 hover:bg-red-50 transition-colors whitespace-nowrap"
            >
              Forget key
            </button>
          )}
        </div>
        <p className="mt-1 text-xs text-gray-400">
          {apiKey
            ? 'Key saved in your browser — click "Forget key" to remove it.'
            : 'Your key will be saved in localStorage for future sessions.'}
        </p>
      </div>

      {/* Drop zone */}
      <div
        className={`relative border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors ${
          dragOver
            ? 'border-indigo-500 bg-indigo-50'
            : 'border-gray-300 hover:border-indigo-400 hover:bg-gray-50'
        }`}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png"
          className="hidden"
          onChange={(e) => handleFile(e.target.files[0])}
        />
        {loading ? (
          <div className="flex flex-col items-center gap-3">
            <Spinner />
            <p className="text-sm text-indigo-600 font-medium">Parsing receipt…</p>
          </div>
        ) : previewUrl ? (
          <div className="flex flex-col items-center gap-3">
            <img
              src={previewUrl}
              alt="Receipt preview"
              className="max-h-48 rounded-lg shadow"
            />
            <p className="text-xs text-gray-500">Click or drop to replace</p>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2 text-gray-500">
            <svg className="w-10 h-10 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
            </svg>
            <p className="text-sm font-medium">Drop receipt image here</p>
            <p className="text-xs">or click to browse — JPEG / PNG</p>
          </div>
        )}
      </div>

      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">
          <strong>Error:</strong> {error}
        </div>
      )}

      {/* Editable item list */}
      {items.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-gray-700 mb-2">
            Extracted Items — edit if needed
          </h3>
          <div className="space-y-2">
            {items.map((item) => (
              <div key={item.id} className="flex gap-2 items-center">
                <input
                  type="text"
                  placeholder="Item name"
                  value={item.name}
                  onChange={(e) => updateItem(item.id, 'name', e.target.value)}
                  className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                />
                <input
                  type="number"
                  min="1"
                  placeholder="Qty"
                  value={item.quantity}
                  onChange={(e) =>
                    updateItem(item.id, 'quantity', Number(e.target.value))
                  }
                  className="w-16 border border-gray-300 rounded-lg px-2 py-2 text-sm text-center focus:outline-none focus:ring-2 focus:ring-indigo-400"
                />
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="Total"
                  value={item.total}
                  onChange={(e) =>
                    updateItem(item.id, 'total', Number(e.target.value))
                  }
                  className="w-24 border border-gray-300 rounded-lg px-2 py-2 text-sm text-right focus:outline-none focus:ring-2 focus:ring-indigo-400"
                />
                <button
                  onClick={() => removeItem(item.id)}
                  className="text-gray-400 hover:text-red-500 transition-colors"
                  title="Remove item"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
          <button
            onClick={addItem}
            className="mt-2 text-sm text-indigo-600 hover:text-indigo-800 font-medium flex items-center gap-1"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Add item manually
          </button>
        </div>
      )}

      {items.length === 0 && !loading && (
        <button
          onClick={addItem}
          className="w-full py-2 border-2 border-dashed border-gray-300 rounded-lg text-sm text-gray-500 hover:border-indigo-400 hover:text-indigo-600 transition-colors"
        >
          + Add items manually
        </button>
      )}

      <button
        disabled={!canProceed}
        onClick={onNext}
        className="w-full py-3 rounded-xl font-semibold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
      >
        Continue to Add Diners
      </button>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────

function StepDiners({ diners, setDiners, onNext, onBack }) {
  const [input, setInput] = useState('')

  const addDiners = () => {
    const names = input
      .split(',')
      .map((n) => n.trim())
      .filter(Boolean)
    if (!names.length) return
    setDiners((prev) => {
      const existing = new Set(prev.map((d) => d.toLowerCase()))
      const fresh = names.filter((n) => !existing.has(n.toLowerCase()))
      return [...prev, ...fresh]
    })
    setInput('')
  }

  const handleKey = (e) => {
    if (e.key === 'Enter') addDiners()
  }

  const removeDiner = (name) => {
    setDiners((prev) => prev.filter((d) => d !== name))
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-gray-600">
        Who was at the table? Add names one by one or comma-separated.
      </p>

      <div className="flex gap-2">
        <input
          type="text"
          placeholder="Alice, Bob, Carol…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKey}
          className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
        />
        <button
          onClick={addDiners}
          className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 transition-colors"
        >
          Add
        </button>
      </div>

      {diners.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {diners.map((name) => (
            <span
              key={name}
              className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-indigo-100 text-indigo-800 text-sm font-medium"
            >
              {name}
              <button
                onClick={() => removeDiner(name)}
                className="hover:text-red-600 transition-colors"
                title={`Remove ${name}`}
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="flex gap-3">
        <button
          onClick={onBack}
          className="flex-1 py-3 rounded-xl font-semibold text-gray-600 bg-gray-100 hover:bg-gray-200 transition-colors"
        >
          Back
        </button>
        <button
          disabled={diners.length < 1}
          onClick={onNext}
          className="flex-1 py-3 rounded-xl font-semibold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          Assign Items
        </button>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────

function StepAssign({ items, diners, assignments, setAssignments, onNext, onBack }) {
  const toggleAssignment = (itemId, diner) => {
    setAssignments((prev) => {
      const current = prev[itemId] ?? []
      const updated = current.includes(diner)
        ? current.filter((d) => d !== diner)
        : [...current, diner]
      return { ...prev, [itemId]: updated }
    })
  }

  const assignAll = (itemId) => {
    setAssignments((prev) => ({ ...prev, [itemId]: [...diners] }))
  }

  const unassigned = items.filter(
    (it) => !assignments[it.id] || assignments[it.id].length === 0,
  )
  const canProceed = unassigned.length === 0

  return (
    <div className="space-y-4">
      {!canProceed && (
        <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 text-sm text-amber-700">
          {unassigned.length} item{unassigned.length > 1 ? 's' : ''} still unassigned.
        </div>
      )}

      <div className="space-y-3">
        {items.map((item) => {
          const assigned = assignments[item.id] ?? []
          const isUnassigned = assigned.length === 0

          return (
            <div
              key={item.id}
              className={`rounded-xl border p-4 transition-colors ${
                isUnassigned ? 'border-amber-300 bg-amber-50' : 'border-gray-200 bg-white'
              }`}
            >
              <div className="flex justify-between items-start mb-3">
                <div>
                  <p className="font-medium text-gray-800 text-sm">{item.name}</p>
                  {item.quantity > 1 && (
                    <p className="text-xs text-gray-400">×{item.quantity}</p>
                  )}
                </div>
                <span className="text-sm font-semibold text-gray-700">
                  €{fmt(item.total)}
                </span>
              </div>

              <div className="flex flex-wrap gap-2 items-center">
                {diners.map((diner) => (
                  <button
                    key={diner}
                    onClick={() => toggleAssignment(item.id, diner)}
                    className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                      assigned.includes(diner)
                        ? 'bg-indigo-600 text-white border-indigo-600'
                        : 'bg-white text-gray-600 border-gray-300 hover:border-indigo-400'
                    }`}
                  >
                    {diner}
                  </button>
                ))}
                <button
                  onClick={() => assignAll(item.id)}
                  className="px-3 py-1 rounded-full text-xs font-medium border border-dashed border-gray-400 text-gray-500 hover:border-indigo-400 hover:text-indigo-600 transition-colors"
                >
                  All
                </button>
              </div>
            </div>
          )
        })}
      </div>

      <div className="flex gap-3 pt-2">
        <button
          onClick={onBack}
          className="flex-1 py-3 rounded-xl font-semibold text-gray-600 bg-gray-100 hover:bg-gray-200 transition-colors"
        >
          Back
        </button>
        <button
          disabled={!canProceed}
          onClick={onNext}
          className="flex-1 py-3 rounded-xl font-semibold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          Add Tip
        </button>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────

function StepTip({ tip, setTip, tipMode, setTipMode, diners, items, assignments, onNext, onBack }) {
  const subtotals = computeSubtotals(items, assignments, diners)
  const grandSubtotal = Object.values(subtotals).reduce((s, v) => s + v, 0)

  return (
    <div className="space-y-6">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Tip amount (€)
        </label>
        <input
          type="number"
          min="0"
          step="0.01"
          placeholder="0.00"
          value={tip}
          onChange={(e) => setTip(e.target.value)}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
        />
      </div>

      <div>
        <p className="text-sm font-medium text-gray-700 mb-2">Split tip</p>
        <div className="flex gap-3">
          {[
            { value: 'equal', label: 'Equally' },
            { value: 'proportional', label: 'Proportionally' },
          ].map((opt) => (
            <button
              key={opt.value}
              onClick={() => setTipMode(opt.value)}
              className={`flex-1 py-2 rounded-lg border text-sm font-medium transition-colors ${
                tipMode === opt.value
                  ? 'bg-indigo-600 text-white border-indigo-600'
                  : 'bg-white text-gray-600 border-gray-300 hover:border-indigo-400'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
        {tipMode === 'proportional' && grandSubtotal === 0 && (
          <p className="mt-2 text-xs text-amber-600">
            All subtotals are zero — tip will be split equally instead.
          </p>
        )}
      </div>

      {/* Preview */}
      {tip > 0 && diners.length > 0 && (
        <div className="rounded-xl border border-gray-200 p-4 bg-gray-50">
          <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Preview</p>
          {(() => {
            const tipShares = computeTipShares(
              Number(tip),
              tipMode,
              diners,
              subtotals,
            )
            return diners.map((d) => (
              <div key={d} className="flex justify-between text-sm py-0.5">
                <span className="text-gray-700">{d}</span>
                <span className="font-medium">€{fmt(tipShares[d])}</span>
              </div>
            ))
          })()}
        </div>
      )}

      <div className="flex gap-3">
        <button
          onClick={onBack}
          className="flex-1 py-3 rounded-xl font-semibold text-gray-600 bg-gray-100 hover:bg-gray-200 transition-colors"
        >
          Back
        </button>
        <button
          onClick={onNext}
          className="flex-1 py-3 rounded-xl font-semibold text-white bg-indigo-600 hover:bg-indigo-700 transition-colors"
        >
          See Results
        </button>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────

function StepResults({ items, diners, assignments, tip, tipMode, onReset }) {
  const subtotals = computeSubtotals(items, assignments, diners)
  const tipShares = computeTipShares(Number(tip), tipMode, diners, subtotals)

  const [copied, setCopied] = useState(false)

  const copyResults = () => {
    const lines = ['RekeningSplitter — Results', '']
    diners.forEach((diner) => {
      lines.push(`${diner}`)
      const dinerItems = items.filter(
        (it) => (assignments[it.id] ?? []).includes(diner),
      )
      dinerItems.forEach((it) => {
        const share = it.total / (assignments[it.id]?.length ?? 1)
        lines.push(`  ${it.name}: €${fmt(share)}`)
      })
      lines.push(`  Tip: €${fmt(tipShares[diner])}`)
      lines.push(`  Total: €${fmt(subtotals[diner] + tipShares[diner])}`)
      lines.push('')
    })
    navigator.clipboard.writeText(lines.join('\n')).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  const grandTotal = diners.reduce(
    (s, d) => s + subtotals[d] + tipShares[d],
    0,
  )

  return (
    <div className="space-y-4">
      {diners.map((diner) => {
        const dinerItems = items.filter(
          (it) => (assignments[it.id] ?? []).includes(diner),
        )
        const total = subtotals[diner] + tipShares[diner]

        return (
          <div
            key={diner}
            className="rounded-xl border border-gray-200 overflow-hidden"
          >
            <div className="bg-indigo-600 px-4 py-3 flex justify-between items-center">
              <h3 className="font-semibold text-white">{diner}</h3>
              <span className="text-white font-bold text-lg">€{fmt(total)}</span>
            </div>
            <div className="divide-y divide-gray-100">
              {dinerItems.map((it) => {
                const share = it.total / (assignments[it.id]?.length ?? 1)
                return (
                  <div key={it.id} className="flex justify-between px-4 py-2 text-sm">
                    <span className="text-gray-700">
                      {it.name}
                      {assignments[it.id]?.length > 1 && (
                        <span className="text-gray-400 ml-1">
                          (÷{assignments[it.id].length})
                        </span>
                      )}
                    </span>
                    <span className="text-gray-800">€{fmt(share)}</span>
                  </div>
                )
              })}
              {Number(tip) > 0 && (
                <div className="flex justify-between px-4 py-2 text-sm text-gray-500">
                  <span>Tip</span>
                  <span>€{fmt(tipShares[diner])}</span>
                </div>
              )}
            </div>
          </div>
        )
      })}

      <div className="rounded-xl bg-gray-50 border border-gray-200 px-4 py-3 flex justify-between font-semibold text-gray-800">
        <span>Grand Total</span>
        <span>€{fmt(grandTotal)}</span>
      </div>

      <div className="flex gap-3 pt-2">
        <button
          onClick={copyResults}
          className="flex-1 py-3 rounded-xl font-semibold text-indigo-600 border-2 border-indigo-600 hover:bg-indigo-50 transition-colors flex items-center justify-center gap-2"
        >
          {copied ? (
            <>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              Copied!
            </>
          ) : (
            <>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
              Copy Results
            </>
          )}
        </button>
        <button
          onClick={onReset}
          className="flex-1 py-3 rounded-xl font-semibold text-gray-600 bg-gray-100 hover:bg-gray-200 transition-colors"
        >
          Start Over
        </button>
      </div>
    </div>
  )
}

// ─── Shared calculation helpers ───────────────────────────────────────────────

function computeSubtotals(items, assignments, diners) {
  const subtotals = Object.fromEntries(diners.map((d) => [d, 0]))
  items.forEach((item) => {
    const assigned = assignments[item.id] ?? []
    if (assigned.length === 0) return
    const share = item.total / assigned.length
    assigned.forEach((d) => {
      subtotals[d] = (subtotals[d] ?? 0) + share
    })
  })
  return subtotals
}

function computeTipShares(tip, mode, diners, subtotals) {
  if (!tip || diners.length === 0) {
    return Object.fromEntries(diners.map((d) => [d, 0]))
  }

  const grandSubtotal = Object.values(subtotals).reduce((s, v) => s + v, 0)

  let shares
  if (mode === 'proportional' && grandSubtotal > 0) {
    shares = diners.map((d) => (subtotals[d] / grandSubtotal) * tip)
  } else {
    const each = tip / diners.length
    shares = diners.map(() => each)
  }

  // Round to 2 decimal places, absorb remainder in last person
  const rounded = shares.map((s) => Math.round(s * 100) / 100)
  const roundedSum = rounded.reduce((a, b) => a + b, 0)
  const remainder = Math.round((tip - roundedSum) * 100) / 100
  rounded[rounded.length - 1] = Math.round((rounded[rounded.length - 1] + remainder) * 100) / 100

  return Object.fromEntries(diners.map((d, i) => [d, rounded[i]]))
}

// ─── Spinner ──────────────────────────────────────────────────────────────────

function Spinner() {
  return (
    <svg
      className="w-8 h-8 animate-spin text-indigo-600"
      fill="none"
      viewBox="0 0 24 24"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
      />
    </svg>
  )
}

// ─── Progress indicator ───────────────────────────────────────────────────────

function ProgressBar({ step }) {
  return (
    <div className="flex items-center gap-1 mb-8">
      {STEPS.map((label, i) => (
        <div key={label} className="flex items-center gap-1 flex-1 min-w-0">
          <div className="flex flex-col items-center flex-shrink-0">
            <div
              className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${
                i < step
                  ? 'bg-indigo-600 text-white'
                  : i === step
                  ? 'bg-indigo-600 text-white ring-2 ring-indigo-200'
                  : 'bg-gray-200 text-gray-500'
              }`}
            >
              {i < step ? (
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                </svg>
              ) : (
                i + 1
              )}
            </div>
            <span
              className={`text-[10px] mt-0.5 font-medium hidden sm:block truncate max-w-[60px] text-center ${
                i === step ? 'text-indigo-700' : 'text-gray-400'
              }`}
            >
              {label}
            </span>
          </div>
          {i < STEPS.length - 1 && (
            <div
              className={`h-0.5 flex-1 rounded-full transition-colors ${
                i < step ? 'bg-indigo-600' : 'bg-gray-200'
              }`}
            />
          )}
        </div>
      ))}
    </div>
  )
}

// ─── Root App ─────────────────────────────────────────────────────────────────

export default function App() {
  const [step, setStep] = useState(0)
  const [apiKey, setApiKey] = useState(() => localStorage.getItem(LS_KEY) ?? '')
  const [items, setItems] = useState([])

  // Write to localStorage synchronously in the same call — no useEffect timing gap.
  const saveApiKey = (key) => {
    if (key) {
      localStorage.setItem(LS_KEY, key)
    }
    setApiKey(key)
  }

  const forgetKey = () => {
    localStorage.removeItem(LS_KEY)
    setApiKey('')
  }
  const [diners, setDiners] = useState([])
  const [assignments, setAssignments] = useState({})
  const [tip, setTip] = useState('')
  const [tipMode, setTipMode] = useState('equal')

  const reset = () => {
    setStep(0)
    setItems([])
    setDiners([])
    setAssignments({})
    setTip('')
    setTipMode('equal')
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-50 to-purple-50 flex items-start justify-center p-4 pt-8">
      <div className="w-full max-w-lg">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-indigo-700 tracking-tight">
            RekeningSplitter
          </h1>
          <p className="text-sm text-gray-500 mt-1">Split the bill, keep the peace.</p>
        </div>

        {/* Card */}
        <div className="bg-white rounded-2xl shadow-lg p-6">
          <ProgressBar step={step} />

          <h2 className="text-lg font-semibold text-gray-800 mb-4">
            {STEPS[step]}
          </h2>

          {step === 0 && (
            <StepUpload
              items={items}
              setItems={setItems}
              onNext={() => setStep(1)}
              apiKey={apiKey}
              setApiKey={saveApiKey}
              forgetKey={forgetKey}
            />
          )}
          {step === 1 && (
            <StepDiners
              diners={diners}
              setDiners={setDiners}
              onNext={() => setStep(2)}
              onBack={() => setStep(0)}
            />
          )}
          {step === 2 && (
            <StepAssign
              items={items}
              diners={diners}
              assignments={assignments}
              setAssignments={setAssignments}
              onNext={() => setStep(3)}
              onBack={() => setStep(1)}
            />
          )}
          {step === 3 && (
            <StepTip
              tip={tip}
              setTip={setTip}
              tipMode={tipMode}
              setTipMode={setTipMode}
              diners={diners}
              items={items}
              assignments={assignments}
              onNext={() => setStep(4)}
              onBack={() => setStep(2)}
            />
          )}
          {step === 4 && (
            <StepResults
              items={items}
              diners={diners}
              assignments={assignments}
              tip={tip}
              tipMode={tipMode}
              onReset={reset}
            />
          )}
        </div>

        <p className="text-center text-xs text-gray-400 mt-4">
          Powered by Claude · All processing happens in your browser
        </p>
      </div>
    </div>
  )
}
