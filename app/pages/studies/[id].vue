<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from '#imports'
import { useRoute, navigateTo } from '#app'
import { NuxtLink } from '#components'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card'
import RegistrySelect from '@/components/RegistrySelect.vue'
import StatusBadge from '@/components/StatusBadge.vue'
import AiAnalysisPanel from '@/components/AiAnalysisPanel.vue'
import PageHeader from '@/components/PageHeader.vue'
import DiffusionTimeline from '@/components/DiffusionTimeline.vue'
import RunAllButton from '@/components/RunAllButton.vue'
import CheckAllButton from '@/components/CheckAllButton.vue'
import { useApi } from '@/composables/useApi'
import type { ApiError } from '@/composables/useApi'
import type {
  Instrument,
  InstrumentItemInput,
  Population,
  RegistryOption,
  Stimulus,
  Study,
  StudyEvent,
  StudyRun,
} from '@/types/api'

const { t } = useI18n()
const route = useRoute()
const api = useApi()

const studyId = computed(() => String(route.params.id))

const study = ref<Study | null>(null)
const populations = ref<Population[]>([])
const loading = ref(false)
const error = ref<string | null>(null)

/* -------------------- attach population -------------------- */
interface AttachedPopulation {
  populationId: number
  role: string
  name: string
  status: string
  size: number | null
  agentCount: number
}
const attachedPopulations = ref<AttachedPopulation[]>([])
const attaching = ref<string | null>(null)
const detaching = ref<number | null>(null)
const attachError = ref<string | null>(null)
const selectedPopulationId = ref('')

async function loadAttached() {
  attachedPopulations.value = await api.get<AttachedPopulation[]>(
    '/populations/attached',
    { query: { studyId: studyId.value } },
  ) ?? []
}

async function loadData() {
  loading.value = true
  error.value = null
  try {
    const [s, pops, stim, insts, runList] = await Promise.all([
      api.get<Study>(`/studies/${studyId.value}`),
      api.get<Population[]>('/populations'),
      api.get<Stimulus[]>('/stimuli', { query: { studyId: studyId.value } }),
      api.get<Instrument[]>('/instruments', { query: { studyId: studyId.value } }),
      api.get<StudyRun[]>('/study-runs', { query: { studyId: studyId.value } }),
    ])
    study.value = s
    populations.value = pops ?? []
    stimuli.value = stim ?? []
    instruments.value = insts ?? []
    runs.value = runList ?? []
    await loadAttached()
    if (s?.exposureMode === 'channel_diffusion') {
      await loadRunEventSummaries()
    }
  }
  catch (err) {
    error.value = (err as ApiError)?.message ?? t('common.error')
  }
  finally {
    loading.value = false
  }
}

/**
 * For channel_diffusion studies, a run's own `status` stays 'frozen' forever
 * — progress lives per diffusion EVENT (`opinionStatus`), not on the run.
 * The plain "Execuções" list showed only the run's status badge, so it
 * always read "Congelado" even once every event's opinions were done. This
 * fetches each run's events and summarizes them (e.g. "3/3 opiniões
 * prontas") so completion is visible without opening the run.
 */
interface RunEventSummary { done: number, total: number, running: number, error: number }
const runEventSummaries = ref<Record<string, RunEventSummary>>({})

async function loadRunEventSummaries() {
  const perRun = await Promise.all(
    runs.value.map(r =>
      api.get<StudyEvent[]>('/diffusion/events', { query: { runId: r.id } })
        .then(evts => [r.id, evts ?? []] as const)
        .catch(() => [r.id, [] as StudyEvent[]] as const),
    ),
  )
  const summaries: Record<string, RunEventSummary> = {}
  for (const [runId, evts] of perRun) {
    if (evts.length === 0) continue
    summaries[runId] = {
      total: evts.length,
      done: evts.filter(e => e.opinionStatus === 'done').length,
      running: evts.filter(e => e.opinionStatus === 'running').length,
      error: evts.filter(e => e.opinionStatus === 'error').length,
    }
  }
  runEventSummaries.value = summaries
}

// Populations not yet attached — the only ones worth offering in the picker.
const attachablePopulations = computed(() =>
  populations.value.filter(
    p => !attachedPopulations.value.some(a => String(a.populationId) === String(p.id)),
  ),
)

async function onAttach() {
  if (!selectedPopulationId.value) {
    return
  }
  attaching.value = selectedPopulationId.value
  attachError.value = null
  try {
    await api.post(`/populations/${selectedPopulationId.value}/attach`, { studyId: Number(studyId.value) })
    selectedPopulationId.value = ''
    await loadAttached()
  }
  catch (err) {
    attachError.value = (err as ApiError)?.message ?? t('common.error')
  }
  finally {
    attaching.value = null
  }
}

