<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from '#imports'
import { useRoute } from '#app'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import SimpleChart from '@/components/SimpleChart.vue'
import RunTabs from '@/components/RunTabs.vue'
import PageHeader from '@/components/PageHeader.vue'
import AgentGroundingDialog from '@/components/AgentGroundingDialog.vue'
import type { AgentResponseContext } from '@/components/AgentGroundingDialog.vue'
import { useApi } from '@/composables/useApi'
import type { ApiError } from '@/composables/useApi'
import { useRun } from '@/composables/useRun'
import type {
  OpinionRow,
  OpinionsResponse,
  Stimulus,
  StudyEvent,
  StudyRun,
  VisualizationData,
} from '@/types/api'

/**
 * D0-vs-D+N opinion comparison (companion to the per-event opinions list on
 * the Diffusion screen): pick any two diffusion events — typically a source
 * event and one of its continuations — and see how sentiment/adoption intent
 * moved per agent between them. A separate screen because it cuts across
 * events (and potentially sibling runs), unlike the rest of the Diffusion
 * tab which is scoped to a single run.
 */
const { t } = useI18n()
const route = useRoute()
const api = useApi()
const runId = computed(() => String(route.params.id))
const { run, loading, error, isChannelDiffusion, tabs, loadRun } = useRun(runId.value)

interface EventOption extends StudyEvent { runName: string }

const eventOptions = ref<EventOption[]>([])
const eventAId = ref('')
const eventBId = ref('')
const opinionsA = ref<OpinionsResponse | null>(null)
const opinionsB = ref<OpinionsResponse | null>(null)
const loadingCompare = ref(false)
const cError = ref<string | null>(null)

// Needed to reconstruct "what was actually asked" (AgentGroundingDialog)
// for an event that may belong to a sibling run: the event's own stimulus
// text and its own run's grounding compiler key, not this page's run.
const stimuli = ref<Stimulus[]>([])
const runsById = ref<Record<string, StudyRun>>({})

function eventStimulusText(ev: EventOption): string {
  const stimulus = stimuli.value.find(s => s.id === ev.stimulusId)
  return [ev.title, ev.description, stimulus?.title, stimulus?.body].filter(Boolean).join('\n\n')
}

function compilerKeyFor(ev: EventOption): string {
  const raw = runsById.value[ev.runId]?.manifestJson?.groundingCompilerKey || 'evidence_grounded_v1'
  return /_v\d+$/.test(raw) ? raw : `${raw}_v1`
}

// Continuation events carry continuesFromEventId (SPEC 14 timeline): surface
// the source event's run right in the option label so it's obvious which pair
// is "the same diffusion, checked again later" — without this, two events
// from different runs look interchangeable and it's easy to compare an event
// against itself or against an unrelated one.
function eventLabel(e: EventOption): string {
  const base = `${e.runName} — ${e.title}`
  if (!e.continuesFromEventId) return base
  const source = eventOptions.value.find(o => o.id === e.continuesFromEventId)
  return source ? `${base}  ·  ${t('diffusionCompare.continuesFrom', { label: source.runName })}` : base
}

const sameEventSelected = computed(
  () => !!eventAId.value && !!eventBId.value && eventAId.value === eventBId.value,
)

async function loadEventOptions() {
  if (!run.value) return
  cError.value = null
  try {
    const [ownEvents, siblingRuns, stims] = await Promise.all([
      api.get<StudyEvent[]>('/diffusion/events', { query: { runId: runId.value } }),
      api.get<StudyRun[]>('/study-runs', { query: { studyId: run.value.studyId } }),
      api.get<Stimulus[]>('/stimuli', { query: { studyId: run.value.studyId } }),
    ])
    const ownLabeled = (ownEvents ?? []).map(e => ({ ...e, runName: run.value!.name }))
    const others = (siblingRuns ?? []).filter(r => String(r.id) !== runId.value)
    const perRun = await Promise.all(
      others.map(r => api.get<StudyEvent[]>('/diffusion/events', { query: { runId: r.id } })
        .then(evts => (evts ?? []).map(e => ({ ...e, runName: r.name })))
        .catch(() => [])),
    )
    eventOptions.value = [...ownLabeled, ...perRun.flat()]
    runsById.value = Object.fromEntries([run.value, ...(siblingRuns ?? [])].map(r => [r.id, r]))
    stimuli.value = stims ?? []
  }
  catch (err) {
    cError.value = (err as ApiError)?.message ?? t('common.error')
  }
}

