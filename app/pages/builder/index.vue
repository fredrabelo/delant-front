<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from '#imports'
import { NuxtLink } from '#components'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import RegistrySelect from '@/components/RegistrySelect.vue'
import PageHeader from '@/components/PageHeader.vue'
import { useApi } from '@/composables/useApi'
import type { ApiError } from '@/composables/useApi'
import type {
  Attribute,
  AttributeLabels,
  Country,
  Department,
  Instrument,
  InstrumentItemInput,
  Population,
  RegistryOption,
  Research,
  Stimulus,
  StimulusImageMedia,
  Study,
  StudyRun,
} from '@/types/api'

const { t } = useI18n()
const api = useApi()

const TOTAL_STEPS = 5
const currentStep = ref(1)
const error = ref<string | null>(null)

/* -------------------- reference data -------------------- */
const departments = ref<Department[]>([])
const countries = ref<Country[]>([])
const researches = ref<Research[]>([])
const exposureModes = ref<RegistryOption[]>([])
const itemTypes = ref<RegistryOption[]>([])
const compilers = ref<RegistryOption[]>([])
const providers = ref<RegistryOption[]>([])

async function loadInitial() {
  error.value = null
  try {
    const [deps, cs, rs, modes] = await Promise.all([
      api.get<Department[]>('/departments'),
      api.get<Country[]>('/countries'),
      api.get<Research[]>('/researches'),
      api.get<RegistryOption[]>('/studies/exposure-modes/options'),
    ])
    departments.value = deps ?? []
    countries.value = cs ?? []
    researches.value = rs ?? []
    exposureModes.value = modes ?? []
    countryId.value = cs?.find(c => c.isDefault)?.id ?? cs?.[0]?.id ?? ''
  }
  catch (err) {
    error.value = (err as ApiError)?.message ?? t('common.error')
  }
}

/* -------------------- step 1: research + study -------------------- */
const useExistingResearch = ref(false)
const existingResearchId = ref('')
const researchForm = ref({ departmentId: '', countryId: '', name: '', objective: '' })
const studyForm = ref({ name: '', description: '', exposureMode: '' })
const savingResearch = ref(false)
const savingStudy = ref(false)

const research = ref<Research | null>(null)
const study = ref<Study | null>(null)

// channel_diffusion studies (SPEC 14, the RedGum-style market design) don't
// use an instrument or the freeze/execute path — channel + event + exposure
// + opinions are all set up on the run's own Diffusion tab instead. The flag
// comes from the exposure_mode registry (`usesChannels`), never hardcoded —
// see backend/src/studies/registries/exposure-mode.registry.ts.
const isChannelDiffusion = computed(() => {
  const mode = exposureModes.value.find(m => m.key === studyForm.value.exposureMode)
  return (mode?.meta as { usesChannels?: boolean } | undefined)?.usesChannels === true
})

const researchId = computed(() =>
  useExistingResearch.value ? existingResearchId.value : research.value?.id ?? '',
)

const canCreateResearch = computed(() =>
  researchForm.value.departmentId !== '' && researchForm.value.name.trim() !== '',
)
const canCreateStudy = computed(() => researchId.value !== '' && studyForm.value.name.trim() !== '')

async function onCreateResearch() {
  savingResearch.value = true
  error.value = null
  try {
    const created = await api.post<Research>('/researches', {
      departmentId: researchForm.value.departmentId,
      countryId: researchForm.value.countryId || undefined,
      name: researchForm.value.name.trim(),
      objective: researchForm.value.objective.trim() || undefined,
    })
    research.value = created
    researches.value = [created, ...researches.value]
  }
  catch (err) {
    error.value = (err as ApiError)?.message ?? t('common.error')
  }
  finally {
    savingResearch.value = false
  }
}

async function onCreateStudy() {
  savingStudy.value = true
  error.value = null
  try {
    const created = await api.post<Study>('/studies', {
      researchId: researchId.value,
      name: studyForm.value.name.trim(),
      description: studyForm.value.description.trim() || undefined,
      exposureMode: studyForm.value.exposureMode || undefined,
    })
    study.value = created
  }
  catch (err) {
    error.value = (err as ApiError)?.message ?? t('common.error')
  }
  finally {
    savingStudy.value = false
  }
}

/* -------------------- step 2: population -------------------- */
const countryId = ref('')
const populations = ref<Population[]>([])
const loadingPopulations = ref(false)
const selectedPopulationId = ref('')
const attaching = ref(false)
const populationAttached = ref(false)

