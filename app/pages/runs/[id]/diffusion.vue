<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from '#imports'
import { useRoute } from '#app'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import SimpleChart from '@/components/SimpleChart.vue'
import RunTabs from '@/components/RunTabs.vue'
import PageHeader from '@/components/PageHeader.vue'
import AgentGroundingDialog from '@/components/AgentGroundingDialog.vue'
import type { AgentResponseContext } from '@/components/AgentGroundingDialog.vue'
import { useApi } from '@/composables/useApi'
import type { ApiError } from '@/composables/useApi'
import { useRun } from '@/composables/useRun'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import type {
  Channel,
  DiffuseResult,
  EventSummary,
  OpinionRow,
  OpinionsResponse,
  Stimulus,
  StudyEvent,
  StudyRun,
  VisualizationData,
} from '@/types/api'

const { t, locale } = useI18n()
const route = useRoute()
const api = useApi()
const runId = computed(() => String(route.params.id))
const { run, loading, error, isChannelDiffusion, tabs, loadRun } = useRun(runId.value)

interface OpinionCost {
  exposures: number
  model: string
  estCostUsd: number
  batchEstCostUsd: number
}
interface OpinionStatus {
  status: string
  progress: number
  error: string | null
  opinions: number
}

const stimuli = ref<Stimulus[]>([])
const channels = ref<Channel[]>([])
const events = ref<StudyEvent[]>([])
const loadedData = ref(false)
const dError = ref<string | null>(null)
const creating = ref(false)

const form = ref({
  title: '',
  description: '',
  stimulusId: '',
  channelId: '',
  initialReach: 0.1,
  diffusionRate: 0.15,
  continuesFromEventId: '',
})

// Events from OTHER runs in the same study (SPEC 14 diffusion timeline): the
// continuation-mode source picker. Sibling runs + their events, excluding
// this run's own (continuing from the same run doesn't map to "checked again
// later").
interface PriorEvent extends StudyEvent { runName: string }
const priorEvents = ref<PriorEvent[]>([])

async function loadPriorEvents() {
  if (!run.value) return
  try {
    const siblingRuns = await api.get<StudyRun[]>('/study-runs', { query: { studyId: run.value.studyId } }) ?? []
    const others = siblingRuns.filter(r => String(r.id) !== runId.value)
    const perRun = await Promise.all(
      others.map(r => api.get<StudyEvent[]>('/diffusion/events', { query: { runId: r.id } })
        .then(evts => (evts ?? []).map(e => ({ ...e, runName: r.name })))
        .catch(() => [])),
    )
    priorEvents.value = perRun.flat()
  }
  catch {
    priorEvents.value = []
  }
}

const diffuseSteps = ref<Record<string, number>>({})
const diffusing = ref<string | null>(null)
const diffuseResults = ref<Record<string, DiffuseResult>>({})
const summaries = ref<Record<string, EventSummary>>({})

// Opinion-generation state per event (the P0 LLM step). Mode picker: batch
// (SPEC 8, provider Batches API, the platform default) or sync (advanced).
const opinionCost = ref<Record<string, OpinionCost>>({})
const opinionStatus = ref<Record<string, OpinionStatus>>({})
const opinionBusy = ref<string | null>(null)
const opinionMode = ref<Record<string, 'batch' | 'sync'>>({})

// Reading generated opinions (bug fix: opinion-status only ever reported a
// count, with no way to see what agents actually said). Loaded on demand per
// event and toggled open/closed rather than fetched eagerly for every event.
const opinionsList = ref<Record<string, OpinionsResponse>>({})
const opinionsOpen = ref<Record<string, boolean>>({})
const opinionsLoading = ref<string | null>(null)

// "Which profile said this?" (AgentGroundingDialog): re-derives the compiled
// persona + stimulus behind one opinion via GET /agents/:id/grounding —
// nothing is stored per-opinion, it's recomputed the same way the LLM call
// itself built the prompt (see OpinionGenerationService.stimulusText()/
// normalizeCompilerKey(), mirrored here).
const groundingPreview = ref<{ agentId: string, agentName: string | null, responses: AgentResponseContext[] } | null>(null)
const groundingOpen = ref(false)

