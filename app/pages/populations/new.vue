<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from '#imports'
import { navigateTo, useRoute } from '#app'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { BarChart } from '@/components/ui/chart'
import PageHeader from '@/components/PageHeader.vue'
import { useApi } from '@/composables/useApi'
import type { ApiError } from '@/composables/useApi'
import type {
  Attribute,
  AttributeTargetShare,
  Country,
  DataSource,
  DataSourceAttribute,
  Geography,
  Population,
} from '@/types/api'

const { t, locale } = useI18n()
const api = useApi()
const route = useRoute()

// Reference data
const countries = ref<Country[]>([])
const dataSources = ref<DataSource[]>([])
const states = ref<Geography[]>([])
const cities = ref<Geography[]>([])

// Selections
const name = ref('')
const countryId = ref('')
const selectedSourceIds = ref<Set<string>>(new Set())
// axes offered by each selected source (fetched on demand), keyed by source id.
const axesBySource = ref<Record<string, DataSourceAttribute[]>>({})
const customAttributes = ref<DataSourceAttribute[]>([])
const selectedAttributeIds = ref<Set<string>>(new Set())
const size = ref<number>(1000)
const stateId = ref('')
const cityId = ref('')
const seed = ref<string>('')

const loadingSources = ref(false)
const loadingAxes = ref(false)
const submitting = ref(false)
const error = ref<string | null>(null)

const selectedSources = computed(() =>
  dataSources.value.filter(s => selectedSourceIds.value.has(s.id)),
)

// Any selected source with geographic breakdowns unlocks the state/city picker.
const geoScopes = new Set(['national_and_states', 'city'])
const showGeography = computed(() =>
  selectedSources.value.some(s => geoScopes.has(s.geographyScope ?? 'none')),
)

// The first selected on-demand source (e.g. IBGE). If present, the researcher
// can pull a city that isn't imported yet — self-service, cached for everyone.
const onDemandSource = computed(() =>
  selectedSources.value.find(s => !!s.onDemandProvider) ?? null,
)

// --- self-service city fetch (on-demand sources only) ---
const showCitySearch = ref(false)
const citySearch = ref('')
const cityResults = ref<Array<{ ibgeCode: string, name: string, uf: string }>>([])
const searchingCities = ref(false)
const fetchingCity = ref(false)
const cityFetchError = ref<string | null>(null)
const cityFetchStatus = ref<string | null>(null)

let citySearchTimer: ReturnType<typeof setTimeout> | null = null
function onCitySearchInput() {
  if (citySearchTimer) clearTimeout(citySearchTimer)
  const src = onDemandSource.value
  const q = citySearch.value.trim()
  if (!src || q.length < 2) {
    cityResults.value = []
    return
  }
  citySearchTimer = setTimeout(async () => {
    searchingCities.value = true
    try {
      cityResults.value = await api.get<Array<{ ibgeCode: string, name: string, uf: string }>>(
        `/data-sources/${src.id}/cities`,
        { query: { q } },
      ) ?? []
    }
    catch (err) {
      cityFetchError.value = (err as ApiError)?.message ?? t('common.error')
    }
    finally {
      searchingCities.value = false
    }
  }, 300)
}

// Trigger the fetch (202), poll status, then reload cities and select the new one.
async function fetchCity(city: { ibgeCode: string, name: string, uf: string }) {
  const src = onDemandSource.value
  if (!src) return
  fetchingCity.value = true
  cityFetchError.value = null
  cityFetchStatus.value = t('populations.builder.cityFetchStarting')
  try {
    await api.post(`/data-sources/${src.id}/cities`, {
      ibgeCode: city.ibgeCode,
      name: city.name,
    })
    // Poll until done/error (the fetch hits ~6 external endpoints).
    for (let i = 0; i < 40; i++) {
      await new Promise(r => setTimeout(r, 1500))
      const st = await api.get<{ status: string, progress: number }>(
        `/data-sources/${src.id}/cities/${city.ibgeCode}/status`,
      )
      cityFetchStatus.value = t('populations.builder.cityFetchProgress', { p: st?.progress ?? 0 })
      if (st?.status === 'done') break
      if (st?.status === 'error') {
        throw new Error(t('populations.builder.cityFetchFailed'))
      }
    }
    // Refresh the city list for the UF of the fetched city and select it.
    // States carry the UF sigla in `code` (e.g. 'PE').
    const targetState = states.value.find(s => s.code === city.uf)
    if (targetState) {
      stateId.value = targetState.id
      await onStateChange()
      const created = cities.value.find(c => c.ibgeCode === city.ibgeCode)
      if (created) cityId.value = created.id
    }
    cityFetchStatus.value = null
    showCitySearch.value = false
    citySearch.value = ''
    cityResults.value = []
  }
  catch (err) {
    cityFetchError.value = (err as ApiError)?.message ?? t('common.error')
    cityFetchStatus.value = null
  }
  finally {
    fetchingCity.value = false
  }
}

