<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from '#imports'
import { useRoute } from '#app'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import RegistrySelect from '@/components/RegistrySelect.vue'
import RunTabs from '@/components/RunTabs.vue'
import SimpleChart from '@/components/SimpleChart.vue'
import PageHeader from '@/components/PageHeader.vue'
import { useApi } from '@/composables/useApi'
import type { ApiError } from '@/composables/useApi'
import { useRun } from '@/composables/useRun'
import type {
  AnalysisResult,
  RegistryOption,
  Visualization,
  VisualizationData,
} from '@/types/api'

const { t } = useI18n()
const route = useRoute()
const api = useApi()

const runId = computed(() => String(route.params.id))
const { run, loading, error, tabs, loadRun } = useRun(runId.value)

/* -------------------- analysis modules (to pick a source from) -------------------- */
const analysisModules = ref<RegistryOption[]>([])
const computedModuleKeys = ref<string[]>([])

async function loadComputedModules() {
  try {
    analysisModules.value = await api.get<RegistryOption[]>('/statistics/analysis-modules/options') ?? []
    const metrics = await api.get<AnalysisResult[]>(`/statistics/runs/${runId.value}/metrics`) ?? []
    computedModuleKeys.value = metrics.map(m => String((m as unknown as { analysisModuleKey: string }).analysisModuleKey))
  }
  catch (err) {
    vizError.value = (err as ApiError)?.message ?? t('common.error')
  }
}

// Only analysis modules that have already been computed can be visualized.
const availableModulesForViz = computed<RegistryOption[]>(() =>
  analysisModules.value.filter(m => computedModuleKeys.value.includes(m.key)),
)

/* -------------------- visualizations -------------------- */
const visualizations = ref<Visualization[]>([])
const chartTypeOptions = ref<RegistryOption[]>([])
const vizData = ref<Record<string, VisualizationData>>({})
const vizError = ref<string | null>(null)
const creatingViz = ref(false)

const vizForm = ref({ title: '', analysisModuleKey: '', chartTypeKey: '', attributeKey: '' })

// Chart types filtered by meta.supportsAnalysis including the chosen module.
const availableChartTypes = computed<RegistryOption[]>(() => {
  if (!vizForm.value.analysisModuleKey) {
    return chartTypeOptions.value
  }
  return chartTypeOptions.value.filter((c) => {
    const supported = (c.meta?.supportsAnalysis as string[] | undefined) ?? []
    return supported.length === 0 || supported.includes(vizForm.value.analysisModuleKey)
  })
})

async function loadVisualizations() {
  try {
    const [list, chartTypes] = await Promise.all([
      api.get<Visualization[]>('/visualizations', { query: { runId: runId.value } }),
      api.get<RegistryOption[]>('/visualizations/chart-types/options'),
    ])
    visualizations.value = list ?? []
    chartTypeOptions.value = chartTypes ?? []
    await Promise.all((list ?? []).map(v => loadVizData(v.id)))
  }
  catch (err) {
    vizError.value = (err as ApiError)?.message ?? t('common.error')
  }
}

async function loadVizData(id: string) {
  try {
    const data = await api.get<VisualizationData>(`/visualizations/${id}/data`)
    vizData.value = { ...vizData.value, [id]: data }
  }
  catch (err) {
    vizError.value = (err as ApiError)?.message ?? t('common.error')
  }
}

async function onCreateViz() {
  creatingViz.value = true
  vizError.value = null
  try {
    const created = await api.post<Visualization>('/visualizations', {
      runId: runId.value,
      title: vizForm.value.title,
      analysisModuleKey: vizForm.value.analysisModuleKey,
      chartTypeKey: vizForm.value.chartTypeKey,
      config: vizForm.value.attributeKey ? { attributeKey: vizForm.value.attributeKey } : undefined,
    })
    visualizations.value = [...visualizations.value, created]
    await loadVizData(created.id)
    vizForm.value = { title: '', analysisModuleKey: '', chartTypeKey: '', attributeKey: '' }
  }
  catch (err) {
    vizError.value = (err as ApiError)?.message ?? t('common.error')
  }
  finally {
    creatingViz.value = false
  }
}