const compilerKey = computed(() => {
  const raw = run.value?.manifestJson?.groundingCompilerKey || 'evidence_grounded_v1'
  return /_v\d+$/.test(raw) ? raw : `${raw}_v1`
})

function eventStimulusText(ev: StudyEvent): string {
  const stimulus = stimuli.value.find(s => s.id === ev.stimulusId)
  return [ev.title, ev.description, stimulus?.title, stimulus?.body].filter(Boolean).join('\n\n')
}

function openGroundingPreview(ev: StudyEvent, op: OpinionRow) {
  groundingPreview.value = {
    agentId: op.agentId,
    agentName: op.agentName,
    responses: [{
      label: ev.title,
      stimulusText: eventStimulusText(ev),
      answer: [
        { label: t('diffusion.opinions.columns.sentiment'), value: String(op.sentiment) },
        { label: t('diffusion.opinions.columns.adoptionIntent'), value: String(op.adoptionIntent) },
        { label: t('diffusion.opinions.columns.stance'), value: op.stance ?? '—' },
        { label: t('diffusion.opinions.columns.willShare'), value: op.willShare ? t('common.yes') : t('common.no') },
      ],
    }],
  }
  groundingOpen.value = true
}

const canCreate = computed(
  () => form.value.title.trim() !== '' && form.value.stimulusId !== '',
)

function channelLabel(channel: Channel): string {
  return channel.label ?? channel.channelKey ?? '—'
}

// Surface the channel's calibrated defaults into the visible fields on pick,
// so the researcher sees (and can still override) exactly what will be used
// — rather than relying on the backend's silent fallback.
function onChannelChange() {
  const channel = channels.value.find(c => c.id === form.value.channelId)
  if (channel?.defaultReach != null) form.value.initialReach = channel.defaultReach
  if (channel?.defaultDiffusionRate != null) form.value.diffusionRate = channel.defaultDiffusionRate
}

function stepChartData(result: DiffuseResult): VisualizationData {
  return {
    chartType: 'bar',
    title: t('diffusion.chartLabel'),
    labels: result.perStepExposed.map((_, i) => String(i)),
    series: [{ name: t('diffusion.exposed'), values: result.perStepExposed }],
  }
}

async function loadData() {
  if (!run.value || !isChannelDiffusion.value) {
    return
  }
  dError.value = null
  try {
    const [stim, chans, evts] = await Promise.all([
      api.get<Stimulus[]>('/stimuli', { query: { studyId: run.value.studyId } }),
      api.get<Channel[]>('/channels', { query: { locale: locale.value } }),
      api.get<StudyEvent[]>('/diffusion/events', { query: { runId: runId.value } }),
    ])
    stimuli.value = stim ?? []
    channels.value = chans ?? []
    events.value = evts ?? []
    for (const ev of events.value) {
      opinionMode.value[ev.id] ??= 'batch'
    }
    loadedData.value = true
    await loadPriorEvents()
  }
  catch (err) {
    dError.value = (err as ApiError)?.message ?? t('common.error')
  }
}

async function onCreateEvent() {
  creating.value = true
  dError.value = null
  try {
    const created = await api.post<StudyEvent>('/diffusion/events', {
      runId: runId.value,
      stimulusId: form.value.stimulusId,
      channelId: form.value.channelId || undefined,
      title: form.value.title.trim(),
      description: form.value.description.trim() || undefined,
      initialReach: form.value.initialReach,
      diffusionRate: form.value.diffusionRate,
      continuesFromEventId: form.value.continuesFromEventId || undefined,
    })
    events.value = [created, ...events.value]
    opinionMode.value[created.id] ??= 'batch'
    form.value = {
      title: '',
      description: '',
      stimulusId: '',
      channelId: '',
      initialReach: 0.1,
      diffusionRate: 0.15,
      continuesFromEventId: '',
    }
  }
  catch (err) {
    dError.value = (err as ApiError)?.message ?? t('common.error')
  }
  finally {
    creating.value = false
  }
}