// Axes available for selection = axes from all selected sources + custom axes.
const availableAxes = computed<DataSourceAttribute[]>(() => {
  const out: DataSourceAttribute[] = [...customAttributes.value]
  const seen = new Set(out.map(a => a.id))
  for (const sid of selectedSourceIds.value) {
    for (const axis of axesBySource.value[sid] ?? []) {
      if (!seen.has(axis.id)) {
        out.push(axis)
        seen.add(axis.id)
      }
    }
  }
  return out
})

const selectedAxes = computed(() =>
  availableAxes.value.filter(a => selectedAttributeIds.value.has(a.id)),
)

// The effective geography id sent to the backend: city wins over state.
const geographyId = computed(() => cityId.value || stateId.value || '')

// Packs backing the selected axes — provenance for the synthesized population.
const selectedPackIds = computed(() => {
  const ids = new Set<string>()
  for (const axis of selectedAxes.value) {
    if (axis.packId != null) ids.add(String(axis.packId))
  }
  return [...ids]
})

const canSubmit = computed(() =>
  name.value.trim().length > 0
  && size.value > 0
  && selectedAttributeIds.value.size > 0,
)

async function loadInitial() {
  error.value = null
  try {
    const cs = await api.get<Country[]>('/countries')
    countries.value = cs ?? []
    countryId.value = cs?.find(c => c.isDefault)?.id ?? cs?.[0]?.id ?? ''
    if (countryId.value) {
      await onCountryChange()
    }
    // Pre-select a source when arriving from the catalog (?sourceId=).
    const sourceId = route.query.sourceId
    if (sourceId) {
      const preset = dataSources.value.find(s => s.id === String(sourceId))
      if (preset) await toggleSource(preset)
    }
  }
  catch (err) {
    error.value = (err as ApiError)?.message ?? t('common.error')
  }
}

// Picking a country resets everything downstream and loads that country's
// data sources (IBGE for Brazil, ANES for the US, etc.).
async function onCountryChange() {
  loadingSources.value = true
  error.value = null
  selectedSourceIds.value = new Set()
  axesBySource.value = {}
  customAttributes.value = []
  selectedAttributeIds.value = new Set()
  states.value = []
  cities.value = []
  stateId.value = ''
  cityId.value = ''
  try {
    const [srcs, sts] = await Promise.all([
      api.get<DataSource[]>('/data-sources', {
        query: { countryId: countryId.value, locale: locale.value },
      }),
      api.get<Geography[]>('/geographies', {
        query: { countryId: countryId.value, level: 'state' },
      }),
    ])
    dataSources.value = srcs ?? []
    states.value = sts ?? []
  }
  catch (err) {
    error.value = (err as ApiError)?.message ?? t('common.error')
  }
  finally {
    loadingSources.value = false
  }
}

// Selecting a source card loads its axes (once) and pre-selects them.
async function toggleSource(source: DataSource) {
  const next = new Set(selectedSourceIds.value)
  if (next.has(source.id)) {
    next.delete(source.id)
    for (const axis of axesBySource.value[source.id] ?? []) {
      selectedAttributeIds.value.delete(axis.id)
    }
    selectedAttributeIds.value = new Set(selectedAttributeIds.value)
  }
  else {
    next.add(source.id)
    if (!axesBySource.value[source.id]) {
      await loadSourceAxes(source.id)
    }
    for (const axis of axesBySource.value[source.id] ?? []) {
      selectedAttributeIds.value.add(axis.id)
    }
    selectedAttributeIds.value = new Set(selectedAttributeIds.value)
  }
  selectedSourceIds.value = next
}

async function loadSourceAxes(sourceId: string) {
  loadingAxes.value = true
  try {
    const axes = await api.get<DataSourceAttribute[]>(`/data-sources/${sourceId}/attributes`, {
      query: { locale: locale.value },
    })
    axesBySource.value = { ...axesBySource.value, [sourceId]: axes ?? [] }
  }
  catch (err) {
    error.value = (err as ApiError)?.message ?? t('common.error')
  }
  finally {
    loadingAxes.value = false
  }
}