async function loadPopulations() {
  loadingPopulations.value = true
  error.value = null
  try {
    populations.value = await api.get<Population[]>('/populations', {
      query: countryId.value ? { countryId: countryId.value } : {},
    }) ?? []
  }
  catch (err) {
    error.value = (err as ApiError)?.message ?? t('common.error')
  }
  finally {
    loadingPopulations.value = false
  }
}

async function onAttachPopulation() {
  if (!selectedPopulationId.value || !study.value) {
    return
  }
  attaching.value = true
  error.value = null
  try {
    await api.post(`/populations/${selectedPopulationId.value}/attach`, { studyId: study.value.id })
    populationAttached.value = true
  }
  catch (err) {
    error.value = (err as ApiError)?.message ?? t('common.error')
  }
  finally {
    attaching.value = false
  }
}

/* -------------------- step 3: stimulus -------------------- */
const stimulusForm = ref({ title: '', body: '', slotKey: '', armWeight: '' })
const savingStimulus = ref(false)
const stimuli = ref<Stimulus[]>([])

const ALLOWED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp']
const stimulusImage = ref<StimulusImageMedia | null>(null)
const uploadingImage = ref(false)
const imageError = ref<string | null>(null)

const stimulusImagePreview = computed(() => {
  const media = stimulusImage.value
  return media ? `data:${media.mediaType};base64,${media.dataBase64}` : null
})

function stimulusImageUrl(s: Stimulus): string | null {
  const media = s.payload as StimulusImageMedia | undefined
  return media?.kind === 'image' ? `data:${media.mediaType};base64,${media.dataBase64}` : null
}

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      // Strip the "data:<mime>;base64," prefix FileReader adds.
      resolve(result.slice(result.indexOf(',') + 1))
    }
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

async function onImageFileSelected(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  imageError.value = null
  if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
    imageError.value = t('builder.imageUnsupportedType')
    input.value = ''
    return
  }
  uploadingImage.value = true
  try {
    const dataBase64 = await readFileAsBase64(file)
    stimulusImage.value = await api.post<StimulusImageMedia>('/stimuli/media', {
      mimeType: file.type,
      dataBase64,
    })
  }
  catch (err) {
    imageError.value = (err as ApiError)?.message ?? t('common.error')
  }
  finally {
    uploadingImage.value = false
    input.value = ''
  }
}

function clearStimulusImage() {
  stimulusImage.value = null
}

/* -------------------- step 3: conjoint attributes (optional) -------------------- */
// Reuses the same attributes engine as the Population Builder (domain=
// 'stimulus' instead of 'population') — never a hardcoded list of dimensions.
interface StimulusAttributeRow {
  attributeId: string
  valueId: string
}

const stimulusAttributeOptions = ref<Attribute[]>([])
const stimulusAttributeRows = ref<StimulusAttributeRow[]>([])
const attributeLabelsById = ref<Record<string, AttributeLabels>>({})
const loadingAttributeValues = ref<Record<string, boolean>>({})

async function loadStimulusAttributeOptions() {
  if (stimulusAttributeOptions.value.length > 0) return
  try {
    stimulusAttributeOptions.value = await api.get<Attribute[]>('/attributes', { query: { domain: 'stimulus' } }) ?? []
  }
  catch (err) {
    error.value = (err as ApiError)?.message ?? t('common.error')
  }
}

function addAttributeRow() {
  stimulusAttributeRows.value = [...stimulusAttributeRows.value, { attributeId: '', valueId: '' }]
}

function removeAttributeRow(index: number) {
  stimulusAttributeRows.value = stimulusAttributeRows.value.filter((_, i) => i !== index)
}

async function onAttributeRowChange(row: StimulusAttributeRow) {
  row.valueId = ''
  if (!row.attributeId || attributeLabelsById.value[row.attributeId]) return
  loadingAttributeValues.value[row.attributeId] = true
  try {
    attributeLabelsById.value[row.attributeId] = await api.get<AttributeLabels>(`/attributes/${row.attributeId}/labels`)
  }
  catch (err) {
    error.value = (err as ApiError)?.message ?? t('common.error')
  }
  finally {
    loadingAttributeValues.value[row.attributeId] = false
  }
}

function valueOptionsFor(attributeId: string): Array<{ id: string, label: string }> {
  const labels = attributeLabelsById.value[attributeId]?.values ?? {}
  return Object.entries(labels).map(([id, label]) => ({ id, label }))
}

const canAddStimulus = computed(() => stimulusForm.value.title.trim() !== '')