async function onDiffuse(eventId: string) {
  diffusing.value = eventId
  dError.value = null
  try {
    const stepsRaw = diffuseSteps.value[eventId]
    const steps = stepsRaw && stepsRaw > 0 ? stepsRaw : 5
    const result = await api.post<DiffuseResult>(
      `/diffusion/events/${eventId}/diffuse`,
      { steps },
    )
    diffuseResults.value = { ...diffuseResults.value, [eventId]: result }
    summaries.value = {
      ...summaries.value,
      [eventId]: await api.get<EventSummary>(`/diffusion/events/${eventId}/summary`),
    }
  }
  catch (err) {
    dError.value = (err as ApiError)?.message ?? t('common.error')
  }
  finally {
    diffusing.value = null
  }
}

/* -------------------- opinion generation (P0 LLM step) -------------------- */
async function onEstimateOpinions(eventId: string) {
  opinionBusy.value = eventId
  dError.value = null
  try {
    opinionCost.value = {
      ...opinionCost.value,
      [eventId]: await api.get<OpinionCost>(
        `/diffusion/events/${eventId}/opinion-cost-estimate`,
      ),
    }
  }
  catch (err) {
    dError.value = (err as ApiError)?.message ?? t('common.error')
  }
  finally {
    opinionBusy.value = null
  }
}

async function onGenerateChosen(eventId: string) {
  if (opinionMode.value[eventId] === 'sync') await onGenerateOpinions(eventId)
  else await onSubmitOpinionBatch(eventId)
}

async function onGenerateOpinions(eventId: string) {
  opinionBusy.value = eventId
  dError.value = null
  try {
    await api.post(`/diffusion/events/${eventId}/generate-opinions`)
    await pollOpinions(eventId)
  }
  catch (err) {
    dError.value = (err as ApiError)?.message ?? t('common.error')
  }
  finally {
    opinionBusy.value = null
  }
}

async function pollOpinions(eventId: string) {
  const status = await api.get<OpinionStatus>(
    `/diffusion/events/${eventId}/opinion-status`,
  )
  opinionStatus.value = { ...opinionStatus.value, [eventId]: status }
  if (status.status === 'running' || status.status === 'pending') {
    setTimeout(() => void pollOpinions(eventId), 2500)
  }
}

async function toggleOpinionsList(eventId: string) {
  const nextOpen = !opinionsOpen.value[eventId]
  opinionsOpen.value = { ...opinionsOpen.value, [eventId]: nextOpen }
  if (!nextOpen || opinionsList.value[eventId]) return
  opinionsLoading.value = eventId
  dError.value = null
  try {
    opinionsList.value = {
      ...opinionsList.value,
      [eventId]: await api.get<OpinionsResponse>(`/diffusion/events/${eventId}/opinions`, {
        query: { limit: 1000 },
      }),
    }
  }
  catch (err) {
    dError.value = (err as ApiError)?.message ?? t('common.error')
  }
  finally {
    opinionsLoading.value = null
  }
}

/* -------------------- opinion batch (SPEC 8 — platform default) -------------------- */
function updateEvent(eventId: string, patch: Partial<StudyEvent>) {
  events.value = events.value.map(e => (e.id === eventId ? { ...e, ...patch } : e))
}

function eventById(eventId: string): StudyEvent | undefined {
  return events.value.find(e => e.id === eventId)
}

async function onSubmitOpinionBatch(eventId: string) {
  opinionBusy.value = eventId
  dError.value = null
  try {
    const res = await api.post<{ batchId: string, requests: number }>(
      `/diffusion/events/${eventId}/opinion-batch`,
    )
    updateEvent(eventId, { batchId: res.batchId, batchStatus: 'in_progress', opinionStatus: 'running' })
  }
  catch (err) {
    dError.value = (err as ApiError)?.message ?? t('common.error')
  }
  finally {
    opinionBusy.value = null
  }
}

async function onPollOpinionBatch(eventId: string) {
  opinionBusy.value = eventId
  dError.value = null
  try {
    const res = await api.post<{ state: string, done: boolean }>(
      `/diffusion/events/${eventId}/opinion-batch/poll`,
    )
    updateEvent(eventId, { batchStatus: res.state, opinionStatus: res.done ? 'done' : 'running' })
    if (res.done) {
      opinionStatus.value = {
        ...opinionStatus.value,
        [eventId]: await api.get<OpinionStatus>(`/diffusion/events/${eventId}/opinion-status`),
      }
    }
  }
  catch (err) {
    dError.value = (err as ApiError)?.message ?? t('common.error')
  }
  finally {
    opinionBusy.value = null
  }
}