async function onDetach(populationId: number) {
  detaching.value = populationId
  attachError.value = null
  try {
    await api.delete(`/populations/${populationId}/attach/${studyId.value}`)
    await loadAttached()
  }
  catch (err) {
    attachError.value = (err as ApiError)?.message ?? t('common.error')
  }
  finally {
    detaching.value = null
  }
}

/* -------------------- stimuli -------------------- */
const stimuli = ref<Stimulus[]>([])
const stimulusDialogOpen = ref(false)
const stimulusSaving = ref(false)
const stimulusError = ref<string | null>(null)
const stimulusForm = ref({ title: '', body: '', payload: '' })

function openStimulusDialog() {
  stimulusError.value = null
  stimulusForm.value = { title: '', body: '', payload: '' }
  stimulusDialogOpen.value = true
}

async function onCreateStimulus() {
  stimulusSaving.value = true
  stimulusError.value = null
  try {
    let payload: Record<string, unknown> | undefined
    const raw = stimulusForm.value.payload.trim()
    if (raw) {
      try {
        payload = JSON.parse(raw) as Record<string, unknown>
      }
      catch {
        stimulusError.value = t('stimuli.invalidJson')
        stimulusSaving.value = false
        return
      }
    }
    const created = await api.post<Stimulus>('/stimuli', {
      studyId: Number(studyId.value),
      title: stimulusForm.value.title,
      body: stimulusForm.value.body || undefined,
      payload,
    })
    stimuli.value = [...stimuli.value, created]
    stimulusDialogOpen.value = false
  }
  catch (err) {
    stimulusError.value = (err as ApiError)?.message ?? t('common.error')
  }
  finally {
    stimulusSaving.value = false
  }
}

async function onDeleteStimulus(id: string) {
  try {
    await api.delete(`/stimuli/${id}`)
    stimuli.value = stimuli.value.filter(s => s.id !== id)
  }
  catch (err) {
    error.value = (err as ApiError)?.message ?? t('common.error')
  }
}

/* -------------------- instruments -------------------- */
const instruments = ref<Instrument[]>([])
const itemTypeOptions = ref<RegistryOption[]>([])
const instrumentDialogOpen = ref(false)
const instrumentSaving = ref(false)
const instrumentError = ref<string | null>(null)

interface DraftOption {
  key: string
  label: string
}
interface DraftItem {
  itemType: string
  itemKey: string
  promptText: string
  required: boolean
  scaleMin: number
  scaleMax: number
  options: DraftOption[]
  stimulusIds: Set<string>
}

const instrumentName = ref('')
const instrumentDescription = ref('')
const draftItems = ref<DraftItem[]>([])

function newDraftItem(): DraftItem {
  return {
    itemType: '',
    itemKey: '',
    promptText: '',
    required: false,
    scaleMin: 0,
    scaleMax: 10,
    options: [],
    stimulusIds: new Set<string>(),
  }
}

async function openInstrumentDialog() {
  instrumentError.value = null
  instrumentName.value = ''
  instrumentDescription.value = ''
  draftItems.value = [newDraftItem()]
  if (itemTypeOptions.value.length === 0) {
    try {
      itemTypeOptions.value = await api.get<RegistryOption[]>('/instruments/item-types/options') ?? []
    }
    catch (err) {
      instrumentError.value = (err as ApiError)?.message ?? t('common.error')
    }
  }
  instrumentDialogOpen.value = true
}

function addDraftItem() {
  draftItems.value = [...draftItems.value, newDraftItem()]
}

function removeDraftItem(index: number) {
  draftItems.value = draftItems.value.filter((_, i) => i !== index)
}

function addDraftOption(item: DraftItem) {
  item.options = [...item.options, { key: '', label: '' }]
}

function removeDraftOption(item: DraftItem, index: number) {
  item.options = item.options.filter((_, i) => i !== index)
}

function toggleStimulus(item: DraftItem, id: string) {
  const next = new Set(item.stimulusIds)
  if (next.has(id)) {
    next.delete(id)
  }
  else {
    next.add(id)
  }
  item.stimulusIds = next
}

function buildItemConfig(item: DraftItem): Record<string, unknown> | undefined {
  if (item.itemType === 'scale_0_10') {
    return { min: item.scaleMin, max: item.scaleMax }
  }
  if (item.itemType === 'single_choice' || item.itemType === 'multiple_choice') {
    return { options: item.options.filter(o => o.key.trim() !== '') }
  }
  if (item.itemType === 'conjoint_profile_choice') {
    return { stimulusIds: Array.from(item.stimulusIds) }
  }
  return undefined
}