async function loadComparison() {
  if (!eventAId.value || !eventBId.value || sameEventSelected.value) {
    opinionsA.value = null
    opinionsB.value = null
    return
  }
  loadingCompare.value = true
  cError.value = null
  try {
    const [a, b] = await Promise.all([
      api.get<OpinionsResponse>(`/diffusion/events/${eventAId.value}/opinions`, { query: { limit: 5000 } }),
      api.get<OpinionsResponse>(`/diffusion/events/${eventBId.value}/opinions`, { query: { limit: 5000 } }),
    ])
    opinionsA.value = a
    opinionsB.value = b
  }
  catch (err) {
    cError.value = (err as ApiError)?.message ?? t('common.error')
  }
  finally {
    loadingCompare.value = false
  }
}

watch([eventAId, eventBId], loadComparison)

// Picking a continuation as B and leaving A empty almost always means "compare
// it against what it continues from" — pre-fill A with that source event so
// the common D0-vs-D+N comparison doesn't require hunting for the right pair.
watch(eventBId, (id) => {
  if (eventAId.value) return
  const sourceId = eventOptions.value.find(e => e.id === id)?.continuesFromEventId
  if (sourceId) eventAId.value = sourceId
})

interface CompareRow {
  agentId: string
  agentName: string
  a: OpinionRow | null
  b: OpinionRow | null
}

const compareRows = computed<CompareRow[]>(() => {
  if (!opinionsA.value || !opinionsB.value) return []
  const byIdA = new Map(opinionsA.value.opinions.map(o => [o.agentId, o]))
  const byIdB = new Map(opinionsB.value.opinions.map(o => [o.agentId, o]))
  const ids = [...new Set([...byIdA.keys(), ...byIdB.keys()])]
  return ids.map((id) => {
    const a = byIdA.get(id) ?? null
    const b = byIdB.get(id) ?? null
    return {
      agentId: id,
      agentName: (a ?? b)?.agentName ?? t('diffusion.opinions.agentFallback', { id }),
      a,
      b,
    }
  })
})

const commonRows = computed(() => compareRows.value.filter(r => r.a && r.b))
// A well-formed continuation carries every one of A's agents into B, then
// exposes more on top — so onlyInA should normally be empty; a non-zero count
// flags something off (a stale/re-diffused source, a failed LLM call) rather
// than being an expected outcome like onlyInB (new reach since A) is.
const onlyInANotB = computed(() => compareRows.value.filter(r => r.a && !r.b).length)
const onlyInBNotA = computed(() => compareRows.value.filter(r => !r.a && r.b).length)

// "Which profile said this, in A and in B?" (AgentGroundingDialog) — a compare
// row can carry up to two question/answer contexts for the same agent.
const groundingPreview = ref<{ agentId: string, agentName: string | null, compilerKey: string, responses: AgentResponseContext[] } | null>(null)
const groundingOpen = ref(false)

function opinionAnswer(op: OpinionRow): Array<{ label: string, value: string }> {
  return [
    { label: t('diffusion.opinions.columns.sentiment'), value: String(op.sentiment) },
    { label: t('diffusion.opinions.columns.adoptionIntent'), value: String(op.adoptionIntent) },
    { label: t('diffusion.opinions.columns.stance'), value: op.stance ?? '—' },
    { label: t('diffusion.opinions.columns.willShare'), value: op.willShare ? t('common.yes') : t('common.no') },
  ]
}

function openAgentDialog(row: CompareRow) {
  const eventA = eventOptions.value.find(e => e.id === eventAId.value)
  const eventB = eventOptions.value.find(e => e.id === eventBId.value)
  const responses: AgentResponseContext[] = []
  if (row.a && eventA) {
    responses.push({ label: `A · ${eventLabel(eventA)}`, stimulusText: eventStimulusText(eventA), answer: opinionAnswer(row.a) })
  }
  if (row.b && eventB) {
    responses.push({ label: `B · ${eventLabel(eventB)}`, stimulusText: eventStimulusText(eventB), answer: opinionAnswer(row.b) })
  }
  groundingPreview.value = {
    agentId: row.agentId,
    agentName: (row.a ?? row.b)?.agentName ?? null,
    compilerKey: compilerKeyFor(eventA ?? eventB!),
    responses,
  }
  groundingOpen.value = true
}

function avg(values: number[]): number {
  return values.length ? values.reduce((s, v) => s + v, 0) / values.length : 0
}

const avgSentimentA = computed(() => avg((opinionsA.value?.opinions ?? []).map(o => o.sentiment)))
const avgSentimentB = computed(() => avg((opinionsB.value?.opinions ?? []).map(o => o.sentiment)))
const avgAdoptionA = computed(() => avg((opinionsA.value?.opinions ?? []).map(o => o.adoptionIntent)))
const avgAdoptionB = computed(() => avg((opinionsB.value?.opinions ?? []).map(o => o.adoptionIntent)))

