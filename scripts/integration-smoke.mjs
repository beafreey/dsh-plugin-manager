/**
 * Integration smoke test: mount the host plugin into a real cordis Context
 * with mocked webServer/tools/systemPrompt services and assert the apply()
 * registration flow (routes, tools, prompt section, settings section wiring)
 * runs without throwing. Dev-only; not shipped.
 */

import { Context } from '@deepseek-ai/cordis'
import { apply, inject, name } from '../lib/index.js'

const registrations = { routes: [], tools: [], sections: [] }
const ctx = new Context()
ctx.provide('webServer', {
  register: (route) => {
    registrations.routes.push(route)
    return () => {}
  },
})
ctx.provide('tools', {
  register: (tool) => {
    registrations.tools.push(tool)
    return () => {}
  },
})
ctx.provide('systemPrompt', {
  section: (section) => {
    registrations.sections.push(section)
    return () => {}
  },
})

try {
  const fiber = ctx.plugin({ name, inject, apply }, { profile: 'web' })
  await fiber
  console.log('apply() mounted without throwing')
} catch (error) {
  console.error('apply() threw:', error)
  process.exitCode = 1
}

console.log('routes:', registrations.routes.map(r => `${r.kind} ${r.path}`).join(', '))
console.log('tools:', registrations.tools.map(t => t.name).join(', '))
console.log('sections:', registrations.sections.map(s => s.name).join(', '))

const expectedRoutes = 5
const expectedTools = 3
const expectedSections = 1
if (
  registrations.routes.length !== expectedRoutes
  || registrations.tools.length !== expectedTools
  || registrations.sections.length !== expectedSections
) {
  console.error(`count mismatch: routes ${registrations.routes.length}/${expectedRoutes}, tools ${registrations.tools.length}/${expectedTools}, sections ${registrations.sections.length}/${expectedSections}`)
  process.exitCode = 1
} else {
  console.log('registration counts OK')
}

// Exercise one agent tool end-to-end (read-only check against the real profile).
const checkTool = registrations.tools.find(t => t.name === 'dsh_plugin_check')
if (checkTool !== undefined) {
  const result = await checkTool.execute({ check: false })
  console.log('dsh_plugin_check execute:', JSON.stringify(result).slice(0, 300))
}
