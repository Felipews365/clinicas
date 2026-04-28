/**
 * Publica um workflow JSON local no n8n via API (sem import manual).
 *
 * Uso:
 *   npm run n8n:publish
 *   node n8n/publish-workflow.mjs [caminho/para/workflow.json]
 *
 * Variáveis de ambiente (carrega nesta ordem; web/.env.local sobrescreve a raiz):
 *   - .env na raiz do repo
 *   - web/.env.local — útil se já guardas segredos aí para o Next
 *
 *   N8N_API_URL   — ex.: https://n8n.seudominio.com/api/v1
 *   N8N_API_KEY   — n8n → Settings → n8n API
 *   N8N_WORKFLOW_ID — opcional; default kCX2LfxJrdYWB0vk
 */
import { readFileSync, existsSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join, resolve } from 'path'
import dotenv from 'dotenv'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')
dotenv.config({ path: join(root, '.env') })
dotenv.config({ path: join(root, 'web', '.env.local'), override: true })

function apiBase() {
  const raw = (process.env.N8N_API_URL || process.env.N8N_PUBLIC_BASE_URL || '').replace(/\/+$/, '')
  if (!raw) return ''
  if (/\/api\/v1$/i.test(raw)) return raw
  return `${raw}/api/v1`
}

const base = apiBase()
const apiKey = process.env.N8N_API_KEY || ''
const workflowId = process.env.N8N_WORKFLOW_ID || 'kCX2LfxJrdYWB0vk'
const file = resolve(process.argv[2] || join(__dirname, 'workflow-kCX2-multi-agent.json'))

if (!base) {
  console.error('Defina N8N_API_URL (ex.: …/api/v1) ou N8N_PUBLIC_BASE_URL em .env ou web/.env.local')
  process.exit(1)
}
if (!apiKey) {
  console.error('Defina N8N_API_KEY em .env ou web/.env.local (n8n → Settings → API)')
  process.exit(1)
}
if (!existsSync(file)) {
  console.error('Arquivo não encontrado:', file)
  process.exit(1)
}

const raw = JSON.parse(readFileSync(file, 'utf8'))
if (raw.id && raw.id !== workflowId) {
  console.warn(`AVISO: JSON tem id "${raw.id}" mas será publicado em workflowId=${workflowId}`)
}

const body = {
  name: raw.name,
  nodes: raw.nodes,
  connections: raw.connections,
  settings: {
    executionOrder: raw.settings?.executionOrder ?? 'v1',
  },
}
if (raw.staticData != null && Object.keys(raw.staticData).length > 0) {
  body.staticData = raw.staticData
}
// pinData não é aceite no PUT da API pública (400 additional properties)

const url = `${base}/workflows/${workflowId}`
const res = await fetch(url, {
  method: 'PUT',
  headers: {
    'X-N8N-API-KEY': apiKey,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify(body),
})

const txt = await res.text()
if (!res.ok) {
  console.error(`PUT ${res.status}`, txt.slice(0, 1200))
  process.exit(1)
}

let out
try {
  out = JSON.parse(txt)
} catch {
  console.log(txt.slice(0, 500))
  process.exit(0)
}

const act = raw.active === true
if (act) {
  const ar = await fetch(`${base}/workflows/${workflowId}/activate`, {
    method: 'POST',
    headers: { 'X-N8N-API-KEY': apiKey },
  })
  if (!ar.ok) {
    const at = await ar.text()
    console.warn(`Workflow salvo, mas activate falhou ${ar.status}:`, at.slice(0, 400))
  } else {
    console.log('Workflow ativado.')
  }
}

console.log('Publicado:', out.name || raw.name, '| id:', out.id || workflowId, '| updatedAt:', out.updatedAt || '—')
