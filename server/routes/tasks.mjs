// Task routes: the calendar's month view, the full-Journals scan, and the
// checkbox toggle that writes back into the markdown source.
import { getVaultDir } from '../vault.mjs'
import {
  readMonthTasks as readMonthTasksInVault,
  readAllTasks as readAllTasksInVault,
  toggleTask as toggleTaskInVault,
  validateYearMonth,
} from '../notes-fs.mjs'
import { sendJson, badRequest } from '../http/respond.mjs'
import { readJsonBody } from '../http/body.mjs'

/**
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 * @param {URL} url
 * @returns {Promise<boolean>}
 */
export async function handleTasks(req, res, url) {
  const pathname = url.pathname
  const method = req.method || 'GET'

  // GET /api/month-tasks
  if (pathname === '/api/month-tasks' && method === 'GET') {
    const vm = validateYearMonth(url.searchParams.get('year'), url.searchParams.get('month'))
    if (!vm) return badRequest(res, 'invalid year/month')
    return sendJson(res, {
      year: String(vm.y),
      month: vm.mm,
      tasks: readMonthTasksInVault(getVaultDir(), vm.y, vm.mm),
    })
  }

  // GET /api/all-tasks -- returns all tasks across every date at once (used for full calendar rendering, single request)
  if (pathname === '/api/all-tasks' && method === 'GET') {
    return sendJson(res, { tasks: readAllTasksInVault(getVaultDir()) })
  }

  // POST /api/month-tasks -- mark a task done/undone, writing back to the markdown note
  if (pathname === '/api/month-tasks' && method === 'POST') {
    let body
    try { body = await readJsonBody(req) } catch { return badRequest(res, 'invalid body') }
    const { date, text, done } = body
    if (!date || !text || typeof done !== 'boolean') return badRequest(res, 'invalid body')
    const result = toggleTaskInVault(getVaultDir(), date, text, done)
    if (!result.ok) return sendJson(res, result, 400)
    return sendJson(res, { ok: true })
  }

  return false
}