onMounted(async () => {
  await loadRun()
  await loadData()
})
</script>

<template>
  <div class="space-y-6">
    <p v-if="error" class="text-sm text-destructive" role="alert">{{ error }}</p>
    <p v-if="loading" class="text-sm text-muted-foreground">{{ t('common.loading') }}</p>

    <template v-if="run">
      <PageHeader
        :title="t('diffusion.title')"
        :description="t('diffusion.subtitle')"
        :back-to="`/runs/${runId}`"
        :back-label="run.name"
      />
      <RunTabs :tabs="tabs" />

      <p v-if="!isChannelDiffusion" class="text-sm text-muted-foreground">
        {{ t('diffusion.notChannelRun') }}
      </p>

      <template v-else>
        <p v-if="dError" class="text-sm text-destructive" role="alert">{{ dError }}</p>

        <!-- Create event -->
        <Card class="max-w-2xl">
          <CardHeader>
            <CardTitle class="text-lg">{{ t('diffusion.newEvent') }}</CardTitle>
          </CardHeader>
          <CardContent class="space-y-4">
          <p v-if="loadedData && stimuli.length === 0" class="text-sm text-muted-foreground">
            {{ t('diffusion.noStimuli') }}
          </p>
          <form v-else class="space-y-4" @submit.prevent="onCreateEvent">
            <div class="space-y-1">
              <label class="text-sm font-medium" for="ev-title">{{ t('diffusion.fields.title') }}</label>
              <Input id="ev-title" v-model="form.title" required />
            </div>
            <div class="space-y-1">
              <label class="text-sm font-medium" for="ev-desc">{{ t('diffusion.fields.description') }}</label>
              <Input id="ev-desc" v-model="form.description" />
            </div>
            <div class="grid gap-4 sm:grid-cols-2">
              <div class="space-y-1">
                <label class="text-sm font-medium" for="ev-stimulus">{{ t('diffusion.fields.stimulus') }}</label>
                <select
                  id="ev-stimulus"
                  v-model="form.stimulusId"
                  class="field-select"
                >
                  <option value="">{{ t('common.select') }}</option>
                  <option v-for="s in stimuli" :key="s.id" :value="s.id">{{ s.title }}</option>
                </select>
              </div>
              <div class="space-y-1">
                <label class="text-sm font-medium" for="ev-channel">{{ t('diffusion.fields.channel') }}</label>
                <select
                  id="ev-channel"
                  v-model="form.channelId"
                  class="field-select"
                  @change="onChannelChange"
                >
                  <option value="">{{ t('diffusion.channelNone') }}</option>
                  <option v-for="c in channels" :key="c.id" :value="c.id">{{ channelLabel(c) }}</option>
                </select>
                <p class="text-xs text-muted-foreground">{{ t('diffusion.fields.channelHint') }}</p>
              </div>
              <div class="space-y-1">
                <label class="text-sm font-medium" for="ev-reach">{{ t('diffusion.fields.initialReach') }}</label>
                <Input id="ev-reach" v-model.number="form.initialReach" type="number" step="0.01" min="0" max="1" />
              </div>
              <div class="space-y-1">
                <label class="text-sm font-medium" for="ev-rate">{{ t('diffusion.fields.diffusionRate') }}</label>
                <Input id="ev-rate" v-model.number="form.diffusionRate" type="number" step="0.01" min="0" max="1" />
              </div>
            </div>

            <!-- Continuation mode (SPEC 14 timeline): carry a prior event's -->
            <!-- exposure state forward instead of reseeding. Default: off. -->
            <div v-if="priorEvents.length > 0" class="space-y-1">
              <label class="text-sm font-medium" for="ev-continues">{{ t('diffusion.fields.continuesFrom') }}</label>
              <select
                id="ev-continues"
                v-model="form.continuesFromEventId"
                class="field-select"
              >
                <option value="">{{ t('diffusion.fields.continuesFromNone') }}</option>
                <option v-for="pe in priorEvents" :key="pe.id" :value="pe.id">
                  {{ pe.runName }} — {{ pe.title }}
                </option>
              </select>
              <p class="text-xs text-muted-foreground">{{ t('diffusion.fields.continuesFromHint') }}</p>
            </div>

            <Button type="submit" :disabled="creating || !canCreate">
              {{ creating ? t('common.loading') : t('common.create') }}
            </Button>
          </form>
          </CardContent>
        </Card>

        <!-- Events -->
        <div class="space-y-4">
          <h2 class="text-lg font-medium">{{ t('diffusion.events') }}</h2>
          <Card v-for="ev in events" :key="ev.id" class="p-6 space-y-4">
            <div class="flex flex-wrap items-start justify-between gap-3">
              <div class="space-y-0.5">
                <p class="font-medium">{{ ev.title }}</p>
                <p v-if="ev.description" class="text-sm text-muted-foreground">{{ ev.description }}</p>
              </div>
              <div class="flex items-end gap-2">
                <div class="space-y-1">
                  <label class="text-xs font-medium" :for="`steps-${ev.id}`">{{ t('diffusion.fields.steps') }}</label>
                  <Input :id="`steps-${ev.id}`" v-model.number="diffuseSteps[ev.id]" type="number" min="1" max="50" placeholder="5" class="w-24" />
                </div>
                <Button size="sm" :disabled="diffusing === ev.id" @click="onDiffuse(ev.id)">
                  {{ diffusing === ev.id ? t('common.loading') : t('diffusion.diffuse') }}
                </Button>
              </div>
            </div>

            <!-- Diffuse result -->
            <div v-if="diffuseResults[ev.id]" class="space-y-4">
              <div class="space-y-2">
                <div class="flex items-center justify-between text-sm">
                  <span class="text-muted-foreground">{{ t('diffusion.totalAgents') }}</span>
                  <span class="tabular-nums font-medium">{{ diffuseResults[ev.id]!.totalAgents }}</span>
                </div>
                <SimpleChart :data="stepChartData(diffuseResults[ev.id]!)" />
              </div>
              <div v-if="summaries[ev.id]" class="flex items-center justify-between text-sm">
                <span class="text-muted-foreground">{{ t('diffusion.exposed') }}</span>
                <span class="tabular-nums font-medium">{{ summaries[ev.id]!.exposed }}</span>
              </div>
            </div>

            <!-- Opinion generation (P0 LLM step). Batch (SPEC 8) is the -->
            <!-- platform default — ~50% cheaper; sync is the opt-in advanced path. -->
            <div class="space-y-2 border-t pt-4">
              <div class="flex flex-wrap items-center justify-between gap-3">
                <div class="space-y-0.5">
                  <h3 class="font-medium">{{ t('diffusion.opinions.title') }}</h3>
                  <p class="text-sm text-muted-foreground">{{ t('diffusion.opinions.subtitle') }}</p>
                </div>
                <div class="flex flex-col items-end gap-1.5">
                  <div class="flex items-center gap-2">
                    <Button variant="outline" size="sm" :disabled="opinionBusy === ev.id" @click="onEstimateOpinions(ev.id)">
                      {{ t('diffusion.opinions.estimate') }}
                    </Button>
                    <template v-if="!eventById(ev.id)?.batchId">
                      <select v-model="opinionMode[ev.id]" class="field-select h-9 text-sm">
                        <option value="batch">{{ t('runs.execution.modeBatch') }}</option>
                        <option value="sync">{{ t('runs.execution.modeSync') }}</option>
                      </select>
                      <Button
                        size="sm"
                        :disabled="opinionBusy === ev.id"
                        @click="onGenerateChosen(ev.id)"
                      >
                        {{ opinionBusy === ev.id ? t('common.loading') : t('diffusion.opinions.generate') }}
                      </Button>
                    </template>
                    <Button
                      v-else
                      size="sm"
                      :disabled="opinionBusy === ev.id"
                      @click="onPollOpinionBatch(ev.id)"
                    >
                      {{ opinionBusy === ev.id ? t('common.loading') : t('diffusion.opinions.pollBatch') }}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      :disabled="opinionsLoading === ev.id"
                      @click="toggleOpinionsList(ev.id)"
                    >
                      {{ opinionsLoading === ev.id
                        ? t('common.loading')
                        : opinionsOpen[ev.id] ? t('diffusion.opinions.hide') : t('diffusion.opinions.view') }}
                    </Button>
                  </div>
                </div>
              </div>
              <p v-if="opinionCost[ev.id]" class="text-sm text-muted-foreground">
                {{ t('diffusion.opinions.costLine', {
                  exposures: opinionCost[ev.id]!.exposures,
                  sync: `$${opinionCost[ev.id]!.estCostUsd.toFixed(4)}`,
                  batch: `$${opinionCost[ev.id]!.batchEstCostUsd.toFixed(4)}`,
                }) }}
              </p>
              <p v-if="eventById(ev.id)?.batchId" class="text-sm text-muted-foreground">
                {{ t('runs.batch.statusLabel') }}:
                <span class="font-mono text-xs">{{ eventById(ev.id)!.batchId }}</span>
                <span v-if="eventById(ev.id)?.batchStatus"> · {{ eventById(ev.id)!.batchStatus }}</span>
              </p>
              <p v-if="opinionStatus[ev.id]" class="text-sm">
                <span class="text-muted-foreground">{{ t('diffusion.opinions.statusLabel') }}:</span>
                {{ opinionStatus[ev.id]!.status }}
                <span v-if="opinionStatus[ev.id]!.status === 'running'"> · {{ opinionStatus[ev.id]!.progress }}%</span>
                <span v-if="opinionStatus[ev.id]!.opinions"> · {{ t('diffusion.opinions.count', { n: opinionStatus[ev.id]!.opinions }) }}</span>
                <span v-if="opinionStatus[ev.id]!.error" class="text-destructive"> · {{ opinionStatus[ev.id]!.error }}</span>
              </p>

              <div v-if="opinionsOpen[ev.id]" class="max-h-96 overflow-auto rounded border">
                <Table v-if="opinionsList[ev.id]?.opinions.length">
                  <TableHeader>
                    <TableRow>
                      <TableHead>{{ t('diffusion.opinions.columns.agent') }}</TableHead>
                      <TableHead class="text-right">{{ t('diffusion.opinions.columns.sentiment') }}</TableHead>
                      <TableHead class="text-right">{{ t('diffusion.opinions.columns.adoptionIntent') }}</TableHead>
                      <TableHead>{{ t('diffusion.opinions.columns.stance') }}</TableHead>
                      <TableHead>{{ t('diffusion.opinions.columns.willShare') }}</TableHead>
                      <TableHead class="text-right">{{ t('diffusion.opinions.columns.step') }}</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    <TableRow v-for="op in opinionsList[ev.id]!.opinions" :key="op.id">
                      <TableCell>{{ op.agentName ?? t('diffusion.opinions.agentFallback', { id: op.agentId }) }}</TableCell>
                      <TableCell class="text-right tabular-nums">{{ op.sentiment }}</TableCell>
                      <TableCell class="text-right tabular-nums">{{ op.adoptionIntent }}</TableCell>
                      <TableCell class="max-w-xs truncate" :title="op.stance ?? ''">{{ op.stance ?? '—' }}</TableCell>
                      <TableCell>{{ op.willShare ? t('common.yes') : t('common.no') }}</TableCell>
                      <TableCell class="text-right tabular-nums">{{ op.stepIndex }}</TableCell>
                      <TableCell>
                        <Button variant="ghost" size="sm" @click="openGroundingPreview(ev, op)">
                          {{ t('agentGrounding.viewProfile') }}
                        </Button>
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
                <p v-else class="p-4 text-sm text-muted-foreground">{{ t('diffusion.opinions.empty') }}</p>
              </div>
            </div>
          </Card>
          <p v-if="events.length === 0" class="text-sm text-muted-foreground">{{ t('diffusion.empty') }}</p>
        </div>
      </template>
    </template>

    <AgentGroundingDialog
      v-model:open="groundingOpen"
      :agent-id="groundingPreview?.agentId ?? null"
      :agent-name="groundingPreview?.agentName ?? null"
      :compiler-key="compilerKey"
      :responses="groundingPreview?.responses ?? []"
    />
  </div>
</template>