const summaryChart = computed<VisualizationData>(() => ({
  chartType: 'bar',
  title: t('diffusionCompare.summary.chartLabel'),
  labels: [t('diffusion.opinions.columns.sentiment'), t('diffusion.opinions.columns.adoptionIntent')],
  series: [
    { name: 'A', values: [avgSentimentA.value, avgAdoptionA.value] },
    { name: 'B', values: [avgSentimentB.value, avgAdoptionB.value] },
  ],
}))

onMounted(async () => {
  await loadRun()
  await loadEventOptions()
})
</script>

<template>
  <div class="space-y-6">
    <p v-if="error" class="text-sm text-destructive" role="alert">{{ error }}</p>
    <p v-if="loading" class="text-sm text-muted-foreground">{{ t('common.loading') }}</p>

    <template v-if="run">
      <PageHeader
        :title="t('diffusionCompare.title')"
        :description="t('diffusionCompare.subtitle')"
        :back-to="`/runs/${runId}/diffusion`"
        :back-label="t('diffusionCompare.backLabel')"
      />
      <RunTabs :tabs="tabs" />

      <p v-if="!isChannelDiffusion" class="text-sm text-muted-foreground">
        {{ t('diffusion.notChannelRun') }}
      </p>

      <template v-else>
        <p v-if="cError" class="text-sm text-destructive" role="alert">{{ cError }}</p>

        <Card class="max-w-3xl">
          <CardContent class="grid gap-4 pt-6 sm:grid-cols-2">
            <div class="space-y-1">
              <label class="text-sm font-medium" for="ev-a">{{ t('diffusionCompare.eventA') }}</label>
              <select id="ev-a" v-model="eventAId" class="field-select">
                <option value="">{{ t('diffusionCompare.selectEvent') }}</option>
                <option v-for="e in eventOptions" :key="e.id" :value="e.id">{{ eventLabel(e) }}</option>
              </select>
            </div>
            <div class="space-y-1">
              <label class="text-sm font-medium" for="ev-b">{{ t('diffusionCompare.eventB') }}</label>
              <select id="ev-b" v-model="eventBId" class="field-select">
                <option value="">{{ t('diffusionCompare.selectEvent') }}</option>
                <option v-for="e in eventOptions" :key="e.id" :value="e.id">{{ eventLabel(e) }}</option>
              </select>
            </div>
          </CardContent>
        </Card>

        <p v-if="sameEventSelected" class="text-sm text-destructive" role="alert">{{ t('diffusionCompare.sameEvent') }}</p>
        <p v-else-if="loadingCompare" class="text-sm text-muted-foreground">{{ t('diffusionCompare.loadingOpinions') }}</p>
        <p v-else-if="!eventAId || !eventBId" class="text-sm text-muted-foreground">{{ t('diffusionCompare.pickBoth') }}</p>

        <template v-else-if="opinionsA && opinionsB">
          <Card>
            <CardHeader>
              <CardTitle class="text-lg">{{ t('diffusionCompare.summary.title') }}</CardTitle>
            </CardHeader>
            <CardContent class="space-y-4">
              <!-- Opinions only exist for agents the diffusion actually exposed — a -->
              <!-- fraction of the population, not everyone — so "common agents" is -->
              <!-- the overlap between two (typically smaller, unequal) subsets, not -->
              <!-- out of the full population. Showing each side's total up front -->
              <!-- makes that overlap legible instead of looking like a bug. -->
              <div class="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
                <div class="space-y-0.5">
                  <p class="text-xs text-muted-foreground">{{ t('diffusionCompare.summary.totalA') }}</p>
                  <p class="text-lg font-medium tabular-nums">{{ opinionsA.opinions.length }}</p>
                </div>
                <div class="space-y-0.5">
                  <p class="text-xs text-muted-foreground">{{ t('diffusionCompare.summary.totalB') }}</p>
                  <p class="text-lg font-medium tabular-nums">{{ opinionsB.opinions.length }}</p>
                </div>
                <div class="space-y-0.5">
                  <p class="text-xs text-muted-foreground">{{ t('diffusionCompare.summary.commonAgents') }}</p>
                  <p class="text-lg font-medium tabular-nums">{{ commonRows.length }}</p>
                </div>
                <div class="space-y-0.5">
                  <p class="text-xs text-muted-foreground">{{ t('diffusionCompare.summary.newInB') }}</p>
                  <p class="text-lg font-medium tabular-nums">{{ onlyInBNotA }}</p>
                </div>
                <div class="space-y-0.5">
                  <p class="text-xs text-muted-foreground">{{ t('diffusionCompare.summary.missingFromB') }}</p>
                  <p class="text-lg font-medium tabular-nums" :class="onlyInANotB > 0 ? 'text-destructive' : ''">{{ onlyInANotB }}</p>
                </div>
              </div>
              <p class="text-xs text-muted-foreground">{{ t('diffusionCompare.summary.commonAgentsHint') }}</p>
              <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <div class="space-y-0.5">
                  <p class="text-xs text-muted-foreground">{{ t('diffusionCompare.summary.avgSentimentA') }}</p>
                  <p class="text-lg font-medium tabular-nums">{{ avgSentimentA.toFixed(1) }}</p>
                </div>
                <div class="space-y-0.5">
                  <p class="text-xs text-muted-foreground">{{ t('diffusionCompare.summary.avgSentimentB') }}</p>
                  <p class="text-lg font-medium tabular-nums">{{ avgSentimentB.toFixed(1) }}</p>
                </div>
                <div class="space-y-0.5">
                  <p class="text-xs text-muted-foreground">{{ t('diffusionCompare.summary.avgAdoptionA') }}</p>
                  <p class="text-lg font-medium tabular-nums">{{ avgAdoptionA.toFixed(1) }}</p>
                </div>
                <div class="space-y-0.5">
                  <p class="text-xs text-muted-foreground">{{ t('diffusionCompare.summary.avgAdoptionB') }}</p>
                  <p class="text-lg font-medium tabular-nums">{{ avgAdoptionB.toFixed(1) }}</p>
                </div>
              </div>
              <SimpleChart :data="summaryChart" />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle class="text-lg">{{ t('diffusionCompare.table.title') }}</CardTitle>
            </CardHeader>
            <CardContent class="p-0">
              <p v-if="compareRows.length === 0" class="p-4 text-sm text-muted-foreground">
                {{ t('diffusionCompare.noOverlap') }}
              </p>
              <div v-else class="max-h-[32rem] overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{{ t('diffusionCompare.table.agent') }}</TableHead>
                      <TableHead class="text-right">{{ t('diffusionCompare.table.sentimentA') }}</TableHead>
                      <TableHead class="text-right">{{ t('diffusionCompare.table.sentimentB') }}</TableHead>
                      <TableHead class="text-right">{{ t('diffusionCompare.table.sentimentDelta') }}</TableHead>
                      <TableHead class="text-right">{{ t('diffusionCompare.table.adoptionA') }}</TableHead>
                      <TableHead class="text-right">{{ t('diffusionCompare.table.adoptionB') }}</TableHead>
                      <TableHead class="text-right">{{ t('diffusionCompare.table.adoptionDelta') }}</TableHead>
                      <TableHead>{{ t('diffusionCompare.table.stanceB') }}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    <TableRow v-for="row in compareRows" :key="row.agentId">
                      <TableCell>
                        <button type="button" class="text-left underline-offset-2 hover:underline" @click="openAgentDialog(row)">
                          {{ row.agentName }}
                        </button>
                      </TableCell>
                      <TableCell class="text-right tabular-nums">
                        {{ row.a ? row.a.sentiment : t('diffusionCompare.table.onlyIn', { label: 'B' }) }}
                      </TableCell>
                      <TableCell class="text-right tabular-nums">
                        {{ row.b ? row.b.sentiment : t('diffusionCompare.table.onlyIn', { label: 'A' }) }}
                      </TableCell>
                      <TableCell class="text-right tabular-nums">
                        {{ row.a && row.b ? row.b.sentiment - row.a.sentiment : '—' }}
                      </TableCell>
                      <TableCell class="text-right tabular-nums">{{ row.a ? row.a.adoptionIntent : '—' }}</TableCell>
                      <TableCell class="text-right tabular-nums">{{ row.b ? row.b.adoptionIntent : '—' }}</TableCell>
                      <TableCell class="text-right tabular-nums">
                        {{ row.a && row.b ? row.b.adoptionIntent - row.a.adoptionIntent : '—' }}
                      </TableCell>
                      <TableCell class="max-w-xs truncate" :title="row.b?.stance ?? ''">{{ row.b?.stance ?? '—' }}</TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </template>
      </template>
    </template>

    <AgentGroundingDialog
      v-model:open="groundingOpen"
      :agent-id="groundingPreview?.agentId ?? null"
      :agent-name="groundingPreview?.agentName ?? null"
      :compiler-key="groundingPreview?.compilerKey ?? 'evidence_grounded_v1'"
      :responses="groundingPreview?.responses ?? []"
    />
  </div>
</template>
