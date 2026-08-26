import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

test('manual workflow is fixed to one exact Preview-only controlled POST', () => {
  const workflow = readFileSync('.github/workflows/sentry-preview-control.yml', 'utf8')

  assert.match(workflow, /workflow_dispatch:/)
  assert.doesNotMatch(workflow, /\binputs:/)
  assert.doesNotMatch(workflow, /\$\{\{\s*inputs\./)
  assert.match(workflow, /ACTOR_NAME.*github\.actor/)
  assert.match(workflow, /OWNER_NAME.*github\.repository_owner/)
  assert.match(workflow, /WORKFLOW_SHA.*github\.sha/)
  assert.match(workflow, /deployments: read/)
  assert.match(workflow, /deployments.*sha=\$\{WORKFLOW_SHA\}/s)
  assert.match(workflow, /deployments\/\$\{deployment_id\}\/statuses/)
  assert.match(workflow, /\.[[]0\]\.state == "success"/)
  assert.match(workflow, /\.[[]0\]\.environment == "Preview"/)
  assert.match(workflow, /map\(\.status_updated_at\) \| max/)
  assert.match(workflow, /latest_candidates.*length.*-ne 1/s)
  assert.match(
    workflow,
    /\^https:\/\/aiscentra3-1-\[a-z0-9\]\+-welvers-projects\\\.vercel\\\.app\$/,
  )
  assert.match(workflow, /\$\{PREVIEW_URL\}\/api\/internal\/sentry-test/)
  assert.match(workflow, /--request POST/)
  assert.match(workflow, /--retry 0/)
  assert.match(workflow, /http_status.*!=.*202/)
  assert.match(workflow, /keys == \["sent"\] and \.sent == true/)
  assert.doesNotMatch(workflow, /--data(?:-binary)?\b/)
  assert.doesNotMatch(workflow, /curl[^\n]*(?:aiscentra\.com|www\.aiscentra\.com)/)
  assert.equal(workflow.match(/--request POST/g)?.length, 1)
  assert.equal(workflow.match(/secrets\.CRON_SECRET/g)?.length, 1)
})
