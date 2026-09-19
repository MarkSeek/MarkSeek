export interface TaskItem {
  text: string
  done: boolean
}

/* * Load all tasks in a month's Journals, grouped by date.
 *
 * Calls the backend `GET /api/month-tasks`; the server only reads that month's directory
 * (O(files in month)), enabling lazy per-month calendar loading instead of scanning all history at once.
 */
export async function loadMonthTasks(
  year: number,
  month: number
): Promise<Record<string, TaskItem[]>> {
  try {
    const res = await fetch(
      `/api/month-tasks?year=${year}&month=${month}`
    )
    if (!res.ok) return {}
    const data = (await res.json()) as {
      tasks?: Array<{ date: string; done: boolean; text: string }>
    }
    const byDate: Record<string, TaskItem[]> = {}
    for (const t of data.tasks ?? []) {
      ;(byDate[t.date] ??= []).push({ done: t.done, text: t.text })
    }
    return byDate
  } catch {
    return {}
  }
}