// Choosing a state loads its cities (IBGE municipalities enter on demand).
async function onStateChange() {
  cityId.value = ''
  cities.value = []
  if (!stateId.value) return
  try {
    cities.value = await api.get<Geography[]>('/geographies', {
      query: { countryId: countryId.value, level: 'city', parentId: stateId.value },
    }) ?? []
  }
  catch (err) {
    error.value = (err as ApiError)?.message ?? t('common.error')
  }
}

function toggleAttribute(attr: DataSourceAttribute) {
  const next = new Set(selectedAttributeIds.value)
  if (next.has(attr.id)) next.delete(attr.id)
  else next.add(attr.id)
  selectedAttributeIds.value = next
}

function sourceLabel(source: DataSource): string {
  const base = source.name || source.organization
  return source.referencePeriod ? `${base} · ${source.referencePeriod}` : base
}

/* -------------------- live composition preview (target %, SPEC 5.4) -------------------- */
const targetShares = ref<AttributeTargetShare[]>([])
const loadingShares = ref(false)

const sharesByAttribute = computed(() => {
  const map = new Map<string, AttributeTargetShare[]>()
  for (const s of targetShares.value) {
    const arr = map.get(s.attributeId) ?? []
    arr.push(s)
    map.set(s.attributeId, arr)
  }
  return map
})

function pctFormat(v: number): string {
  return `${(v * 100).toFixed(0)}%`
}

async function loadTargetShares() {
  const ids = [...selectedAttributeIds.value].filter((id) => {
    // Only source-backed axes carry a target share; custom axes have none.
    return !customAttributes.value.some(a => a.id === id)
  })
  if (ids.length === 0) {
    targetShares.value = []
    return
  }
  loadingShares.value = true
  try {
    targetShares.value = await api.get<AttributeTargetShare[]>('/attributes/shares', {
      query: {
        attributeIds: ids.join(','),
        geographyId: geographyId.value || undefined,
        locale: locale.value,
      },
    }) ?? []
  }
  catch (err) {
    error.value = (err as ApiError)?.message ?? t('common.error')
  }
  finally {
    loadingShares.value = false
  }
}

watch([selectedAttributeIds, geographyId], loadTargetShares, { deep: true })

/* -------------------- custom axis (SPEC 5.4 "+ criar eixo customizado") -------------------- */
const showCustomAxisForm = ref(false)
const creatingAxis = ref(false)
const customAxisError = ref<string | null>(null)
const customAxis = ref({
  attrKey: '',
  labelPtBr: '',
  labelEn: '',
  values: [{ valueKey: '', labelPtBr: '', labelEn: '' }],
})

function addCustomAxisValue() {
  customAxis.value.values.push({ valueKey: '', labelPtBr: '', labelEn: '' })
}
function removeCustomAxisValue(i: number) {
  customAxis.value.values.splice(i, 1)
}

const canCreateCustomAxis = computed(() =>
  customAxis.value.attrKey.trim() !== ''
  && customAxis.value.labelPtBr.trim() !== ''
  && customAxis.value.values.length > 0
  && customAxis.value.values.every(v => v.valueKey.trim() !== '' && v.labelPtBr.trim() !== ''),
)

async function onCreateCustomAxis() {
  creatingAxis.value = true
  customAxisError.value = null
  try {
    const created = await api.post<Attribute>('/attributes', {
      domain: 'population',
      attrKey: customAxis.value.attrKey.trim(),
      labels: {
        'pt-BR': customAxis.value.labelPtBr.trim(),
        'en-US': customAxis.value.labelEn.trim() || customAxis.value.labelPtBr.trim(),
      },
      values: customAxis.value.values.map((v, i) => ({
        valueKey: v.valueKey.trim(),
        sortOrder: i,
        labels: {
          'pt-BR': v.labelPtBr.trim(),
          'en-US': v.labelEn.trim() || v.labelPtBr.trim(),
        },
      })),
    })
    customAttributes.value = [
      ...customAttributes.value,
      { id: created.id, attrKey: created.attrKey, label: customAxis.value.labelPtBr.trim(), packId: null },
    ]
    selectedAttributeIds.value = new Set([...selectedAttributeIds.value, created.id])
    showCustomAxisForm.value = false
    customAxis.value = { attrKey: '', labelPtBr: '', labelEn: '', values: [{ valueKey: '', labelPtBr: '', labelEn: '' }] }
  }
  catch (err) {
    customAxisError.value = (err as ApiError)?.message ?? t('common.error')
  }
  finally {
    creatingAxis.value = false
  }
}