async function onAddStimulus() {
  if (!study.value) {
    return
  }
  savingStimulus.value = true
  error.value = null
  try {
    // Cast to Number: `attributeValueId` in particular always arrives as a
    // string here (it's the key of a JSON-serialized Record<number,string>
    // — object/JSON keys are string, whatever the original numeric key was)
    // — the backend DTO's `@IsInt()` rejects a numeric string outright.
    const attributeValues = stimulusAttributeRows.value
      .filter(r => r.attributeId && r.valueId)
      .map(r => ({ attributeId: Number(r.attributeId), attributeValueId: Number(r.valueId) }))
    // Arm/variant fields merge into the same `payload` as the image (a
    // stimulus can be both — see StudyRunsService.assignRandomArms).
    const slotKey = stimulusForm.value.slotKey.trim()
    const armWeight = Number(stimulusForm.value.armWeight)
    const payload: Record<string, unknown> = { ...(stimulusImage.value ?? {}) }
    if (slotKey) payload.slotKey = slotKey
    if (slotKey && stimulusForm.value.armWeight.trim() && Number.isFinite(armWeight) && armWeight > 0) {
      payload.armWeight = armWeight
    }
    const created = await api.post<Stimulus>('/stimuli', {
      studyId: study.value.id,
      title: stimulusForm.value.title.trim(),
      body: stimulusForm.value.body.trim() || undefined,
      payload: Object.keys(payload).length > 0 ? payload : undefined,
      attributeValues: attributeValues.length > 0 ? attributeValues : undefined,
    })
    stimuli.value = [...stimuli.value, created]
    stimulusForm.value = { title: '', body: '', slotKey: stimulusForm.value.slotKey, armWeight: '' }
    stimulusImage.value = null
    stimulusAttributeRows.value = []
  }
  catch (err) {
    error.value = (err as ApiError)?.message ?? t('common.error')
  }
  finally {
    savingStimulus.value = false
  }
}

/* -------------------- step 4: instrument (optional) -------------------- */
interface DraftItem {
  itemType: string
  itemKey: string
  promptText: string
}

const instrumentName = ref('')
const draftItems = ref<DraftItem[]>([{ itemType: '', itemKey: '', promptText: '' }])
const savingInstrument = ref(false)
const instrument = ref<Instrument | null>(null)

function addDraftItem() {
  draftItems.value = [...draftItems.value, { itemType: '', itemKey: '', promptText: '' }]
}

function removeDraftItem(index: number) {
  draftItems.value = draftItems.value.filter((_, i) => i !== index)
}

const canCreateInstrument = computed(() =>
  instrumentName.value.trim() !== ''
  && draftItems.value.some(i => i.itemType && i.itemKey.trim() && i.promptText.trim()),
)

async function onCreateInstrument() {
  if (!study.value) {
    return
  }
  savingInstrument.value = true
  error.value = null
  try {
    const items: InstrumentItemInput[] = draftItems.value
      .filter(i => i.itemType && i.itemKey.trim() && i.promptText.trim())
      .map((i, idx) => ({
        itemType: i.itemType,
        itemKey: i.itemKey.trim(),
        promptText: i.promptText.trim(),
        sortOrder: idx,
      }))
    const created = await api.post<Instrument>('/instruments', {
      studyId: study.value.id,
      name: instrumentName.value.trim(),
      items,
    })
    instrument.value = created
  }
  catch (err) {
    error.value = (err as ApiError)?.message ?? t('common.error')
  }
  finally {
    savingInstrument.value = false
  }
}

function skipInstrument() {
  instrument.value = null
  currentStep.value = 5
}

/* -------------------- step 5: run -------------------- */
const runForm = ref({
  name: '',
  groundingCompilerKey: '',
  llmProvider: '',
  llmModel: '',
  seed: '',
})
const savingRun = ref(false)
const freezing = ref(false)
const executing = ref(false)
const run = ref<StudyRun | null>(null)

const selectedProviderModels = computed<string[]>(() => {
  const provider = providers.value.find(p => p.key === runForm.value.llmProvider)
  const models = (provider?.meta?.models as Array<{ key: string }> | undefined) ?? []
  return models.map(m => m.key)
})

const canCreateRun = computed(() => runForm.value.name.trim() !== '' && !!study.value)
const isRunFrozen = computed(() => run.value?.status === 'frozen')
const runExecuted = computed(() =>
  run.value?.status === 'running' || run.value?.status === 'done' || run.value?.status === 'error',
)

async function loadRunReferenceData() {
  try {
    if (compilers.value.length === 0) {
      compilers.value = await api.get<RegistryOption[]>('/agents/grounding-compilers/options') ?? []
    }
    if (providers.value.length === 0) {
      providers.value = await api.get<RegistryOption[]>('/llm/providers/options') ?? []
    }
  }
  catch (err) {
    error.value = (err as ApiError)?.message ?? t('common.error')
  }
}

