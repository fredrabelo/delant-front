<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from '#imports'
import { navigateTo } from '#app'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import PageHeader from '@/components/PageHeader.vue'
import { useApi } from '@/composables/useApi'
import type { ApiError } from '@/composables/useApi'
import type { Country, DataSource, DataSourceAttribute } from '@/types/api'

const { t, locale } = useI18n()
const api = useApi()

const countries = ref<Country[]>([])
const countryId = ref('')
const sources = ref<Array<DataSource & { name?: string | null }>>([])
const loading = ref(false)
const error = ref<string | null>(null)

// Selected source detail (its axes).
const selectedId = ref<string | null>(null)
const axes = ref<DataSourceAttribute[]>([])
const loadingAxes = ref(false)

const selectedSource = computed(() =>
  sources.value.find(s => s.id === selectedId.value) ?? null,
)

const geoScopes = new Set(['national_and_states', 'city'])

function scopeLabel(s: DataSource): string {
  return geoScopes.has(s.geographyScope ?? 'none')
    ? t('dataSources.catalog.geographic')
    : t('dataSources.catalog.national')
}

function sourceTitle(s: DataSource): string {
  const base = s.name || s.organization
  return s.referencePeriod ? `${base} · ${s.referencePeriod}` : base
}

async function loadInitial() {
  error.value = null
  try {
    const cs = await api.get<Country[]>('/countries')
    countries.value = cs ?? []
    countryId.value = cs?.find(c => c.isDefault)?.id ?? cs?.[0]?.id ?? ''
    if (countryId.value) await loadSources()
  }
  catch (err) {
    error.value = (err as ApiError)?.message ?? t('common.error')
  }
}

async function loadSources() {
  loading.value = true
  error.value = null
  selectedId.value = null
  axes.value = []
  try {
    sources.value = await api.get<DataSource[]>('/data-sources', {
      query: { countryId: countryId.value, locale: locale.value },
    }) ?? []
  }
  catch (err) {
    error.value = (err as ApiError)?.message ?? t('common.error')
  }
  finally {
    loading.value = false
  }
}

async function selectSource(s: DataSource) {
  if (selectedId.value === s.id) {
    selectedId.value = null
    axes.value = []
    return
  }
  selectedId.value = s.id
  loadingAxes.value = true
  axes.value = []
  try {
    axes.value = await api.get<DataSourceAttribute[]>(`/data-sources/${s.id}/attributes`, {
      query: { locale: locale.value },
    }) ?? []
  }
  catch (err) {
    error.value = (err as ApiError)?.message ?? t('common.error')
  }
  finally {
    loadingAxes.value = false
  }
}

function createPopulation(s: DataSource) {
  navigateTo(`/populations/new?sourceId=${s.id}`)
}

onMounted(loadInitial)
</script>

<template>
  <div class="space-y-6 max-w-5xl">
    <PageHeader
      :title="t('dataSources.catalog.title')"
      :description="t('dataSources.catalog.subtitle')"
    />

    <div class="max-w-sm space-y-1">
      <label class="text-sm font-medium" for="ds-country">{{ t('dataSources.catalog.country') }}</label>
      <select id="ds-country" v-model="countryId" class="field-select" @change="loadSources">
        <option v-for="c in countries" :key="c.id" :value="c.id">{{ c.name }}</option>
      </select>
    </div>

    <p v-if="error" class="text-sm text-destructive" role="alert">{{ error }}</p>
    <p v-if="loading" class="text-sm text-muted-foreground">{{ t('common.loading') }}</p>
    <p v-else-if="sources.length === 0" class="text-sm text-muted-foreground">
      {{ t('dataSources.catalog.none') }}
    </p>

    <div v-else class="grid gap-4 md:grid-cols-2">
      <Card
        v-for="s in sources"
        :key="s.id"
        class="transition-colors"
        :class="selectedId === s.id ? 'border-primary ring-1 ring-primary' : ''"
      >
        <CardHeader>
          <CardTitle class="text-base">{{ sourceTitle(s) }}</CardTitle>
          <p class="text-xs text-muted-foreground">
            {{ s.organization }}
            · {{ s.isOfficial ? t('dataSources.catalog.public') : t('dataSources.catalog.private') }}
            · {{ scopeLabel(s) }}
          </p>
        </CardHeader>
        <CardContent class="space-y-3">
          <p v-if="s.description" class="text-sm text-muted-foreground">{{ s.description }}</p>

          <div class="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span>{{ t('dataSources.catalog.confidence') }}: {{ Math.round((s.confidence ?? 1) * 100) }}%</span>
            <span>{{ t('dataSources.catalog.quality') }}: {{ Math.round((s.quality ?? 1) * 100) }}%</span>
            <span v-if="s.onDemandProvider">{{ t('dataSources.catalog.onDemand') }}</span>
          </div>

          <div class="flex gap-2">
            <Button variant="outline" size="sm" @click="selectSource(s)">
              {{ selectedId === s.id ? t('dataSources.catalog.hideAxes') : t('dataSources.catalog.viewAxes') }}
            </Button>
            <Button size="sm" @click="createPopulation(s)">
              {{ t('dataSources.catalog.createPopulation') }}
            </Button>
          </div>

          <!-- Axes detail -->
          <div v-if="selectedId === s.id" class="border-t pt-3">
            <p class="text-sm font-medium mb-2">{{ t('dataSources.catalog.axes') }}</p>
            <p v-if="loadingAxes" class="text-sm text-muted-foreground">{{ t('common.loading') }}</p>
            <p v-else-if="axes.length === 0" class="text-sm text-muted-foreground">
              {{ t('dataSources.catalog.noAxes') }}
            </p>
            <ul v-else class="flex flex-wrap gap-1.5">
              <li
                v-for="a in axes"
                :key="a.id"
                class="border px-2 py-0.5 text-xs"
              >
                {{ a.label || a.attrKey }}
              </li>
            </ul>
          </div>
        </CardContent>
      </Card>
    </div>
  </div>
</template>