async function onCreateInstrument() {
  instrumentSaving.value = true
  instrumentError.value = null
  try {
    const items: InstrumentItemInput[] = draftItems.value
      .filter(i => i.itemType && i.itemKey.trim() && i.promptText.trim())
      .map((i, idx) => ({
        itemType: i.itemType,
        itemKey: i.itemKey.trim(),
        promptText: i.promptText.trim(),
        required: i.required,
        sortOrder: idx,
        config: buildItemConfig(i),
      }))
    const created = await api.post<Instrument>('/instruments', {
      studyId: Number(studyId.value),
      name: instrumentName.value,
      description: instrumentDescription.value || undefined,
      items,
    })
    instruments.value = [...instruments.value, created]
    instrumentDialogOpen.value = false
  }
  catch (err) {
    instrumentError.value = (err as ApiError)?.message ?? t('common.error')
  }
  finally {
    instrumentSaving.value = false
  }
}

const expandedInstrumentId = ref<string | null>(null)
const instrumentItemsCache = ref<Record<string, Instrument['items']>>({})

async function toggleInstrument(inst: Instrument) {
  if (expandedInstrumentId.value === inst.id) {
    expandedInstrumentId.value = null
    return
  }
  expandedInstrumentId.value = inst.id
  if (!instrumentItemsCache.value[inst.id]) {
    try {
      const items = await api.get<Instrument['items']>(`/instruments/${inst.id}/items`)
      instrumentItemsCache.value = { ...instrumentItemsCache.value, [inst.id]: items ?? [] }
    }
    catch (err) {
      error.value = (err as ApiError)?.message ?? t('common.error')
    }
  }
}

async function onDeleteInstrument(id: string) {
  try {
    await api.delete(`/instruments/${id}`)
    instruments.value = instruments.value.filter(i => i.id !== id)
    if (expandedInstrumentId.value === id) {
      expandedInstrumentId.value = null
    }
  }
  catch (err) {
    error.value = (err as ApiError)?.message ?? t('common.error')
  }
}

async function onDeleteInstrumentItem(instrumentId: string, itemId: string) {
  try {
    await api.delete(`/instruments/${instrumentId}/items/${itemId}`)
    const items = (instrumentItemsCache.value[instrumentId] ?? []).filter(i => i.id !== itemId)
    instrumentItemsCache.value = { ...instrumentItemsCache.value, [instrumentId]: items }
  }
  catch (err) {
    error.value = (err as ApiError)?.message ?? t('common.error')
  }
}

/* -------------------- runs -------------------- */
const runs = ref<StudyRun[]>([])
const compilerOptions = ref<RegistryOption[]>([])
const providerOptions = ref<RegistryOption[]>([])
const runDialogOpen = ref(false)
const runSaving = ref(false)
const runError = ref<string | null>(null)
const runForm = ref({
  name: '',
  groundingCompilerKey: '',
  llmProvider: '',
  llmModel: '',
  seed: '',
  instrumentId: '',
  timelineOffsetDays: '' as string | number,
})

const selectedProviderModels = computed<string[]>(() => {
  const provider = providerOptions.value.find(p => p.key === runForm.value.llmProvider)
  const models = (provider?.meta?.models as Array<{ key: string }> | undefined) ?? []
  return models.map(m => m.key)
})

async function openRunDialog(timelineOffsetDays: number | string = '') {
  runError.value = null
  runForm.value = {
    name: '',
    groundingCompilerKey: '',
    // Default to Anthropic + Haiku (cheapest/fastest); user can switch to any
    // provider/model per run before creating it.
    llmProvider: 'anthropic',
    llmModel: 'claude-haiku-4-5',
    seed: '',
    instrumentId: '',
    timelineOffsetDays,
  }
  try {
    if (compilerOptions.value.length === 0) {
      compilerOptions.value = await api.get<RegistryOption[]>('/agents/grounding-compilers/options') ?? []
    }
    if (providerOptions.value.length === 0) {
      providerOptions.value = await api.get<RegistryOption[]>('/llm/providers/options') ?? []
    }
  }
  catch (err) {
    runError.value = (err as ApiError)?.message ?? t('common.error')
  }
  runDialogOpen.value = true
}

async function onCreateRun() {
  runSaving.value = true
  runError.value = null
  try {
    const parsedSeed = runForm.value.seed.trim() === '' ? undefined : Number(runForm.value.seed)
    const created = await api.post<StudyRun>('/study-runs', {
      studyId: Number(studyId.value),
      name: runForm.value.name,
      groundingCompilerKey: runForm.value.groundingCompilerKey || undefined,
      llmProvider: runForm.value.llmProvider || undefined,
      llmModel: runForm.value.llmModel || undefined,
      instrumentId: runForm.value.instrumentId || undefined,
      seed: parsedSeed,
      timelineOffsetDays: String(runForm.value.timelineOffsetDays).trim() === ''
        ? undefined
        : Number(runForm.value.timelineOffsetDays),
    })
    runs.value = [created, ...runs.value]
    runDialogOpen.value = false
  }
  catch (err) {
    runError.value = (err as ApiError)?.message ?? t('common.error')
  }
  finally {
    runSaving.value = false
  }
}

