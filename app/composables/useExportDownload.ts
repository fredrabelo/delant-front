import { useApi } from '@/composables/useApi'

/**
 * Triggers a browser download of an authenticated statistics export.
 *
 * The export endpoint requires the `Authorization` + `x-client-id` headers,
 * which a plain <a href> link cannot carry. So instead of linking directly we
 * fetch the file bytes through `useApi` (which attaches the headers) as a Blob,
 * build an object URL from it, and click a synthetic <a> to save it locally.
 * Runs on the client only (guards against SSR where `document` is absent).
 */
export type ExportFormat = 'json' | 'csv'

export function useExportDownload() {
  const api = useApi()

  async function downloadExport(runId: string, moduleKey: string, format: ExportFormat): Promise<void> {
    if (import.meta.server) {
      return
    }
    const blob = await api.get<Blob>(
      `/statistics/runs/${runId}/analyses/${moduleKey}/export`,
      { query: { format }, responseType: 'blob' },
    )
    const url = window.URL.createObjectURL(blob)
    try {
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `${moduleKey}.${format}`
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
    }
    finally {
      window.URL.revokeObjectURL(url)
    }
  }

  return { downloadExport }
}