async function onSubmit() {
  submitting.value = true
  error.value = null
  try {
    // The backend validates numeric ids as integers and seed as a string, so
    // coerce here (form values are strings from <select>/<input>).
    const toInt = (v: string) => Number.parseInt(v, 10)
    const created = await api.post<Population>('/populations/synthesize', {
      name: name.value,
      countryId: countryId.value ? toInt(countryId.value) : undefined,
      geographyId: geographyId.value ? toInt(geographyId.value) : undefined,
      size: size.value,
      seed: seed.value.trim() === '' ? undefined : seed.value.trim(),
      packIds: selectedPackIds.value.map(toInt),
      attributeIds: Array.from(selectedAttributeIds.value).map(toInt),
    })
    await navigateTo(`/populations/${created.id}`)
  }
  catch (err) {
    error.value = (err as ApiError)?.message ?? t('common.error')
  }
  finally {
    submitting.value = false
  }
}

onMounted(loadInitial)
</script>

<template>
  <div class="space-y-6 max-w-3xl">
    <PageHeader
      :title="t('populations.builder.title')"
      :description="t('populations.builder.subtitle')"
      back-to="/populations"
      :back-label="t('populations.title')"
    />

    <p v-if="error" class="text-sm text-destructive" role="alert">{{ error }}</p>

    <!-- Step 1: country + data sources -->
    <Card>
      <CardHeader>
        <CardTitle class="text-lg">{{ t('populations.builder.step1') }}</CardTitle>
      </CardHeader>
      <CardContent class="space-y-4">

      <div class="space-y-1 max-w-sm">
        <label class="text-sm font-medium" for="pop-country">{{ t('populations.fields.country') }}</label>
        <select
          id="pop-country"
          v-model="countryId"
          class="field-select"
          @change="onCountryChange"
        >
          <option value="">{{ t('common.select') }}</option>
          <option v-for="c in countries" :key="c.id" :value="c.id">{{ c.name }}</option>
        </select>
      </div>

      <div class="space-y-2">
        <p class="text-sm font-medium">{{ t('populations.builder.dataSources') }}</p>
        <p class="text-xs text-muted-foreground">{{ t('populations.builder.dataSourcesHint') }}</p>
        <p v-if="loadingSources" class="text-sm text-muted-foreground">{{ t('common.loading') }}</p>
        <p v-else-if="dataSources.length === 0" class="text-sm text-muted-foreground">
          {{ t('populations.builder.noDataSources') }}
        </p>
        <div v-else class="grid gap-3 sm:grid-cols-2">
          <button
            v-for="source in dataSources"
            :key="source.id"
            type="button"
            class="text-left border rounded-lg p-3 transition-colors"
            :class="selectedSourceIds.has(source.id) ? 'border-primary ring-1 ring-primary bg-primary/5' : 'hover:border-muted-foreground/40'"
            :aria-pressed="selectedSourceIds.has(source.id)"
            @click="toggleSource(source)"
          >
            <span class="block text-sm font-medium">{{ sourceLabel(source) }}</span>
            <span class="block text-xs text-muted-foreground mt-0.5">
              {{ source.organization }}
              <template v-if="source.isOfficial"> · {{ t('populations.builder.sourcePublic') }}</template>
              <template v-else> · {{ t('populations.builder.sourcePrivate') }}</template>
            </span>
          </button>
        </div>
      </div>

      <!-- Geography: only for geographic sources (e.g. IBGE). State → city. -->
      <div v-if="showGeography" class="grid gap-4 sm:grid-cols-2">
        <div class="space-y-1">
          <label class="text-sm font-medium" for="pop-state">{{ t('populations.builder.state') }}</label>
          <select id="pop-state" v-model="stateId" class="field-select" @change="onStateChange">
            <option value="">{{ t('populations.builder.wholeCountry') }}</option>
            <option v-for="g in states" :key="g.id" :value="g.id">{{ g.name }}</option>
          </select>
        </div>
        <div v-if="stateId" class="space-y-1">
          <label class="text-sm font-medium" for="pop-city">{{ t('populations.builder.city') }}</label>
          <select id="pop-city" v-model="cityId" class="field-select">
            <option value="">{{ t('populations.builder.wholeState') }}</option>
            <option v-for="g in cities" :key="g.id" :value="g.id">{{ g.name }}</option>
          </select>
          <p v-if="cities.length === 0" class="text-xs text-muted-foreground">
            {{ t('populations.builder.noCities') }}
          </p>
        </div>
      </div>
      <p v-if="showGeography" class="text-xs text-muted-foreground">{{ t('populations.builder.geographyHint') }}</p>

      <!-- Self-service city fetch: only for on-demand sources (e.g. IBGE). -->
      <div v-if="onDemandSource" class="space-y-2 border-t pt-3">
        <Button variant="outline" size="sm" @click="showCitySearch = !showCitySearch">
          {{ showCitySearch ? t('common.cancel') : t('populations.builder.findCity') }}
        </Button>
        <div v-if="showCitySearch" class="space-y-2 max-w-md">
          <p class="text-xs text-muted-foreground">{{ t('populations.builder.findCityHint') }}</p>
          <Input
            v-model="citySearch"
            :placeholder="t('populations.builder.findCityPlaceholder')"
            :disabled="fetchingCity"
            @input="onCitySearchInput"
          />
          <p v-if="cityFetchError" class="text-sm text-destructive" role="alert">{{ cityFetchError }}</p>
          <p v-if="cityFetchStatus" class="text-sm text-muted-foreground">{{ cityFetchStatus }}</p>
          <p v-if="searchingCities" class="text-xs text-muted-foreground">{{ t('common.loading') }}</p>
          <ul v-else-if="cityResults.length > 0" class="border divide-y">
            <li v-for="c in cityResults" :key="c.ibgeCode">
              <button
                type="button"
                class="w-full text-left px-3 py-2 text-sm hover:bg-muted disabled:opacity-50"
                :disabled="fetchingCity"
                @click="fetchCity(c)"
              >
                {{ c.name }} <span class="text-muted-foreground">· {{ c.uf }}</span>
              </button>
            </li>
          </ul>
        </div>
      </div>
      </CardContent>
    </Card>

    <!-- Step 2: axes (from the selected sources) + live % preview -->
    <Card>
      <CardHeader>
        <CardTitle class="text-lg">{{ t('populations.builder.step2') }}</CardTitle>
      </CardHeader>
      <CardContent class="space-y-4">
      <p v-if="selectedSources.length === 0 && customAttributes.length === 0" class="text-sm text-muted-foreground">
        {{ t('populations.builder.selectSourceFirst') }}
      </p>
      <template v-else>
        <p v-if="loadingAxes" class="text-sm text-muted-foreground">{{ t('common.loading') }}</p>
        <p v-else-if="availableAxes.length === 0" class="text-sm text-muted-foreground">
          {{ t('populations.builder.noAttributes') }}
        </p>
        <ul v-else class="grid gap-2 sm:grid-cols-2">
          <li v-for="attr in availableAxes" :key="attr.id">
            <label class="flex items-center gap-2 border p-2 cursor-pointer">
              <input
                type="checkbox"
                :checked="selectedAttributeIds.has(attr.id)"
                @change="toggleAttribute(attr)"
              >
              <span class="text-sm">{{ attr.label || attr.attrKey }}</span>
            </label>
          </li>
        </ul>
      </template>

      <Button variant="outline" size="sm" @click="showCustomAxisForm = !showCustomAxisForm">
        {{ showCustomAxisForm ? t('common.cancel') : t('populations.builder.addCustomAxis') }}
      </Button>

      <Card v-if="showCustomAxisForm" class="max-w-xl">
        <CardContent class="space-y-4 pt-4">
          <p v-if="customAxisError" class="text-sm text-destructive" role="alert">{{ customAxisError }}</p>
          <div class="space-y-1">
            <label class="text-sm font-medium" for="axis-key">{{ t('populations.builder.axisKey') }}</label>
            <Input id="axis-key" v-model="customAxis.attrKey" :placeholder="t('populations.builder.axisKeyHint')" />
          </div>
          <div class="grid gap-4 sm:grid-cols-2">
            <div class="space-y-1">
              <label class="text-sm font-medium" for="axis-label-pt">{{ t('populations.builder.axisLabelPt') }}</label>
              <Input id="axis-label-pt" v-model="customAxis.labelPtBr" />
            </div>
            <div class="space-y-1">
              <label class="text-sm font-medium" for="axis-label-en">{{ t('populations.builder.axisLabelEn') }}</label>
              <Input id="axis-label-en" v-model="customAxis.labelEn" />
            </div>
          </div>

          <div class="space-y-2">
            <p class="text-sm font-medium">{{ t('populations.builder.axisValues') }}</p>
            <div v-for="(v, i) in customAxis.values" :key="i" class="grid gap-2 sm:grid-cols-[1fr_1fr_1fr_auto] items-end border p-2">
              <div class="space-y-1">
                <label class="text-xs text-muted-foreground">{{ t('populations.builder.axisValueKey') }}</label>
                <Input v-model="v.valueKey" />
              </div>
              <div class="space-y-1">
                <label class="text-xs text-muted-foreground">{{ t('populations.builder.axisLabelPt') }}</label>
                <Input v-model="v.labelPtBr" />
              </div>
              <div class="space-y-1">
                <label class="text-xs text-muted-foreground">{{ t('populations.builder.axisLabelEn') }}</label>
                <Input v-model="v.labelEn" />
              </div>
              <Button
                variant="outline"
                size="sm"
                :disabled="customAxis.values.length <= 1"
                @click="removeCustomAxisValue(i)"
              >
                {{ t('common.delete') }}
              </Button>
            </div>
            <Button variant="outline" size="sm" @click="addCustomAxisValue">
              {{ t('populations.builder.addAxisValue') }}
            </Button>
          </div>

          <Button :disabled="!canCreateCustomAxis || creatingAxis" @click="onCreateCustomAxis">
            {{ creatingAxis ? t('common.loading') : t('populations.builder.createAxis') }}
          </Button>
        </CardContent>
      </Card>

      <!-- Live composition preview: % da população por eixo, antes de gerar -->
      <div v-if="selectedAxes.length > 0" class="space-y-4 border-t pt-4">
        <p class="text-sm font-medium">{{ t('populations.builder.compositionPreview') }}</p>
        <p v-if="loadingShares" class="text-sm text-muted-foreground">{{ t('common.loading') }}</p>
        <div v-for="attr in selectedAxes" :key="attr.id" class="space-y-1">
          <p class="text-sm font-medium">{{ attr.label || attr.attrKey }}</p>
          <BarChart
            v-if="(sharesByAttribute.get(attr.id) ?? []).length > 0"
            :labels="(sharesByAttribute.get(attr.id) ?? []).map(s => s.valueLabel)"
            :series="[{ label: t('populations.builder.targetShare'), data: (sharesByAttribute.get(attr.id) ?? []).map(s => s.share) }]"
            :value-format="pctFormat"
            :legend="false"
            :horizontal="(sharesByAttribute.get(attr.id) ?? []).length > 6"
            :height="160"
          />
          <p v-else class="text-xs text-muted-foreground">{{ t('populations.builder.noTargetShare') }}</p>
        </div>
      </div>
      </CardContent>
    </Card>

    <!-- Step 3: size, synthesizer, seed -->
    <Card>
      <CardHeader>
        <CardTitle class="text-lg">{{ t('populations.builder.step3') }}</CardTitle>
      </CardHeader>
      <CardContent class="space-y-4">

      <div class="grid gap-4 sm:grid-cols-2">
        <div class="space-y-1">
          <label class="text-sm font-medium" for="pop-name">{{ t('populations.fields.name') }}</label>
          <Input id="pop-name" v-model="name" required />
        </div>
        <div class="space-y-1">
          <label class="text-sm font-medium" for="pop-size">{{ t('populations.fields.size') }}</label>
          <Input id="pop-size" v-model.number="size" type="number" min="1" required />
        </div>
        <div class="space-y-1">
          <label class="text-sm font-medium" for="pop-seed">{{ t('populations.fields.seed') }}</label>
          <Input id="pop-seed" v-model="seed" type="text" inputmode="numeric" />
          <p class="text-xs text-muted-foreground">{{ t('populations.fields.seedHint') }}</p>
        </div>
      </div>
      </CardContent>
    </Card>

    <div class="flex justify-end">
      <Button :disabled="!canSubmit || submitting" @click="onSubmit">
        {{ submitting ? t('common.loading') : t('populations.builder.generate') }}
      </Button>
    </div>
  </div>
</template>