async function onCreateRun() {
  if (!study.value) {
    return
  }
  savingRun.value = true
  error.value = null
  try {
    const seedRaw = runForm.value.seed.trim()
    const created = await api.post<StudyRun>('/study-runs', {
      studyId: study.value.id,
      name: runForm.value.name.trim(),
      groundingCompilerKey: runForm.value.groundingCompilerKey || undefined,
      llmProvider: runForm.value.llmProvider || undefined,
      llmModel: runForm.value.llmModel || undefined,
      instrumentId: instrument.value?.id || undefined,
      seed: seedRaw === '' ? undefined : Number(seedRaw),
    })
    run.value = created
  }
  catch (err) {
    error.value = (err as ApiError)?.message ?? t('common.error')
  }
  finally {
    savingRun.value = false
  }
}

async function onFreezeRun() {
  if (!run.value) {
    return
  }
  freezing.value = true
  error.value = null
  try {
    run.value = await api.post<StudyRun>(`/study-runs/${run.value.id}/freeze`, {})
  }
  catch (err) {
    error.value = (err as ApiError)?.message ?? t('common.error')
  }
  finally {
    freezing.value = false
  }
}

async function onExecuteRun() {
  if (!run.value) {
    return
  }
  executing.value = true
  error.value = null
  try {
    run.value = await api.post<StudyRun>(`/study-runs/${run.value.id}/execute`)
  }
  catch (err) {
    error.value = (err as ApiError)?.message ?? t('common.error')
  }
  finally {
    executing.value = false
  }
}

/* -------------------- step gating / navigation -------------------- */
const stepLabels = computed(() => [
  t('builder.step1'),
  t('builder.step2'),
  t('builder.step3'),
  t('builder.step4'),
  t('builder.step5'),
])

// A step is "done" (allows Next) when its required output exists.
const stepComplete = computed<Record<number, boolean>>(() => ({
  1: !!study.value,
  2: populationAttached.value,
  3: stimuli.value.length > 0,
  4: true, // optional
  5: isRunFrozen.value,
}))

const canGoNext = computed(() => currentStep.value < TOTAL_STEPS && !!stepComplete.value[currentStep.value])

async function goNext() {
  if (!canGoNext.value) {
    return
  }
  currentStep.value += 1
  if (currentStep.value === 2 && populations.value.length === 0) {
    await loadPopulations()
  }
  if (currentStep.value === 3) {
    await loadStimulusAttributeOptions()
  }
  if (currentStep.value === 4 && itemTypes.value.length === 0) {
    try {
      itemTypes.value = await api.get<RegistryOption[]>('/instruments/item-types/options') ?? []
    }
    catch (err) {
      error.value = (err as ApiError)?.message ?? t('common.error')
    }
  }
  if (currentStep.value === 5) {
    await loadRunReferenceData()
  }
}

function goBack() {
  if (currentStep.value > 1) {
    currentStep.value -= 1
  }
}

onMounted(loadInitial)
</script>