/* -------------------- diffusion timeline (SPEC 14) -------------------- */
const timelineError = ref<string | null>(null)

async function onRescheduleRun(runId: string, days: number) {
  timelineError.value = null
  try {
    const updated = await api.patch<StudyRun>(`/study-runs/${runId}`, { timelineOffsetDays: days })
    runs.value = runs.value.map(r => (r.id === runId ? updated : r))
  }
  catch (err) {
    timelineError.value = (err as ApiError)?.message ?? t('common.error')
  }
}

function onCreateRunAt(days: number) {
  void openRunDialog(days)
}

function goToRun(id: string) {
  void navigateTo(`/runs/${id}`)
}

const excludingRunId = ref<string | null>(null)

async function onToggleExcluded(run: StudyRun) {
  excludingRunId.value = run.id
  try {
    const updated = await api.patch<StudyRun>(`/study-runs/${run.id}`, { excluded: !run.excluded })
    runs.value = runs.value.map(r => (r.id === run.id ? updated : r))
  }
  catch (err) {
    error.value = (err as ApiError)?.message ?? t('common.error')
  }
  finally {
    excludingRunId.value = null
  }
}

const stimuliCount = computed(() => stimuli.value.length)

/**
 * SPEC 9/11 gate for the study's AI synthesis: every non-excluded run must be
 * 'done' first (the backend enforces this regardless — this is just so the
 * researcher sees why before clicking "Gerar").
 */
const studyNotReadyReason = computed(() => {
  const included = runs.value.filter(r => !r.excluded)
  if (included.length === 0) return t('aiAnalysis.gate.noRuns')
  const unfinished = included.filter(r => r.status !== 'done')
  if (unfinished.length === 0) return null
  return t('aiAnalysis.gate.runsUnfinished', {
    list: unfinished.map(r => `${r.name} (${t(`status.${r.status}`)})`).join(', '),
  })
})

onMounted(loadData)
</script>

