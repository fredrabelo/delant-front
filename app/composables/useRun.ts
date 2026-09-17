import { computed, ref } from 'vue'
import { useI18n } from '#imports'
import { useApi } from '@/composables/useApi'
import type { ApiError } from '@/composables/useApi'
import type { StudyRun } from '@/types/api'

/**
 * Shared run loader for the per-run screens (SPEC 8/10: Statistics,
 * Visualizations and Diffusion are separate screens that all hang off one run).
 * Centralizes run fetch + the tab list so every screen stays in sync and the
 * logic is defined once, not duplicated per page.
 */
export function useRun(runId: string) {
  const { t } = useI18n()
  const api = useApi()

  const run = ref<StudyRun | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)

  async function loadRun(): Promise<void> {
    loading.value = true
    error.value = null
    try {
      run.value = await api.get<StudyRun>(`/study-runs/${runId}`)
    }
    catch (err) {
      error.value = (err as ApiError)?.message ?? t('common.error')
    }
    finally {
      loading.value = false
    }
  }

  const isChannelDiffusion = computed(
    () => run.value?.manifestJson?.exposureMode === 'channel_diffusion',
  )

  /** The per-run navigation tabs. Diffusion only shows for channel_diffusion. */
  const tabs = computed(() => {
    const base = [
      { to: `/runs/${runId}`, label: t('runs.tabs.overview') },
      { to: `/runs/${runId}/statistics`, label: t('runs.tabs.statistics') },
      { to: `/runs/${runId}/visualizations`, label: t('runs.tabs.visualizations') },
    ]
    if (isChannelDiffusion.value) {
      base.push({ to: `/runs/${runId}/diffusion`, label: t('runs.tabs.diffusion') })
      base.push({ to: `/runs/${runId}/diffusion-compare`, label: t('runs.tabs.diffusionCompare') })
    }
    return base
  })

  return { run, loading, error, loadRun, isChannelDiffusion, tabs }
}