async function onDeleteViz(id: string) {
  try {
    await api.delete(`/visualizations/${id}`)
    visualizations.value = visualizations.value.filter(v => v.id !== id)
  }
  catch (err) {
    vizError.value = (err as ApiError)?.message ?? t('common.error')
  }
}

const canCreateViz = computed(() =>
  vizForm.value.title.trim() !== ''
  && vizForm.value.analysisModuleKey !== ''
  && vizForm.value.chartTypeKey !== '',
)

onMounted(async () => {
  await loadRun()
  await Promise.all([loadComputedModules(), loadVisualizations()])
})
</script>

<template>
  <div class="space-y-6">
    <p v-if="error" class="text-sm text-destructive" role="alert">{{ error }}</p>
    <p v-if="loading" class="text-sm text-muted-foreground">{{ t('common.loading') }}</p>

    <template v-if="run">
      <PageHeader
        :title="t('visualizations.title')"
        :description="t('visualizations.subtitle')"
        :back-to="`/runs/${runId}`"
        :back-label="run.name"
      />
      <RunTabs :tabs="tabs" />

      <p v-if="vizError" class="text-sm text-destructive" role="alert">{{ vizError }}</p>

      <Card class="max-w-2xl">
        <CardContent class="space-y-4 pt-4">
          <h2 class="font-medium">{{ t('visualizations.create') }}</h2>
          <p v-if="availableModulesForViz.length === 0" class="text-sm text-muted-foreground">
            {{ t('visualizations.needComputed') }}
          </p>
          <form v-else class="space-y-4" @submit.prevent="onCreateViz">
            <div class="space-y-1">
              <label class="text-sm font-medium" for="viz-title">{{ t('visualizations.fields.title') }}</label>
              <Input id="viz-title" v-model="vizForm.title" required />
            </div>
            <div class="grid gap-4 sm:grid-cols-2">
              <div class="space-y-1">
                <label class="text-sm font-medium" for="viz-module">{{ t('visualizations.fields.analysisModule') }}</label>
                <RegistrySelect
                  id="viz-module"
                  v-model="vizForm.analysisModuleKey"
                  :options="availableModulesForViz"
                  :placeholder="t('common.select')"
                />
              </div>
              <div class="space-y-1">
                <label class="text-sm font-medium" for="viz-chart">{{ t('visualizations.fields.chartType') }}</label>
                <RegistrySelect
                  id="viz-chart"
                  v-model="vizForm.chartTypeKey"
                  :options="availableChartTypes"
                  :placeholder="t('common.select')"
                />
              </div>
            </div>
            <div class="space-y-1">
              <label class="text-sm font-medium" for="viz-attr">{{ t('visualizations.fields.attributeKey') }}</label>
              <Input id="viz-attr" v-model="vizForm.attributeKey" :placeholder="t('visualizations.attributeHint')" />
            </div>

            <Button type="submit" :disabled="!canCreateViz || creatingViz">
              {{ creatingViz ? t('common.loading') : t('common.create') }}
            </Button>
          </form>
        </CardContent>
      </Card>

      <div class="grid gap-4 lg:grid-cols-2">
        <Card v-for="viz in visualizations" :key="viz.id">
          <CardContent class="space-y-3 pt-4">
            <div class="flex items-center justify-between gap-3">
              <div class="space-y-0.5">
                <p class="font-medium">{{ viz.title }}</p>
                <p class="text-xs text-muted-foreground">
                  {{ t(`registry.chart_type.${viz.chartTypeKey}`) }}
                </p>
              </div>
              <Button variant="outline" size="sm" @click="onDeleteViz(viz.id)">
                {{ t('common.delete') }}
              </Button>
            </div>
            <SimpleChart v-if="vizData[viz.id]" :data="vizData[viz.id]!" />
            <p v-else class="text-sm text-muted-foreground">{{ t('common.loading') }}</p>
          </CardContent>
        </Card>
        <p v-if="visualizations.length === 0" class="text-sm text-muted-foreground lg:col-span-2">
          {{ t('visualizations.empty') }}
        </p>
      </div>
    </template>
  </div>
</template>