<template>
  <div class="space-y-6">
    <p v-if="error" class="text-sm text-destructive" role="alert">{{ error }}</p>
    <p v-if="loading" class="text-sm text-muted-foreground">{{ t('common.loading') }}</p>

    <template v-if="study">
      <PageHeader
        :title="study.name"
        :description="study.description ?? undefined"
        :back-to="`/researches/${study.researchId}`"
        :back-label="t('common.back')"
      >
        <template #actions>
          <span class="text-sm text-muted-foreground">
            {{ study.exposureMode ? t(`registry.exposure_mode.${study.exposureMode}`) : '—' }}
          </span>
          <StatusBadge v-if="study.status" :status="study.status" />
        </template>
      </PageHeader>

      <!-- Study-level AI synthesis (SPEC 7): shown first, cached until re-run. -->
      <AiAnalysisPanel :base-path="`studies/${studyId}`" level-label="study" :not-ready-reason="studyNotReadyReason" />

      <!-- Populations -->
      <Card class="max-w-xl">
        <CardHeader>
          <CardTitle class="text-lg">{{ t('studies.attach.title') }}</CardTitle>
          <CardDescription>{{ t('studies.attach.subtitle') }}</CardDescription>
        </CardHeader>
        <CardContent class="space-y-4">

        <!-- Already attached -->
        <div v-if="attachedPopulations.length > 0" class="space-y-2">
          <p class="text-sm font-medium">{{ t('studies.attach.attached') }}</p>
          <ul class="divide-y border">
            <li
              v-for="a in attachedPopulations"
              :key="a.populationId"
              class="flex items-center justify-between gap-3 px-3 py-2"
            >
              <div class="space-y-0.5">
                <NuxtLink
                  :to="`/populations/${a.populationId}`"
                  class="text-sm font-medium hover:underline"
                >
                  {{ a.name }}
                </NuxtLink>
                <p class="text-xs text-muted-foreground">
                  {{ t('studies.attach.agentsCount', { n: a.agentCount }) }}
                  <span v-if="a.role !== 'primary'"> · {{ a.role }}</span>
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                :disabled="detaching === a.populationId"
                @click="onDetach(a.populationId)"
              >
                {{ detaching === a.populationId ? t('common.loading') : t('studies.attach.detach') }}
              </Button>
            </li>
          </ul>
        </div>
        <p v-else class="text-sm text-muted-foreground">{{ t('studies.attach.none') }}</p>

        <!-- Attach another -->
        <div class="space-y-1">
          <label class="text-sm font-medium" for="attach-pop">{{ t('studies.attach.addAnother') }}</label>
          <select
            id="attach-pop"
            v-model="selectedPopulationId"
            class="field-select"
          >
            <option value="">{{ t('common.select') }}</option>
            <option v-for="p in attachablePopulations" :key="p.id" :value="p.id">
              {{ p.name }}
            </option>
          </select>
        </div>

        <p v-if="attachError" class="text-sm text-destructive" role="alert">{{ attachError }}</p>

        <Button :disabled="!selectedPopulationId || !!attaching" @click="onAttach">
          {{ attaching ? t('common.loading') : t('studies.attach.submit') }}
        </Button>
        </CardContent>
      </Card>

      <!-- Stimuli -->
      <Card>
        <CardHeader class="flex-row items-start justify-between gap-4 space-y-0">
          <div class="space-y-1.5">
            <CardTitle class="text-lg">{{ t('stimuli.title') }}</CardTitle>
            <CardDescription>{{ t('stimuli.subtitle') }}</CardDescription>
          </div>
          <Dialog v-model:open="stimulusDialogOpen">
            <DialogTrigger as-child>
              <Button @click="openStimulusDialog">{{ t('stimuli.new') }}</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{{ t('stimuli.new') }}</DialogTitle>
              </DialogHeader>
              <form class="space-y-4" @submit.prevent="onCreateStimulus">
                <div class="space-y-1">
                  <label class="text-sm font-medium" for="st-title">{{ t('stimuli.fields.title') }}</label>
                  <Input id="st-title" v-model="stimulusForm.title" required />
                </div>
                <div class="space-y-1">
                  <label class="text-sm font-medium" for="st-body">{{ t('stimuli.fields.body') }}</label>
                  <textarea
                    id="st-body"
                    v-model="stimulusForm.body"
                    rows="3"
                    class="flex w-full border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                </div>
                <div class="space-y-1">
                  <label class="text-sm font-medium" for="st-payload">{{ t('stimuli.fields.payload') }}</label>
                  <textarea
                    id="st-payload"
                    v-model="stimulusForm.payload"
                    rows="3"
                    :placeholder="t('stimuli.payloadHint')"
                    class="flex w-full border border-input bg-background px-3 py-2 font-mono text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                </div>
                <p v-if="stimulusError" class="text-sm text-destructive" role="alert">{{ stimulusError }}</p>
                <Button type="submit" :disabled="stimulusSaving || !stimulusForm.title.trim()">
                  {{ stimulusSaving ? t('common.loading') : t('common.create') }}
                </Button>
              </form>
            </DialogContent>
          </Dialog>
        </CardHeader>
        <CardContent class="p-0">
          <ul>
            <li
              v-for="s in stimuli"
              :key="s.id"
              class="flex items-start justify-between gap-4 border-b p-4 last:border-b-0"
            >
              <div class="space-y-1">
                <p class="font-medium">{{ s.title }}</p>
                <p v-if="s.body" class="text-sm text-muted-foreground">{{ s.body }}</p>
              </div>
              <Button variant="outline" size="sm" @click="onDeleteStimulus(s.id)">
                {{ t('common.delete') }}
              </Button>
            </li>
            <li v-if="stimuli.length === 0" class="p-10 text-center text-sm text-muted-foreground">
              {{ t('stimuli.empty') }}
            </li>
          </ul>
        </CardContent>
      </Card>

      <!-- Instruments -->
      <Card>
        <CardHeader class="flex-row items-start justify-between gap-4 space-y-0">
          <div class="space-y-1.5">
            <CardTitle class="text-lg">{{ t('instruments.title') }}</CardTitle>
            <CardDescription>{{ t('instruments.subtitle') }}</CardDescription>
          </div>
          <Dialog v-model:open="instrumentDialogOpen">
            <DialogTrigger as-child>
              <Button @click="openInstrumentDialog">{{ t('instruments.new') }}</Button>
            </DialogTrigger>
            <DialogContent class="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
              <DialogHeader>
                <DialogTitle>{{ t('instruments.builder.title') }}</DialogTitle>
              </DialogHeader>
              <form class="space-y-5" @submit.prevent="onCreateInstrument">
                <div class="grid gap-4 sm:grid-cols-2">
                  <div class="space-y-1">
                    <label class="text-sm font-medium" for="in-name">{{ t('instruments.fields.name') }}</label>
                    <Input id="in-name" v-model="instrumentName" required />
                  </div>
                  <div class="space-y-1">
                    <label class="text-sm font-medium" for="in-desc">{{ t('instruments.fields.description') }}</label>
                    <Input id="in-desc" v-model="instrumentDescription" />
                  </div>
                </div>

                <div class="space-y-3">
                  <div class="flex items-center justify-between">
                    <p class="text-sm font-medium">{{ t('instruments.builder.items') }}</p>
                    <Button type="button" variant="outline" size="sm" @click="addDraftItem">
                      {{ t('instruments.builder.addItem') }}
                    </Button>
                  </div>

                  <div
                    v-for="(item, idx) in draftItems"
                    :key="idx"
                    class="space-y-3 border p-4"
                  >
                    <div class="flex items-center justify-between">
                      <span class="text-sm font-medium">{{ t('instruments.builder.item') }} {{ idx + 1 }}</span>
                      <Button
                        v-if="draftItems.length > 1"
                        type="button"
                        variant="outline"
                        size="sm"
                        @click="removeDraftItem(idx)"
                      >
                        {{ t('common.delete') }}
                      </Button>
                    </div>

                    <div class="grid gap-3 sm:grid-cols-2">
                      <div class="space-y-1">
                        <label class="text-sm font-medium">{{ t('instruments.fields.itemType') }}</label>
                        <RegistrySelect
                          v-model="item.itemType"
                          :options="itemTypeOptions"
                          :placeholder="t('common.select')"
                        />
                      </div>
                      <div class="space-y-1">
                        <label class="text-sm font-medium">{{ t('instruments.fields.itemKey') }}</label>
                        <Input v-model="item.itemKey" />
                      </div>
                    </div>

                    <div class="space-y-1">
                      <label class="text-sm font-medium">{{ t('instruments.fields.promptText') }}</label>
                      <Input v-model="item.promptText" />
                    </div>

                    <label class="flex items-center gap-2 text-sm">
                      <input v-model="item.required" type="checkbox">
                      {{ t('instruments.fields.required') }}
                    </label>

                    <!-- scale_0_10 config -->
                    <div v-if="item.itemType === 'scale_0_10'" class="grid gap-3 sm:grid-cols-2">
                      <div class="space-y-1">
                        <label class="text-sm font-medium">{{ t('instruments.fields.min') }}</label>
                        <Input v-model.number="item.scaleMin" type="number" />
                      </div>
                      <div class="space-y-1">
                        <label class="text-sm font-medium">{{ t('instruments.fields.max') }}</label>
                        <Input v-model.number="item.scaleMax" type="number" />
                      </div>
                    </div>

                    <!-- choice options editor -->
                    <div
                      v-else-if="item.itemType === 'single_choice' || item.itemType === 'multiple_choice'"
                      class="space-y-2"
                    >
                      <div class="flex items-center justify-between">
                        <label class="text-sm font-medium">{{ t('instruments.fields.options') }}</label>
                        <Button type="button" variant="outline" size="sm" @click="addDraftOption(item)">
                          {{ t('instruments.builder.addOption') }}
                        </Button>
                      </div>
                      <div
                        v-for="(opt, oi) in item.options"
                        :key="oi"
                        class="grid grid-cols-[1fr_1fr_auto] items-center gap-2"
                      >
                        <Input v-model="opt.key" :placeholder="t('instruments.fields.optionKey')" />
                        <Input v-model="opt.label" :placeholder="t('instruments.fields.optionLabel')" />
                        <Button type="button" variant="outline" size="sm" @click="removeDraftOption(item, oi)">
                          {{ t('common.delete') }}
                        </Button>
                      </div>
                      <p v-if="item.options.length === 0" class="text-xs text-muted-foreground">
                        {{ t('instruments.builder.noOptions') }}
                      </p>
                    </div>

                    <!-- conjoint stimulus multi-select -->
                    <div v-else-if="item.itemType === 'conjoint_profile_choice'" class="space-y-2">
                      <label class="text-sm font-medium">{{ t('instruments.fields.stimuli') }}</label>
                      <p v-if="stimuliCount === 0" class="text-xs text-muted-foreground">
                        {{ t('instruments.builder.noStimuli') }}
                      </p>
                      <ul v-else class="space-y-1">
                        <li v-for="s in stimuli" :key="s.id">
                          <label class="flex items-center gap-2 border p-2 text-sm">
                            <input
                              type="checkbox"
                              :checked="item.stimulusIds.has(s.id)"
                              @change="toggleStimulus(item, s.id)"
                            >
                            {{ s.title }}
                          </label>
                        </li>
                      </ul>
                    </div>
                  </div>
                </div>

                <p v-if="instrumentError" class="text-sm text-destructive" role="alert">{{ instrumentError }}</p>

                <Button type="submit" :disabled="instrumentSaving || !instrumentName.trim()">
                  {{ instrumentSaving ? t('common.loading') : t('common.create') }}
                </Button>
              </form>
            </DialogContent>
          </Dialog>
        </CardHeader>
        <CardContent class="p-0">
          <ul>
            <li
              v-for="inst in instruments"
              :key="inst.id"
              class="border-b last:border-b-0"
            >
              <div class="flex items-start justify-between gap-4 p-4">
                <button type="button" class="space-y-1 text-left" @click="toggleInstrument(inst)">
                  <p class="font-medium">{{ inst.name }}</p>
                  <p v-if="inst.description" class="text-sm text-muted-foreground">{{ inst.description }}</p>
                  <span class="text-xs text-muted-foreground">
                    {{ expandedInstrumentId === inst.id ? t('instruments.hideItems') : t('instruments.showItems') }}
                  </span>
                </button>
                <Button variant="outline" size="sm" @click="onDeleteInstrument(inst.id)">
                  {{ t('common.delete') }}
                </Button>
              </div>

              <div v-if="expandedInstrumentId === inst.id" class="border-t bg-muted/30 px-4 py-3">
                <ul class="space-y-2">
                  <li
                    v-for="it in (instrumentItemsCache[inst.id] ?? [])"
                    :key="it.id"
                    class="flex items-start justify-between gap-3 border bg-background p-3"
                  >
                    <div class="space-y-0.5">
                      <p class="text-sm font-medium">{{ it.promptText }}</p>
                      <p class="text-xs text-muted-foreground">
                        {{ t(`registry.item_type.${it.itemType}`) }} · {{ it.itemKey }}
                        <span v-if="it.required"> · {{ t('instruments.fields.required') }}</span>
                      </p>
                    </div>
                    <Button variant="outline" size="sm" @click="onDeleteInstrumentItem(inst.id, it.id)">
                      {{ t('common.delete') }}
                    </Button>
                  </li>
                  <li
                    v-if="(instrumentItemsCache[inst.id] ?? []).length === 0"
                    class="text-sm text-muted-foreground"
                  >
                    {{ t('instruments.noItems') }}
                  </li>
                </ul>
              </div>
            </li>
            <li v-if="instruments.length === 0" class="p-10 text-center text-sm text-muted-foreground">
              {{ t('instruments.empty') }}
            </li>
          </ul>
        </CardContent>
      </Card>

      <!-- Diffusion timeline (SPEC 14): only meaningful when runs happen at -->
      <!-- different points in time relative to a diffusion event. -->
      <Card v-if="study?.exposureMode === 'channel_diffusion'">
        <CardHeader>
          <CardTitle class="text-lg">{{ t('diffusion.timeline.title') }}</CardTitle>
          <CardDescription>{{ t('diffusion.timeline.subtitle') }}</CardDescription>
        </CardHeader>
        <CardContent>
          <p v-if="timelineError" class="mb-2 text-sm text-destructive" role="alert">{{ timelineError }}</p>
          <DiffusionTimeline
            :runs="runs"
            @reschedule="onRescheduleRun"
            @create-at="onCreateRunAt"
          />
        </CardContent>
      </Card>

      <!-- Runs -->
      <Card>
        <CardHeader class="flex-row items-start justify-between gap-4 space-y-0">
          <div class="space-y-1.5">
            <CardTitle class="text-lg">{{ t('runs.title') }}</CardTitle>
            <CardDescription>{{ t('runs.subtitle') }}</CardDescription>
          </div>
          <div class="flex items-center gap-2">
          <RunAllButton :get-runs="async () => runs" @done="loadData" />
          <CheckAllButton :get-runs="async () => runs" @done="loadData" />
          <Dialog v-model:open="runDialogOpen">
            <DialogTrigger as-child>
              <Button @click="openRunDialog()">{{ t('runs.new') }}</Button>
            </DialogTrigger>
            <DialogContent class="max-h-[85vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>{{ t('runs.new') }}</DialogTitle>
              </DialogHeader>
              <form class="space-y-4" @submit.prevent="onCreateRun">
                <div class="space-y-1">
                  <label class="text-sm font-medium" for="run-name">{{ t('runs.fields.name') }}</label>
                  <Input id="run-name" v-model="runForm.name" required />
                </div>
                <div class="space-y-1">
                  <label class="text-sm font-medium" for="run-compiler">{{ t('runs.fields.groundingCompiler') }}</label>
                  <RegistrySelect
                    id="run-compiler"
                    v-model="runForm.groundingCompilerKey"
                    :options="compilerOptions"
                    :placeholder="t('common.select')"
                  />
                </div>
                <div class="grid gap-4 sm:grid-cols-2">
                  <div class="space-y-1">
                    <label class="text-sm font-medium" for="run-provider">{{ t('runs.fields.llmProvider') }}</label>
                    <RegistrySelect
                      id="run-provider"
                      v-model="runForm.llmProvider"
                      :options="providerOptions"
                      :placeholder="t('common.select')"
                    />
                  </div>
                  <div class="space-y-1">
                    <label class="text-sm font-medium" for="run-model">{{ t('runs.fields.llmModel') }}</label>
                    <select
                      id="run-model"
                      v-model="runForm.llmModel"
                      :disabled="selectedProviderModels.length === 0"
                      class="flex h-10 w-full border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <option value="">{{ t('common.select') }}</option>
                      <option v-for="m in selectedProviderModels" :key="m" :value="m">{{ m }}</option>
                    </select>
                  </div>
                </div>
                <div class="space-y-1">
                  <label class="text-sm font-medium" for="run-instrument">{{ t('runs.fields.instrument') }}</label>
                  <select
                    id="run-instrument"
                    v-model="runForm.instrumentId"
                    class="field-select"
                  >
                    <option value="">{{ t('common.select') }}</option>
                    <option v-for="inst in instruments" :key="inst.id" :value="inst.id">{{ inst.name }}</option>
                  </select>
                </div>
                <div class="space-y-1">
                  <label class="text-sm font-medium" for="run-seed">{{ t('runs.fields.seed') }}</label>
                  <Input id="run-seed" v-model="runForm.seed" type="number" />
                </div>
                <div v-if="study?.exposureMode === 'channel_diffusion'" class="space-y-1">
                  <label class="text-sm font-medium" for="run-timeline-offset">{{ t('runs.fields.timelineOffsetDays') }}</label>
                  <Input id="run-timeline-offset" v-model.number="runForm.timelineOffsetDays" type="number" />
                  <p class="text-xs text-muted-foreground">{{ t('runs.fields.timelineOffsetDaysHint') }}</p>
                </div>

                <p v-if="runError" class="text-sm text-destructive" role="alert">{{ runError }}</p>

                <Button type="submit" :disabled="runSaving || !runForm.name.trim()">
                  {{ runSaving ? t('common.loading') : t('common.create') }}
                </Button>
              </form>
            </DialogContent>
          </Dialog>
          </div>
        </CardHeader>
        <CardContent class="p-0">
          <ul>
            <li
              v-for="run in runs"
              :key="run.id"
              class="flex items-center justify-between gap-4 border-b p-4 last:border-b-0"
            >
              <button type="button" class="flex items-center gap-3 text-left" @click="goToRun(run.id)">
                <span class="font-medium" :class="{ 'line-through text-muted-foreground': run.excluded }">{{ run.name }}</span>
                <span
                  v-if="run.excluded"
                  class="rounded bg-muted px-1.5 py-0.5 text-xs font-medium text-muted-foreground"
                >
                  {{ t('runs.excluded') }}
                </span>
                <span
                  v-if="study?.exposureMode === 'channel_diffusion'"
                  class="rounded bg-muted px-1.5 py-0.5 text-xs font-medium tabular-nums text-muted-foreground"
                >
                  {{ t('diffusion.timeline.dayN', { n: run.timelineOffsetDays ?? 0 }) }}
                </span>
                <!-- A diffusion run's own `status` stays 'frozen' forever — -->
                <!-- progress lives per event (opinionStatus), so show that -->
                <!-- summary instead of the (always-misleading) run status. -->
                <span
                  v-if="study?.exposureMode === 'channel_diffusion' && runEventSummaries[run.id]"
                  class="rounded px-1.5 py-0.5 text-xs font-medium tabular-nums"
                  :class="runEventSummaries[run.id]!.done === runEventSummaries[run.id]!.total
                    ? 'bg-primary/10 text-primary'
                    : runEventSummaries[run.id]!.error > 0
                      ? 'bg-destructive/10 text-destructive'
                      : 'bg-muted text-muted-foreground'"
                >
                  {{ t('runs.eventProgress', { done: runEventSummaries[run.id]!.done, total: runEventSummaries[run.id]!.total }) }}
                </span>
                <StatusBadge v-else :status="run.status" />
              </button>
              <div class="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  :disabled="excludingRunId === run.id"
                  @click="onToggleExcluded(run)"
                >
                  {{ run.excluded ? t('runs.include') : t('runs.exclude') }}
                </Button>
                <Button variant="outline" size="sm" @click="goToRun(run.id)">
                  {{ t('runs.open') }}
                </Button>
              </div>
            </li>
            <li v-if="runs.length === 0" class="p-10 text-center text-sm text-muted-foreground">
              {{ t('runs.empty') }}
            </li>
          </ul>
        </CardContent>
      </Card>
    </template>
  </div>
</template>
