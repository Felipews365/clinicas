import json, urllib.request, urllib.error

API = 'https://n8n.vps7846.panel.icontainer.cloud/api/v1'
KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJkODUwY2QwZi02YmZhLTRhNmQtYWI1YS01NTUyMWNmZDY4NTQiLCJpc3MiOiJuOG4iLCJhdWQiOiJwdWJsaWMtYXBpIiwianRpIjoiMTBkMzUyM2QtZjIxMi00M2ZlLThhODQtZmI1ZGM0M2RkM2M0IiwiaWF0IjoxNzc0NDY3Nzk4fQ.nYUzjugWgXNjQkHC7T8ybDensc5zEqCH8oN98wNMG_w'
WF_ID = 'x22UDZ4n5BuR7bUk'

headers = {'X-N8N-API-KEY': KEY, 'Content-Type': 'application/json'}

# Read new systemMessage
with open('n8n/new-system-message.txt', encoding='utf-8') as f:
    new_sm = f.read()

# Fetch workflow
req = urllib.request.Request(f'{API}/workflows/{WF_ID}', headers=headers)
with urllib.request.urlopen(req, timeout=30) as resp:
    wf = json.loads(resp.read())

print(f"Fetched workflow: {wf['name']} | nodes: {len(wf['nodes'])}")

# Find AI Agent node and update systemMessage
agent = next((n for n in wf['nodes'] if n.get('type') == '@n8n/n8n-nodes-langchain.agent'), None)
if not agent:
    print('ERROR: AI Agent node not found')
    exit(1)

old_sm = agent['parameters']['options']['systemMessage']
print('Old SM first 80 chars:', old_sm[:80])
agent['parameters']['options']['systemMessage'] = new_sm
print('New SM first 80 chars:', new_sm[:80])

# PUT workflow
payload = json.dumps({
    'name': wf['name'],
    'nodes': wf['nodes'],
    'connections': wf['connections'],
    'settings': wf.get('settings', {})
}, ensure_ascii=False).encode('utf-8')

req = urllib.request.Request(
    f'{API}/workflows/{WF_ID}',
    data=payload,
    headers=headers,
    method='PUT'
)
try:
    with urllib.request.urlopen(req, timeout=30) as resp:
        result = json.loads(resp.read())
    print('Update OK. Active:', result.get('active'))
except urllib.error.HTTPError as e:
    print('HTTP Error:', e.code, e.read().decode('utf-8', errors='replace'))
