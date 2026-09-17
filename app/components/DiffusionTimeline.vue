<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from '#imports'
import { NuxtLink } from '#components'
import { Plus } from 'lucide-vue-next'
import type { StudyRun } from '@/types/api'

/**
 * Diffusion timeline (SPEC 14): plots a channel_diffusion study's runs as
 * markers on a day axis from t0, so a researcher can plan/see a baseline (D0)
 * → diffusion event → follow-up survey (D+90) sequence at a glance. Runs
 * with no offset are pinned at day 0. Drag a marker to reschedule it; click
 * an empty point on the track to create a new run there.
 *
 * Pure presentation + pointer-event math — no npm dependency, consistent with
 * the rest of the app's hand-built form controls.
 */
const props = defineProps<{ runs: StudyRun[] }>()
const emit = defineEmits<{
  (e: 'reschedule', runId: string, days: number): void
  (e: 'create-at', days: number): void
}>()

const { t } = useI18n()

const trackRef = ref<HTMLElement | null>(null)
const dragRunId = ref<string | null>(null)
const dragDays = ref<Record<string, number>>({})

function offsetOf(run: StudyRun): number {
  if (dragRunId.value === run.id && dragDays.value[run.id] !== undefined) {
    return dragDays.value[run.id]!
  }
  return run.timelineOffsetDays ?? 0
}

// Range: 0 to the furthest scheduled run, with headroom so there's always
// room to drag/create past the last point. Never collapses below ~30 days.
const maxDay = computed(() => {
  const furthest = Math.max(0, ...props.runs.map(r => offsetOf(r)))
  return Math.max(30, Math.ceil((furthest + 14) / 10) * 10)
})

function dayFromClientX(clientX: number): number {
  const el = trackRef.value
  if (!el) return 0
  const rect = el.getBoundingClientRect()
  const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
  return Math.round(ratio * maxDay.value)
}

function pctOf(days: number): string {
  return `${Math.min(100, Math.max(0, (days / maxDay.value) * 100))}%`
}

function onMarkerPointerDown(run: StudyRun, event: PointerEvent) {
  event.stopPropagation()
  dragRunId.value = run.id
  dragDays.value = { ...dragDays.value, [run.id]: offsetOf(run) };
  (event.target as HTMLElement).setPointerCapture(event.pointerId)
}

function onMarkerPointerMove(run: StudyRun, event: PointerEvent) {
  if (dragRunId.value !== run.id) return
  dragDays.value = { ...dragDays.value, [run.id]: dayFromClientX(event.clientX) }
}

function onMarkerPointerUp(run: StudyRun) {
  if (dragRunId.value !== run.id) return
  const days = dragDays.value[run.id] ?? offsetOf(run)
  dragRunId.value = null
  if (days !== (run.timelineOffsetDays ?? 0)) {
    emit('reschedule', run.id, days)
  }
}

function onTrackClick(event: MouseEvent) {
  if (dragRunId.value) return
  emit('create-at', dayFromClientX(event.clientX))
}
</script>

<template>
  <div class="space-y-2">
    <div class="flex items-center justify-between text-xs text-muted-foreground">
      <span>{{ t('diffusion.timeline.dayZero') }}</span>
      <span>{{ t('diffusion.timeline.clickHint') }}</span>
      <span>{{ t('diffusion.timeline.dayN', { n: maxDay }) }}</span>
    </div>
    <div
      ref="trackRef"
      class="relative h-16 cursor-copy border bg-muted/30"
      @click="onTrackClick"
    >
      <div class="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-border" />
      <button
        v-for="run in runs"
        :key="run.id"
        type="button"
        class="group absolute top-1/2 flex -translate-x-1/2 -translate-y-1/2 cursor-grab flex-col items-center gap-1 active:cursor-grabbing"
        :style="{ left: pctOf(offsetOf(run)) }"
        @pointerdown="onMarkerPointerDown(run, $event)"
        @pointermove="onMarkerPointerMove(run, $event)"
        @pointerup="onMarkerPointerUp(run)"
        @click.stop
      >
        <span
          class="h-3.5 w-3.5 rounded-full border-2 border-background bg-primary shadow transition-transform group-hover:scale-125"
          :aria-label="run.name"
        />
        <span class="whitespace-nowrap rounded bg-background px-1.5 py-0.5 text-[10px] font-medium shadow-sm">
          {{ t('diffusion.timeline.dayN', { n: offsetOf(run) }) }}
        </span>
      </button>
    </div>
    <ul class="flex flex-wrap gap-3 text-xs text-muted-foreground">
      <li v-for="run in runs" :key="`legend-${run.id}`">
        <NuxtLink :to="`/runs/${run.id}`" class="hover:text-foreground hover:underline">
          {{ run.name }}
        </NuxtLink>
        <span class="tabular-nums"> · D{{ offsetOf(run) >= 0 ? '+' : '' }}{{ offsetOf(run) }}</span>
      </li>
    </ul>
    <p class="flex items-center gap-1 text-xs text-muted-foreground">
      <Plus class="h-3 w-3" /> {{ t('diffusion.timeline.createHint') }}
    </p>
  </div>
</template>
