<script setup lang="ts">
/**
 * "Checar tudo" — the companion to RunAllButton.vue: polls every run/event
 * that has a batch in flight (submitted via the provider Batches API) and
 * imports results as they land, one confirm instead of clicking "Checar
 * status / importar" on each run/event individually.
 */
import { computed, ref } from 'vue'
import { useI18n } from '#imports'
import { NuxtLink } from '#components'
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

interface CheckItem {
  kind: 'run' | 'event'
  id: string
  label: string
  status: string
  linkTo: string
  /** Set when the last poll attempt for THIS item threw (network error,
   * backend restart mid-request, timeout, ...). Cleared on the next attempt
   * regardless of outcome — this is "did the last try fail", not a sticky
   * flag. A failed item is never silently left looking the same as before
   * the click; the confirm button stays enabled (failed items still count as
   * pending) so re-clicking it is the retry, no separate action needed. */
  errorMessage?: string
}

const open = ref(false)
const loading = ref(false)
const polling = ref(false)
const error = ref<string | null>(null)
const items = ref<CheckItem[]>([])

const pendingCount = computed(() => items.value.filter(i => i.status !== 'done').length)

function isDoneRunStatus(s?: string | null) {
  return s === 'done' || s === 'error'
}

async function openDialog() {
  open.value = true
  loading.value = true
  error.value = null
  items.value = []
  try {
    const runs = await props.getRuns()
    for (const r of runs) {
      if (r.excluded) continue
      if (r.manifestJson?.exposureMode === 'channel_diffusion') {
        const evts = await api.get<StudyEvent[]>('/diffusion/events', { query: { runId: r.id } }).catch(() => [] as StudyEvent[])
        for (const ev of evts) {
          if (!ev.batchId) continue
          items.value = [...items.value, {
            kind: 'event',
            id: ev.id,
            label: `${r.name} — ${ev.title}`,
            status: ev.opinionStatus === 'done' ? 'done' : (ev.batchStatus ?? 'in_progress'),
            linkTo: `/runs/${r.id}/diffusion`,
          }]
        }
      }
      else if (r.batchId) {
        items.value = [...items.value, {
          kind: 'run',
          id: r.id,
          label: r.name,
          status: isDoneRunStatus(r.status) ? r.status! : (r.batchStatus ?? 'in_progress'),
          linkTo: `/runs/${r.id}`,
        }]
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

async function pollAll() {
  polling.value = true
  error.value = null
  // Promise.all on the per-item calls below never rejects (each one catches
  // its own error), so this outer try/catch is just for anything before
  // that (e.g. a synchronous bug) — it is not the error-handling path for a
  // single item's poll failing, which is handled per-item now.
  try {
    const updated = await Promise.all(items.value.map(async (i) => {
      try {
        if (i.kind === 'event') {
          const res = await api.post<{ state: string, done: boolean }>(`/diffusion/events/${i.id}/opinion-batch/poll`)
          return { ...i, status: res.done ? 'done' : res.state, errorMessage: undefined }
        }
        const res = await api.post<{ state: string, done: boolean }>(`/study-runs/${i.id}/batch/poll`)
        return { ...i, status: res.done ? 'done' : res.state, errorMessage: undefined }
      }
      catch (err) {
        // Previously silent (`return i`) — a run whose poll takes long
        // enough to ingest (large batches can take over a minute) could hit
        // a backend restart, a network blip, or a timeout mid-request, and
        // the dialog would show no sign anything went wrong: same status as
        // before the click, no error, nothing to act on. Now the row shows
        // exactly what failed, and it still counts as pending (see
        // pendingCount) so the same "Confirmar" click retries it — no
        // separate retry action needed, just visibility that one is needed.
        return { ...i, errorMessage: (err as ApiError)?.message ?? t('common.error') }
      }
    }))
    items.value = updated
    emit('done')
  }
  catch (err) {
    error.value = (err as ApiError)?.message ?? t('common.error')
  }
  finally {
    polling.value = false
  }
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogTrigger as-child>
      <Button variant="outline" @click="openDialog">{{ t('runs.checkAll.trigger') }}</Button>
    </DialogTrigger>
    <DialogContent class="max-h-[85vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle>{{ t('runs.checkAll.title') }}</DialogTitle>
      </DialogHeader>
      <div class="space-y-4">
        <p class="text-sm text-muted-foreground">{{ t('runs.checkAll.subtitle') }}</p>
        <p v-if="loading" class="text-sm text-muted-foreground">{{ t('common.loading') }}</p>
        <p v-if="error" class="text-sm text-destructive" role="alert">{{ error }}</p>

        <template v-if="!loading">
          <div v-if="items.length > 0" class="overflow-x-auto border">
            <table class="w-full text-sm">
              <thead>
                <tr class="border-b bg-muted/60 text-left [&>th]:px-3 [&>th]:py-2 [&>th]:text-xs [&>th]:font-semibold [&>th]:text-ink-600">
                  <th class="px-3 py-2 font-medium">{{ t('runs.runAll.item') }}</th>
                  <th class="px-3 py-2 font-medium">{{ t('runs.batch.statusLabel') }}</th>
                  <th class="px-3 py-2 font-medium text-right">{{ t('common.actions') }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="item in items" :key="`${item.kind}-${item.id}`" class="border-b last:border-b-0">
                  <td class="px-3 py-2">{{ item.label }}</td>
                  <td class="px-3 py-2">
                    <span :class="item.status === 'done' ? 'text-primary font-medium' : 'text-muted-foreground'">
                      {{ item.status }}
                    </span>
                    <p v-if="item.errorMessage" class="mt-0.5 text-xs text-destructive" role="alert">
                      {{ t('runs.checkAll.itemFailed') }}: {{ item.errorMessage }}
                    </p>
                  </td>
                  <td class="px-3 py-2 text-right">
                    <NuxtLink :to="item.linkTo" class="text-xs text-muted-foreground hover:underline">
                      {{ t('runs.open') }}
                    </NuxtLink>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <p v-else class="text-sm text-muted-foreground">{{ t('runs.checkAll.nothingPending') }}</p>

          <Button v-if="items.length > 0" :disabled="polling || pendingCount === 0" @click="pollAll">
            {{ polling ? t('common.loading') : t('runs.checkAll.confirm', { n: pendingCount }) }}
          </Button>
        </template>
      </div>
    </DialogContent>
  </Dialog>
</template>