<template>
  <div class="space-y-8 max-w-3xl">
    <PageHeader
      :title="t('builder.title')"
      :description="t('builder.subtitle')"
    />

    <!-- Progress indicator -->
    <div class="space-y-2">
      <p class="text-sm text-muted-foreground">
        {{ t('builder.stepProgress', { current: currentStep, total: TOTAL_STEPS }) }}
      </p>
      <ol class="flex flex-wrap gap-2">
        <li
          v-for="(label, i) in stepLabels"
          :key="i"
          class="flex-1 border px-3 py-2 text-xs min-w-[8rem]"
          :class="[
            currentStep === i + 1 ? 'border-primary bg-primary/5 font-medium' : 'border-input',
            stepComplete[i + 1] && currentStep !== i + 1 ? 'text-muted-foreground' : '',
          ]"
        >
          {{ label }}
        </li>
      </ol>
    </div>

    <p v-if="error" class="text-sm text-destructive" role="alert">{{ error }}</p>

    <!-- Step 1: research + study -->
    <section v-if="currentStep === 1" class="space-y-6">
      <Card>
        <CardContent class="space-y-4 pt-6">
        <h2 class="text-lg font-medium">{{ t('builder.createResearch') }}</h2>

        <label class="flex items-center gap-2 text-sm">
          <input v-model="useExistingResearch" type="checkbox">
          {{ t('researches.title') }}
        </label>

        <div v-if="useExistingResearch" class="space-y-1">
          <label class="text-sm font-medium" for="b-research">{{ t('researches.title') }}</label>
          <select
            id="b-research"
            v-model="existingResearchId"
            class="field-select"
          >
            <option value="">{{ t('common.select') }}</option>
            <option v-for="r in researches" :key="r.id" :value="r.id">{{ r.name }}</option>
          </select>
        </div>

        <template v-else>
          <div class="grid gap-4 sm:grid-cols-2">
            <div class="space-y-1">
              <label class="text-sm font-medium" for="b-dep">{{ t('researches.fields.department') }}</label>
              <select
                id="b-dep"
                v-model="researchForm.departmentId"
                class="field-select"
              >
                <option value="">{{ t('common.select') }}</option>
                <option v-for="d in departments" :key="d.id" :value="d.id">{{ d.name }}</option>
              </select>
            </div>
            <div class="space-y-1">
              <label class="text-sm font-medium" for="b-country">{{ t('researches.fields.country') }}</label>
              <select
                id="b-country"
                v-model="researchForm.countryId"
                class="field-select"
              >
                <option value="">{{ t('common.select') }}</option>
                <option v-for="c in countries" :key="c.id" :value="c.id">{{ c.name }}</option>
              </select>
            </div>
            <div class="space-y-1">
              <label class="text-sm font-medium" for="b-rname">{{ t('researches.fields.name') }}</label>
              <Input id="b-rname" v-model="researchForm.name" />
            </div>
            <div class="space-y-1">
              <label class="text-sm font-medium" for="b-robj">{{ t('researches.fields.objective') }}</label>
              <Input id="b-robj" v-model="researchForm.objective" />
            </div>
          </div>
          <Button :disabled="savingResearch || !canCreateResearch || !!research" @click="onCreateResearch">
            {{ savingResearch ? t('common.loading') : t('builder.createResearch') }}
          </Button>
          <p v-if="research" class="text-sm text-primary">{{ t('builder.researchCreated') }}</p>
        </template>
        </CardContent>
      </Card>

      <Card>
        <CardContent class="space-y-4 pt-6">
        <h2 class="text-lg font-medium">{{ t('builder.createStudy') }}</h2>
        <div class="space-y-1">
          <label class="text-sm font-medium" for="b-sname">{{ t('studies.fields.name') }}</label>
          <Input id="b-sname" v-model="studyForm.name" :disabled="!researchId || !!study" />
        </div>
        <div class="space-y-1">
          <label class="text-sm font-medium" for="b-sdesc">{{ t('studies.fields.description') }}</label>
          <Input id="b-sdesc" v-model="studyForm.description" :disabled="!researchId || !!study" />
        </div>
        <div class="space-y-1">
          <label class="text-sm font-medium" for="b-smode">{{ t('studies.fields.exposureMode') }}</label>
          <RegistrySelect
            id="b-smode"
            v-model="studyForm.exposureMode"
            :options="exposureModes"
            :placeholder="t('common.select')"
            :disabled="!researchId || !!study"
          />
        </div>
        <Button :disabled="savingStudy || !canCreateStudy || !!study" @click="onCreateStudy">
          {{ savingStudy ? t('common.loading') : t('builder.createStudy') }}
        </Button>
        <p v-if="study" class="text-sm text-primary">{{ t('builder.studyCreated') }}</p>
        </CardContent>
      </Card>
    </section>

    <!-- Step 2: population -->
    <Card v-else-if="currentStep === 2">
      <CardContent class="space-y-4 pt-6">
      <h2 class="text-lg font-medium">{{ t('builder.pickPopulation') }}</h2>
      <p v-if="loadingPopulations" class="text-sm text-muted-foreground">{{ t('common.loading') }}</p>
      <p v-else-if="populations.length === 0" class="text-sm text-muted-foreground">
        {{ t('builder.noPopulations') }}
      </p>
      <template v-else>
        <div class="space-y-1">
          <label class="text-sm font-medium" for="b-pop">{{ t('populations.title') }}</label>
          <select
            id="b-pop"
            v-model="selectedPopulationId"
            :disabled="populationAttached"
            class="flex h-10 w-full border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
          >
            <option value="">{{ t('common.select') }}</option>
            <option v-for="p in populations" :key="p.id" :value="p.id">{{ p.name }}</option>
          </select>
        </div>
        <Button :disabled="attaching || !selectedPopulationId || populationAttached" @click="onAttachPopulation">
          {{ attaching ? t('common.loading') : t('builder.pickPopulation') }}
        </Button>
        <p v-if="populationAttached" class="text-sm text-primary">{{ t('builder.populationAttached') }}</p>
      </template>
      </CardContent>
    </Card>

    <!-- Step 3: stimulus -->
    <section v-else-if="currentStep === 3" class="space-y-4">
      <Card>
        <CardContent class="space-y-4 pt-6">
        <h2 class="text-lg font-medium">{{ t('builder.addStimulus') }}</h2>
        <div class="space-y-1">
          <label class="text-sm font-medium" for="b-sttitle">{{ t('stimuli.fields.title') }}</label>
          <Input id="b-sttitle" v-model="stimulusForm.title" />
        </div>
        <div class="space-y-1">
          <label class="text-sm font-medium" for="b-stbody">{{ t('stimuli.fields.body') }}</label>
          <textarea
            id="b-stbody"
            v-model="stimulusForm.body"
            rows="3"
            class="flex w-full border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
        <div class="space-y-1">
          <label class="text-sm font-medium" for="b-stimage">{{ t('builder.stimulusImage') }}</label>
          <input
            id="b-stimage"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            :disabled="uploadingImage"
            class="block w-full text-sm"
            @change="onImageFileSelected"
          >
          <p v-if="uploadingImage" class="text-xs text-muted-foreground">{{ t('common.loading') }}</p>
          <p v-if="imageError" class="text-xs text-destructive">{{ imageError }}</p>
          <div v-if="stimulusImagePreview" class="flex items-center gap-3">
            <img :src="stimulusImagePreview" :alt="t('builder.stimulusImage')" class="h-20 w-auto border object-contain">
            <Button type="button" variant="outline" size="sm" @click="clearStimulusImage">
              {{ t('common.delete') }}
            </Button>
          </div>
        </div>

        <div class="space-y-2 border-l-2 border-muted-foreground/30 pl-3">
          <p class="text-sm font-medium">{{ t('builder.armSection') }}</p>
          <p class="text-xs text-muted-foreground">{{ t('builder.armSectionHint') }}</p>
          <div class="grid gap-3 sm:grid-cols-2">
            <div class="space-y-1">
              <label class="text-xs text-muted-foreground" for="b-stslot">{{ t('builder.armSlotKey') }}</label>
              <Input id="b-stslot" v-model="stimulusForm.slotKey" placeholder="checkout_variant" />
            </div>
            <div class="space-y-1">
              <label class="text-xs text-muted-foreground" for="b-stweight">{{ t('builder.armWeight') }}</label>
              <Input id="b-stweight" v-model="stimulusForm.armWeight" type="number" min="0" step="0.1" :disabled="!stimulusForm.slotKey" />
            </div>
          </div>
          <p v-if="stimulusForm.slotKey" class="text-xs text-amber-600">
            {{ t('builder.armSlotKeyPersists', { key: stimulusForm.slotKey }) }}
            <button type="button" class="underline" @click="stimulusForm.slotKey = ''">{{ t('builder.armSlotKeyClear') }}</button>
          </p>
        </div>

        <div class="space-y-2">
          <div class="flex items-center justify-between">
            <label class="text-sm font-medium">{{ t('builder.conjointAttributes') }}</label>
            <Button type="button" variant="outline" size="sm" @click="addAttributeRow">
              {{ t('builder.addAttribute') }}
            </Button>
          </div>
          <div v-for="(row, idx) in stimulusAttributeRows" :key="idx" class="grid gap-2 sm:grid-cols-[1fr_1fr_auto] items-end">
            <div class="space-y-1">
              <label class="text-xs text-muted-foreground">{{ t('builder.attribute') }}</label>
              <select
                v-model="row.attributeId"
                class="field-select"
                @change="onAttributeRowChange(row)"
              >
                <option value="">{{ t('common.select') }}</option>
                <option v-for="attr in stimulusAttributeOptions" :key="attr.id" :value="attr.id">{{ attr.label }}</option>
              </select>
            </div>
            <div class="space-y-1">
              <label class="text-xs text-muted-foreground">{{ t('builder.attributeValue') }}</label>
              <select
                v-model="row.valueId"
                class="field-select"
                :disabled="!row.attributeId || loadingAttributeValues[row.attributeId]"
              >
                <option value="">{{ t('common.select') }}</option>
                <option v-for="v in valueOptionsFor(row.attributeId)" :key="v.id" :value="v.id">{{ v.label }}</option>
              </select>
            </div>
            <Button type="button" variant="outline" size="sm" @click="removeAttributeRow(idx)">
              {{ t('builder.removeItem') }}
            </Button>
          </div>
          <p v-if="stimulusAttributeRows.length === 0" class="text-xs text-muted-foreground">
            {{ t('builder.conjointAttributesHint') }}
          </p>
        </div>

        <Button :disabled="savingStimulus || !canAddStimulus" @click="onAddStimulus">
          {{ savingStimulus ? t('common.loading') : t('builder.addStimulus') }}
        </Button>
        </CardContent>
      </Card>

      <Card>
        <CardContent class="p-0">
        <ul>
          <li v-for="s in stimuli" :key="s.id" class="flex items-center gap-3 border-b p-4 last:border-b-0">
            <img
              v-if="stimulusImageUrl(s)"
              :src="stimulusImageUrl(s)!"
              :alt="s.title"
              class="h-12 w-12 shrink-0 border object-cover"
            >
            <div>
              <p class="font-medium">{{ s.title }}</p>
              <p v-if="s.body" class="text-sm text-muted-foreground">{{ s.body }}</p>
            </div>
          </li>
          <li v-if="stimuli.length === 0" class="p-10 text-center text-sm text-muted-foreground">
            {{ t('stimuli.empty') }}
          </li>
        </ul>
        </CardContent>
      </Card>
    </section>

    <!-- Step 4: instrument (optional) -->
    <Card v-else-if="currentStep === 4 && isChannelDiffusion">
      <CardContent class="space-y-4 pt-6">
      <h2 class="text-lg font-medium">{{ t('builder.addInstrument') }}</h2>
      <p class="text-sm text-muted-foreground">{{ t('builder.instrumentNotUsedForDiffusion') }}</p>
      </CardContent>
    </Card>

    <Card v-else-if="currentStep === 4">
      <CardContent class="space-y-4 pt-6">
      <h2 class="text-lg font-medium">{{ t('builder.addInstrument') }}</h2>
      <div class="space-y-1">
        <label class="text-sm font-medium" for="b-inname">{{ t('instruments.fields.name') }}</label>
        <Input id="b-inname" v-model="instrumentName" :disabled="!!instrument" />
      </div>

      <div class="space-y-3">
        <div class="flex items-center justify-between">
          <p class="text-sm font-medium">{{ t('instruments.builder.items') }}</p>
          <Button type="button" variant="outline" size="sm" :disabled="!!instrument" @click="addDraftItem">
            {{ t('builder.addItem') }}
          </Button>
        </div>
        <div v-for="(item, idx) in draftItems" :key="idx" class="space-y-3 border p-4">
          <div class="flex items-center justify-between">
            <span class="text-sm font-medium">{{ t('instruments.builder.item') }} {{ idx + 1 }}</span>
            <Button
              v-if="draftItems.length > 1"
              type="button"
              variant="outline"
              size="sm"
              :disabled="!!instrument"
              @click="removeDraftItem(idx)"
            >
              {{ t('builder.removeItem') }}
            </Button>
          </div>
          <div class="grid gap-3 sm:grid-cols-2">
            <div class="space-y-1">
              <label class="text-sm font-medium">{{ t('instruments.fields.itemType') }}</label>
              <RegistrySelect
                v-model="item.itemType"
                :options="itemTypes"
                :placeholder="t('common.select')"
                :disabled="!!instrument"
              />
            </div>
            <div class="space-y-1">
              <label class="text-sm font-medium">{{ t('instruments.fields.itemKey') }}</label>
              <Input v-model="item.itemKey" :disabled="!!instrument" />
            </div>
          </div>
          <div class="space-y-1">
            <label class="text-sm font-medium">{{ t('instruments.fields.promptText') }}</label>
            <Input v-model="item.promptText" :disabled="!!instrument" />
            <p class="text-xs text-muted-foreground">{{ t('builder.stimulusPlaceholderHint') }}</p>
          </div>
        </div>
      </div>

      <div class="flex flex-wrap gap-2">
        <Button :disabled="savingInstrument || !canCreateInstrument || !!instrument" @click="onCreateInstrument">
          {{ savingInstrument ? t('common.loading') : t('builder.addInstrument') }}
        </Button>
        <Button variant="outline" :disabled="!!instrument" @click="skipInstrument">
          {{ t('builder.skipInstrument') }}
        </Button>
      </div>
      <p v-if="instrument" class="text-sm text-primary">{{ t('builder.instrumentCreated') }}</p>
      </CardContent>
    </Card>

    <!-- Step 5: run -->
    <section v-else-if="currentStep === 5" class="space-y-4">
      <Card>
        <CardContent class="space-y-4 pt-6">
        <h2 class="text-lg font-medium">{{ t('builder.createRun') }}</h2>
        <div class="space-y-1">
          <label class="text-sm font-medium" for="b-runname">{{ t('runs.fields.name') }}</label>
          <Input id="b-runname" v-model="runForm.name" :disabled="!!run" />
        </div>
        <div class="space-y-1">
          <label class="text-sm font-medium" for="b-compiler">{{ t('runs.fields.groundingCompiler') }}</label>
          <RegistrySelect
            id="b-compiler"
            v-model="runForm.groundingCompilerKey"
            :options="compilers"
            :placeholder="t('common.select')"
            :disabled="!!run"
          />
        </div>
        <div class="grid gap-4 sm:grid-cols-2">
          <div class="space-y-1">
            <label class="text-sm font-medium" for="b-provider">{{ t('runs.fields.llmProvider') }}</label>
            <RegistrySelect
              id="b-provider"
              v-model="runForm.llmProvider"
              :options="providers"
              :placeholder="t('common.select')"
              :disabled="!!run"
            />
          </div>
          <div class="space-y-1">
            <label class="text-sm font-medium" for="b-model">{{ t('runs.fields.llmModel') }}</label>
            <select
              id="b-model"
              v-model="runForm.llmModel"
              :disabled="!!run || selectedProviderModels.length === 0"
              class="flex h-10 w-full border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
            >
              <option value="">{{ t('common.select') }}</option>
              <option v-for="m in selectedProviderModels" :key="m" :value="m">{{ m }}</option>
            </select>
          </div>
        </div>
        <div class="space-y-1">
          <label class="text-sm font-medium" for="b-seed">{{ t('runs.fields.seed') }}</label>
          <Input id="b-seed" v-model="runForm.seed" type="number" :disabled="!!run" />
        </div>

        <div class="flex flex-wrap gap-2">
          <Button :disabled="savingRun || !canCreateRun || !!run" @click="onCreateRun">
            {{ savingRun ? t('common.loading') : t('builder.createRun') }}
          </Button>
          <Button
            v-if="run && !isChannelDiffusion && !isRunFrozen && !runExecuted"
            variant="outline"
            :disabled="freezing"
            @click="onFreezeRun"
          >
            {{ freezing ? t('common.loading') : t('builder.freeze') }}
          </Button>
        </div>
        <p v-if="run && !isChannelDiffusion && !isRunFrozen && !runExecuted" class="text-sm text-primary">{{ t('builder.runCreated') }}</p>
        </CardContent>
      </Card>

      <!-- Completion: direct_assignment (freeze -> execute) -->
      <Card v-if="run && !isChannelDiffusion && (isRunFrozen || runExecuted)">
        <CardContent class="space-y-4 pt-6">
        <div class="space-y-1">
          <h3 class="font-medium">{{ t('builder.completeTitle') }}</h3>
          <p class="text-sm text-muted-foreground">{{ t('builder.completeSubtitle') }}</p>
        </div>
        <div class="flex flex-wrap gap-2">
          <Button
            v-if="isRunFrozen"
            :disabled="executing"
            @click="onExecuteRun"
          >
            {{ executing ? t('common.loading') : t('builder.execute') }}
          </Button>
          <NuxtLink :to="`/runs/${run.id}`">
            <Button variant="outline">{{ t('builder.goToRun') }}</Button>
          </NuxtLink>
        </div>
        </CardContent>
      </Card>

      <!-- Completion: channel_diffusion (no freeze/execute here — continues on the run's Diffusion tab) -->
      <Card v-if="run && isChannelDiffusion">
        <CardContent class="space-y-4 pt-6">
        <div class="space-y-1">
          <h3 class="font-medium">{{ t('builder.completeTitleDiffusion') }}</h3>
          <p class="text-sm text-muted-foreground">{{ t('builder.completeSubtitleDiffusion') }}</p>
        </div>
        <NuxtLink :to="`/runs/${run.id}/diffusion`">
          <Button>{{ t('builder.goToDiffusion') }}</Button>
        </NuxtLink>
        </CardContent>
      </Card>
    </section>

    <!-- Navigation -->
    <div class="flex items-center justify-between">
      <Button variant="outline" :disabled="currentStep === 1" @click="goBack">
        {{ t('builder.back') }}
      </Button>
      <Button v-if="currentStep < TOTAL_STEPS" :disabled="!canGoNext" @click="goNext">
        {{ t('builder.next') }}
      </Button>
      <span v-else-if="run && (isChannelDiffusion || isRunFrozen || runExecuted)" class="text-sm font-medium text-primary">
        {{ t('builder.done') }}
      </span>
    </div>
  </div>
</template>
