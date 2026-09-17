<script setup lang="ts">
/**
 * "Executar tudo" (SPEC 9/14): one confirm, cost shown first, batch by
 * default. Groups every runnable run passed in via `getRuns` — for a study
 * page that's the study's own runs, for the research page it's every run
 * across every study. Mixed exposure modes are handled per-run (each run's
 * frozen manifest carries its own `exposureMode`): a direct_assignment run
 * becomes an "execute" item, a channel_diffusion run's not-yet-generated
 * events each become an "generate opinions" item.
 *
 * "Lote" here always means grouping several RUNS (or diffusion events)
 * together into one confirm — never a single run's calls bundled into the
 * provider's own Batches API (that choice lives per-run/per-event instead,
 * via the mode picker on the run/diffusion pages).
 */
import { computed, ref } from 'vue'
import { useI18n } from '#imports'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { useApi } from '@/composables/useApi'
import type { ApiError } from '@/composables/useApi'
import type { StudyEvent, StudyRun } from '@/types/api'

const props = defineProps<{
  getRuns: () => Promise<StudyRun[]>
}>()
const emit = defineEmits<{ (e: 'done'): void }>()

const { t } = useI18n()
const api = useApi()

interface RunAllItem {
  kind: 'run' | 'event'
  id: string
  label: string
  estCostUsd: number
  batchEstCostUsd: number
}

const open = ref(false)
const loading = ref(false)
const executing = ref(false)
const error = ref<string | null>(null)
const items = ref<RunAllItem[]>([])
const skipped = ref<string[]>([])
const done = ref(false)
const useSync = ref(false)

const totalSync = computed(() => items.value.reduce((s, i) => s + i.estCostUsd, 0))
const totalBatch = computed(() => items.value.reduce((s, i) => s + i.batchEstCostUsd, 0))

async function openDialog() {
  open.value = true
  loading.value = true
  error.value = null
  items.value = []
  skipped.value = []
  done.value = false
  try {
    const runs = await props.getRuns()
    const runnable = runs.filter(r => !r.excluded && (r.status === 'frozen' || r.status === 'error'))
    for (const r of runnable) {
      if (r.manifestJson?.exposureMode === 'channel_diffusion') {
        interface OpinionCost { exposures: number, estCostUsd: number, batchEstCostUsd: number }
        const evts = await api.get<StudyEvent[]>('/diffusion/events', { query: { runId: r.id } }).catch(() => [] as StudyEvent[])
        for (const ev of evts) {
          if (ev.opinionStatus === 'running' || ev.opinionStatus === 'done') continue
          try {
            const cost = await api.get<OpinionCost>(`/diffusion/events/${ev.id}/opinion-cost-estimate`)
            if (cost.exposures === 0) {
              skipped.value = [...skipped.value, t('runs.runAll.skippedNoExposure', { title: `${r.name} — ${ev.title}` })]
              continue
            }
            items.value = [...items.value, {
              kind: 'event',
              id: ev.id,
              label: `${r.name} — ${ev.title}`,
              estCostUsd: cost.estCostUsd,
              batchEstCostUsd: cost.batchEstCostUsd,
            }]
          }
          catch (err) {
            skipped.value = [...skipped.value, `${r.name} — ${ev.title}: ${(err as ApiError)?.message ?? t('common.error')}`]
          }
        }
      }
      else {
        interface RunCost { estCostUsd: number, batchEstCostUsd: number }
        try {
          const cost = await api.get<RunCost>(`/study-runs/${r.id}/cost-estimate`)
          items.value = [...items.value, {
            kind: 'run',
            id: r.id,
            label: r.name,
            estCostUsd: cost.estCostUsd,
            batchEstCostUsd: cost.batchEstCostUsd,
          }]
        }
        catch (err) {
          skipped.value = [...skipped.value, `${r.name}: ${(err as ApiError)?.message ?? t('common.error')}`]
        }
      }
    }
  }
  catch (err) {
    error.value = (err as ApiError)?.message ?? t('common.error')
  }
  finally {
    loading.value = false
  }
}

async function confirm() {
  executing.value = true
  error.value = null
  try {
    await Promise.all(items.value.map((i) => {
      if (i.kind === 'event') {
        const path = useSync.value ? 'generate-opinions' : 'opinion-batch'
        return api.post(`/diffusion/events/${i.id}/${path}`)
      }
      const path = useSync.value ? 'execute' : 'batch'
      return api.post(`/study-runs/${i.id}/${path}`)
    }))
    done.value = true
    emit('done')
  }
  catch (err) {
    error.value = (err as ApiError)?.message ?? t('common.error')
  }
  finally {
    executing.value = false
  }
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogTrigger as-child>
      <Button variant="outline" @click="openDialog">{{ t('runs.runAll.trigger') }}</Button>
    </DialogTrigger>
    <DialogContent class="max-h-[85vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle>{{ t('runs.runAll.title') }}</DialogTitle>
      </DialogHeader>
      <div class="space-y-4">
        <p class="text-sm text-muted-foreground">{{ t('runs.runAll.subtitle') }}</p>
        <p v-if="loading" class="text-sm text-muted-foreground">{{ t('common.loading') }}</p>
        <p v-if="error" class="text-sm text-destructive" role="alert">{{ error }}</p>

        <template v-if="!loading">
          <div v-if="items.length > 0" class="space-y-2">
            <div class="overflow-x-auto border">
              <table class="w-full text-sm">
                <thead>
                  <tr class="border-b bg-muted/60 text-left [&>th]:px-3 [&>th]:py-2 [&>th]:text-xs [&>th]:font-semibold [&>th]:text-ink-600">
                    <th class="px-3 py-2 font-medium">{{ t('runs.runAll.item') }}</th>
                    <th class="px-3 py-2 font-medium">{{ t('runs.cost.estSync') }}</th>
                    <th class="px-3 py-2 font-medium">{{ t('runs.cost.estBatch') }}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="item in items" :key="`${item.kind}-${item.id}`" class="border-b last:border-b-0">
                    <td class="px-3 py-2">{{ item.label }}</td>
                    <td class="px-3 py-2 tabular-nums">${{ item.estCostUsd.toFixed(4) }}</td>
                    <td class="px-3 py-2 tabular-nums">${{ item.batchEstCostUsd.toFixed(4) }}</td>
                  </tr>
                </tbody>
                <tfoot>
                  <tr class="border-t font-medium">
                    <td class="px-3 py-2">{{ t('runs.runAll.total') }}</td>
                    <td class="px-3 py-2 tabular-nums">${{ totalSync.toFixed(4) }}</td>
                    <td class="px-3 py-2 tabular-nums">${{ totalBatch.toFixed(4) }}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
          <p v-else class="text-sm text-muted-foreground">{{ t('runs.runAll.nothingToRun') }}</p>

          <p v-if="skipped.length > 0" class="text-xs text-muted-foreground">
            {{ t('runs.runAll.skipped') }}: {{ skipped.join('; ') }}
          </p>

          <p v-if="done" class="text-sm text-primary">
            {{ useSync ? t('runs.runAll.started') : t('runs.runAll.startedBatch') }}
          </p>

          <template v-if="!done">
            <label class="flex items-center gap-2 text-xs text-muted-foreground">
              <input v-model="useSync" type="checkbox">
              {{ t('runs.runAll.useSync') }}
            </label>
            <Button :disabled="items.length === 0 || executing" @click="confirm">
              {{ executing ? t('common.loading') : t('runs.runAll.confirm', { n: items.length }) }}
            </Button>
          </template>
        </template>
      </div>
    </DialogContent>
  </Dialog>
</template>
