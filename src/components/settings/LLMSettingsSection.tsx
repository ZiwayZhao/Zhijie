/**
 * LLMSettingsSection — API key and model configuration.
 */
import { useState, useCallback, useEffect } from 'react'
import { motion, type Variants } from 'framer-motion'
import { Eye, EyeOff, Loader2, Check } from 'lucide-react'
import { authFetch } from '@/lib/auth-api'

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8003/api'
const SETTINGS_API = `${API_BASE}/v1/user/settings`

const fadeUp: Variants = {
  hidden: { opacity: 0, y: 12 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.05, duration: 0.35, ease: 'easeOut' },
  }),
}

interface ProviderPreset {
  id: string
  label: string
  base_url: string
}

interface LLMSettingsState {
  llm_provider: string
  llm_base_url: string | null
  has_api_key: boolean
  llm_api_key_masked: string | null
  llm_model: string | null
}

export default function LLMSettingsSection() {
  const [providers, setProviders] = useState<ProviderPreset[]>([])
  const [settings, setSettings] = useState<LLMSettingsState | null>(null)
  const [provider, setProvider] = useState('system')
  const [apiKey, setApiKey] = useState('')
  const [customUrl, setCustomUrl] = useState('')
  const [model, setModel] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)

  // Load providers + current settings
  useEffect(() => {
    Promise.all([
      fetch(`${SETTINGS_API}/llm/providers`).then(r => r.json()),
      authFetch(`${SETTINGS_API}/llm`).then(r => r.ok ? r.json() : null),
    ]).then(([provRes, settRes]) => {
      setProviders(provRes.providers || [])
      if (settRes) {
        setSettings(settRes)
        setProvider(settRes.llm_provider)
        setCustomUrl(settRes.llm_base_url || '')
        setModel(settRes.llm_model || '')
      }
    })
  }, [])

  const handleSave = useCallback(async () => {
    setSaving(true)
    setMessage(null)
    try {
      const body: Record<string, unknown> = {
        llm_provider: provider,
        llm_model: model || null,
      }
      if (apiKey) body.llm_api_key = apiKey
      if (provider === 'custom') body.llm_base_url = customUrl
      const res = await authFetch(`${SETTINGS_API}/llm`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: '保存失败' }))
        throw new Error(err.detail || '保存失败')
      }
      const updated = await res.json()
      setSettings(updated)
      setApiKey('')
      setMessage({ type: 'ok', text: '已保存' })
      setTimeout(() => setMessage(null), 3000)
    } catch (e: any) {
      setMessage({ type: 'err', text: e.message || '保存失败' })
    } finally {
      setSaving(false)
    }
  }, [provider, apiKey, customUrl, model])

  const selectedPreset = providers.find(p => p.id === provider)

  return (
    <motion.section variants={fadeUp} custom={2} initial="hidden" animate="visible" className="mt-8">
      <h2 className="font-heading text-lg text-text-main mb-1">AI 模型配置</h2>
      <p className="text-xs text-text-muted mb-4">
        配置你自己的 LLM API Key，使用你偏好的模型进行材料分析
      </p>

      <div className="border border-border-warm rounded-md bg-bg-card px-5 py-4 space-y-4">
        {/* Provider selector */}
        <div>
          <label className="text-xs text-text-muted block mb-1.5">服务商</label>
          <div className="flex flex-wrap gap-1.5">
            {providers.map(p => (
              <button
                key={p.id}
                onClick={() => {
                  setProvider(p.id)
                  if (p.id !== 'custom' && p.base_url) setCustomUrl(p.base_url)
                }}
                className={`px-3 py-1.5 text-xs rounded-md border transition-colors ${
                  provider === p.id
                    ? 'bg-red-primary text-white border-red-primary'
                    : 'bg-bg-card text-text-body border-border-warm hover:border-red-primary/40'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {provider !== 'system' && (
          <>
            {/* API Key */}
            <div>
              <label className="text-xs text-text-muted block mb-1.5">API Key</label>
              <div className="relative">
                <input
                  type={showKey ? 'text' : 'password'}
                  value={apiKey}
                  onChange={e => setApiKey(e.target.value)}
                  placeholder={settings?.has_api_key ? `已保存 (${settings.llm_api_key_masked})` : '输入 API Key'}
                  className="w-full text-sm px-3 py-2 pr-9 rounded-md border border-border-warm
                             bg-bg-main text-text-body placeholder:text-text-muted/50
                             outline-none focus:border-red-primary transition-colors font-mono"
                />
                <button
                  type="button"
                  onClick={() => setShowKey(v => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-body"
                >
                  {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </div>

            {/* Custom URL (only for "custom") */}
            {provider === 'custom' && (
              <div>
                <label className="text-xs text-text-muted block mb-1.5">Base URL</label>
                <input
                  type="text"
                  value={customUrl}
                  onChange={e => setCustomUrl(e.target.value)}
                  placeholder="https://api.example.com/v1"
                  className="w-full text-sm px-3 py-2 rounded-md border border-border-warm
                             bg-bg-main text-text-body placeholder:text-text-muted/50
                             outline-none focus:border-red-primary transition-colors font-mono"
                />
              </div>
            )}

            {/* Resolved URL (readonly, for presets) */}
            {provider !== 'custom' && selectedPreset?.base_url && (
              <div>
                <label className="text-xs text-text-muted block mb-1.5">Endpoint</label>
                <p className="text-xs text-text-muted font-mono bg-bg-accent rounded px-2 py-1.5">
                  {selectedPreset.base_url}
                </p>
              </div>
            )}

            {/* Model */}
            <div>
              <label className="text-xs text-text-muted block mb-1.5">模型名称（可选）</label>
              <input
                type="text"
                value={model}
                onChange={e => setModel(e.target.value)}
                placeholder="如 hunyuan-turbos, gpt-4o, deepseek-chat"
                className="w-full text-sm px-3 py-2 rounded-md border border-border-warm
                           bg-bg-main text-text-body placeholder:text-text-muted/50
                           outline-none focus:border-red-primary transition-colors"
              />
            </div>
          </>
        )}

        {/* Save button + status */}
        <div className="flex items-center gap-3 pt-1">
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-1.5 px-4 py-2 text-xs rounded-md
                       bg-red-primary text-white hover:bg-red-dark
                       disabled:opacity-50 transition-colors"
          >
            {saving ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
            保存设置
          </button>
          {message && (
            <span className={`text-xs ${message.type === 'ok' ? 'text-green-600' : 'text-red-primary'}`}>
              {message.text}
            </span>
          )}
        </div>

        {/* Info */}
        <p className="text-xs text-text-muted leading-relaxed border-t border-border-warm pt-3">
          选择"系统默认"将使用平台提供的模型。配置自己的 API Key 后，
          所有材料分析将使用你的 Key 调用，费用由你的账户承担。
          API Key 在服务端加密存储，不会明文暴露。
        </p>
      </div>
    </motion.section>
  )
}
