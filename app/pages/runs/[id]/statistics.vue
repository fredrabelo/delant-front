<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from '#imports'
import { useRoute } from '#app'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { BarChart } from '@/components/ui/chart'
import RunTabs from '@/components/RunTabs.vue'
import AiAnalysisPanel from '@/components/AiAnalysisPanel.vue'
import PageHeader from '@/components/PageHeader.vue'
import { useApi } from '@/composables/useApi'
import type { ApiError } from '@/composables/useApi'
import { useExportDownload } from '@/composables/useExportDownload'
import { useRun } from '@/composables/useRun'
import type {
  AnalysisApplicability,
  AnalysisResult,
  DistributionResult,
  RegistryOption,
  RepresentativenessResult,
} from '@/types/api'

const { t } = useI18n()
const route = useRoute()
const api = useApi()
const { downloadExport } = useExportDownload()

const runId = computed(() => String(route.params.id))
const { run, loading, error, tabs, loadRun } = useRun(runId.value)

/* -------------------- modules + applicability -------------------- */
const analysisModules = ref<RegistryOption[]>([])
const runningModule = ref<string | null>(null)
const analysisError = ref<string | null>(null)
const results = ref<Record<string, AnalysisResult['resultJson']>>({})

async function loadAnalysisModules() {
  try {
    analysisModules.value = await api.get<RegistryOption[]>('/statistics/analysis-modules/options') ?? []
  }
  catch (err) {
    analysisError.value = (err as ApiError)?.message ?? t('common.error')
  }
}

function requiresResponses(mod: RegistryOption): boolean {
  return Boolean(mod.meta?.requiresResponses)
}

// A response-based module can run once the run has produced responses — i.e.
// it executed or was imported (status 'done'). Modules that don't need
// responses are always runnable. This is what lets the fidelity metrics run on
// the imported paper runs instead of being permanently greyed out.
const runHasResponses = computed(() => run.value?.status === 'done')

function moduleDisabled(mod: RegistryOption): boolean {
  if (runningModule.value === mod.key) {
    return true
  }
  return requiresResponses(mod) && !runHasResponses.value
}

/**
 * Whether a human benchmark exists / the population carries attributes / the
 * run's exposure mode — cheap, read-only, fetched once. Used only to decide
 * which module buttons are worth SHOWING: a module a researcher can click
 * into and immediately hit "no benchmark imported" or "no attributes to
 * segment by" is a dead end, so it's filtered out entirely instead (never
 * auto-run — SPEC 8.1 still requires an explicit click on whatever's left).
 */
const applicability = ref<AnalysisApplicability | null>(null)

async function loadApplicability() {
  try {
    applicability.value = await api.get<AnalysisApplicability>(`/statistics/runs/${runId.value}/applicability`)
  }
  catch {
    applicability.value = null
  }
}

// Modules whose result is only meaningful once the population carries
// structured attributes to group/cross/rank by (SPEC 8.1). Not encoded in
// the registry's `meta` (that's config-level; this is data-level), so it's a
// fixed set here, mirroring the analysis service's own switch cases.
const ATTRIBUTE_DEPENDENT_MODULES = new Set([
  'segment_breakdown',
  'structural_drivers_eta2',
  'amce_conjoint',
  'cross_profile',
])

function isApplicable(mod: RegistryOption): boolean {
  const a = applicability.value
  if (!a) {
    return true
  }
  if (mod.meta?.requiresChannelDiffusion && a.exposureMode !== 'channel_diffusion') {
    return false
  }
  if (mod.meta?.requiresBenchmark && !a.hasBenchmark) {
    return false
  }
  if (ATTRIBUTE_DEPENDENT_MODULES.has(mod.key) && !a.hasAttributes) {
    return false
  }
  return true
}

const applicableModules = computed(() => analysisModules.value.filter(isApplicable))

async function runAnalysis(moduleKey: string, params?: Record<string, string>) {
  runningModule.value = moduleKey
  analysisError.value = null
  try {
    const res = await api.post<AnalysisResult>(
      `/statistics/runs/${runId.value}/analyses/${moduleKey}`,
      undefined,
      params ? { query: params } : {},
    )
    results.value = { ...results.value, [moduleKey]: res.resultJson }
  }
  catch (err) {
    analysisError.value = (err as ApiError)?.message ?? t('common.error')
  }
  finally {
    runningModule.value = null
  }
}

/* -------------------- segmentation axis picker (segment_breakdown / -------- */
/* channel_segment_comparison — both otherwise default to "first attribute -- */
/* found"; this lets the researcher ask for a specific one, e.g. gender). ---- */
const selectedAttribute = ref<Record<string, string>>({})

function onAttributeChange(moduleKey: string, attributeKey: string) {
  selectedAttribute.value = { ...selectedAttribute.value, [moduleKey]: attributeKey }
  void runAnalysis(moduleKey, { attributeKey })
}

/* -------------------- result accessors -------------------- */
function asRepresentativeness(value: AnalysisResult['resultJson']): RepresentativenessResult {
  return value as RepresentativenessResult
}
function asDistribution(value: AnalysisResult['resultJson']): DistributionResult {
  return value as DistributionResult
}
/*
 * Loose accessor for the rest of the modules: their result shapes are simple
 * JSON objects with a `status` field ('ok' | 'no_benchmark' | 'not_applicable'
 * | ...), rendered as a friendly note when it isn't 'ok'.
 */
type R = Record<string, unknown> & { status?: string }
function asR(value: AnalysisResult['resultJson']): R {
  return (value ?? {}) as R
}
function num(value: unknown): number {
  return typeof value === 'number' ? value : Number(value ?? 0)
}
function statusNote(result: R): string | null {
  if (!result.status || result.status === 'ok') {
    return null
  }
  const note = typeof result.note === 'string' ? result.note : ''
  const key = `statistics.status.${result.status}`
  const translated = t(key)
  return translated === key ? (note || result.status) : `${translated}${note ? ` ${note}` : ''}`
}

const exporting = ref<string | null>(null)
async function onExport(moduleKey: string, format: 'json' | 'csv') {
  exporting.value = `${moduleKey}:${format}`
  analysisError.value = null
  try {
    await downloadExport(runId.value, moduleKey, format)
  }
  catch (err) {
    analysisError.value = (err as ApiError)?.message ?? t('common.error')
  }
  finally {
    exporting.value = null
  }
}

function pctText(share: number): string {
  return `${(share * 100).toFixed(1)}%`
}
function pctFormat(v: number): string {
  return `${(v * 100).toFixed(0)}%`
}

/** Shorten a `questionKey` for chart labels (they can run long). */
function shortLabel(key: string, max = 18): string {
  return key.length > max ? `${key.slice(0, max - 1)}…` : key
}

onMounted(async () => {
  await loadRun()
  await Promise.all([loadAnalysisModules(), loadApplicability()])
})
</script>

<template>
  <div class="space-y-6">
    <p v-if="error" class="text-sm text-destructive" role="alert">{{ error }}</p>
    <p v-if="loading" class="text-sm text-muted-foreground">{{ t('common.loading') }}</p>

    <template v-if="run">
      <PageHeader
        :title="t('statistics.title')"
        :description="t('statistics.subtitle')"
        :back-to="`/runs/${runId}`"
        :back-label="run.name"
      />
      <RunTabs :tabs="tabs" />

      <!-- AI synthesis (SPEC 7): narrates the modules below, never computes new numbers. -->
      <AiAnalysisPanel :base-path="`study-runs/${runId}`" level-label="run" />

      <p v-if="analysisError" class="text-sm text-destructive" role="alert">{{ analysisError }}</p>

      <div class="grid gap-3 sm:grid-cols-2">
        <Card v-for="mod in applicableModules" :key="mod.key">
          <CardContent class="flex items-start justify-between gap-3 pt-4">
            <div class="space-y-1">
              <p class="font-medium">{{ t(mod.labelKey) }}</p>
              <p class="text-sm text-muted-foreground">{{ t(`${mod.labelKey}_desc`) }}</p>
              <p v-if="requiresResponses(mod) && !runHasResponses" class="text-xs text-muted-foreground">
                {{ t('statistics.requiresResponses') }}
              </p>
            </div>
            <Button size="sm" :disabled="moduleDisabled(mod)" @click="runAnalysis(mod.key)">
              {{ runningModule === mod.key ? t('common.loading') : t('statistics.run') }}
            </Button>
          </CardContent>
        </Card>
        <p v-if="applicableModules.length === 0" class="text-sm text-muted-foreground sm:col-span-2">
          {{ t('statistics.noApplicableModules') }}
        </p>
      </div>

      <!-- Results -->
      <div v-for="mod in applicableModules" :key="`res-${mod.key}`">
        <Card v-if="results[mod.key]">
          <CardHeader class="flex-row items-center justify-between gap-3 space-y-0">
            <div>
              <CardTitle>{{ t(mod.labelKey) }}</CardTitle>
              <CardDescription v-if="statusNote(asR(results[mod.key]!))">
                {{ statusNote(asR(results[mod.key]!)) }}
              </CardDescription>
            </div>
            <div class="flex items-center gap-2">
              <Button variant="outline" size="sm" :disabled="exporting === `${mod.key}:csv`" @click="onExport(mod.key, 'csv')">
                {{ t('statistics.exportCsv') }}
              </Button>
              <Button variant="outline" size="sm" :disabled="exporting === `${mod.key}:json`" @click="onExport(mod.key, 'json')">
                {{ t('statistics.exportJson') }}
              </Button>
            </div>
          </CardHeader>
          <CardContent v-if="!statusNote(asR(results[mod.key]!))" class="space-y-5">
            <!-- representativeness_chi2 -->
            <div v-if="mod.key === 'representativeness_chi2'" class="space-y-6">
              <div
                v-for="attr in asRepresentativeness(results[mod.key]!).attributes"
                :key="attr.attributeKey"
                class="space-y-2"
              >
                <div class="flex flex-wrap items-center gap-2">
                  <p class="font-medium">{{ attr.attributeKey }}</p>
                  <Badge v-if="attr.chiSquare" :variant="attr.chiSquare.pValue > 0.05 ? 'success' : 'destructive'">
                    {{ attr.chiSquare.pValue > 0.05 ? t('statistics.notDistinguishable') : t('statistics.distinguishable') }}
                  </Badge>
                  <span v-if="attr.chiSquare" class="text-xs text-muted-foreground">
                    {{ t('statistics.pValue') }}: {{ attr.chiSquare.pValue.toFixed(4) }}
                  </span>
                </div>
                <BarChart
                  :labels="attr.values.map(v => v.valueKey)"
                  :series="[
                    { label: t('statistics.columns.observedShare'), data: attr.values.map(v => v.observedShare) },
                    { label: t('statistics.columns.targetShare'), data: attr.values.map(v => v.targetShare ?? 0) },
                  ]"
                  :value-format="pctFormat"
                  :horizontal="attr.values.length > 6"
                />
                <div class="overflow-x-auto border">
                  <table class="w-full text-sm">
                    <thead>
                      <tr class="border-b bg-muted/60 text-left [&>th]:px-3 [&>th]:py-2 [&>th]:text-xs [&>th]:font-semibold [&>th]:text-ink-600">
                        <th class="px-3 py-2 font-medium">{{ t('statistics.columns.valueKey') }}</th>
                        <th class="px-3 py-2 font-medium">{{ t('statistics.columns.observedShare') }}</th>
                        <th class="px-3 py-2 font-medium">{{ t('statistics.columns.targetShare') }}</th>
                        <th class="px-3 py-2 font-medium">{{ t('statistics.columns.diff') }}</th>
                        <th class="px-3 py-2 font-medium">{{ t('statistics.columns.withinMargin') }}</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr v-for="v in attr.values" :key="v.valueKey" class="border-b last:border-b-0">
                        <td class="px-3 py-2">{{ v.valueKey }}</td>
                        <td class="px-3 py-2 tabular-nums">{{ pctText(v.observedShare) }}</td>
                        <td class="px-3 py-2 tabular-nums">{{ pctText(v.targetShare) }}</td>
                        <td class="px-3 py-2 tabular-nums">{{ pctText(v.diff) }}</td>
                        <td class="px-3 py-2">{{ v.withinMargin ? t('common.yes') : t('common.no') }}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            <!-- attribute_distribution -->
            <div v-else-if="mod.key === 'attribute_distribution'" class="space-y-6">
              <div
                v-for="attr in asDistribution(results[mod.key]!).attributes"
                :key="attr.attributeKey"
                class="space-y-2"
              >
                <p class="font-medium">{{ attr.attributeKey }}</p>
                <BarChart
                  :labels="attr.values.map(v => v.valueKey)"
                  :series="[{ label: t('statistics.columns.share'), data: attr.values.map(v => v.share) }]"
                  :value-format="pctFormat"
                  :legend="false"
                  :horizontal="attr.values.length > 6"
                />
              </div>
            </div>

            <!-- decision_fidelity_winner -->
            <div v-else-if="mod.key === 'decision_fidelity_winner'" class="space-y-4">
              <div class="flex flex-wrap items-baseline gap-3">
                <span class="text-3xl font-semibold tabular-nums">{{ pctText(num(asR(results[mod.key]!).decisionFidelity)) }}</span>
                <span class="text-sm text-muted-foreground">
                  {{ t('statistics.decisionFidelity.headline', {
                    agree: num(asR(results[mod.key]!).agreements),
                    total: num(asR(results[mod.key]!).comparableQuestions),
                  }) }}
                </span>
              </div>
              <BarChart
                :labels="(asR(results[mod.key]!).perQuestion as any[]).map(q => shortLabel(q.questionKey))"
                :series="[
                  { label: t('statistics.decisionFidelity.human'), data: (asR(results[mod.key]!).perQuestion as any[]).map(q => q.humanShare) },
                  { label: t('statistics.decisionFidelity.synthetic'), data: (asR(results[mod.key]!).perQuestion as any[]).map(q => q.syntheticShare) },
                ]"
                :value-format="pctFormat"
                :horizontal="(asR(results[mod.key]!).perQuestion as any[]).length > 6"
              />
              <div class="overflow-x-auto border">
                <table class="w-full text-sm">
                  <thead>
                    <tr class="border-b bg-muted/60 text-left [&>th]:px-3 [&>th]:py-2 [&>th]:text-xs [&>th]:font-semibold [&>th]:text-ink-600">
                      <th class="px-3 py-2 font-medium">{{ t('runs.responses.question') }}</th>
                      <th class="px-3 py-2 font-medium">{{ t('statistics.decisionFidelity.human') }}</th>
                      <th class="px-3 py-2 font-medium">{{ t('statistics.decisionFidelity.synthetic') }}</th>
                      <th class="px-3 py-2 font-medium">{{ t('statistics.decisionFidelity.agree') }}</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="(q, i) in (asR(results[mod.key]!).perQuestion as any[])" :key="i" class="border-b last:border-b-0">
                      <td class="px-3 py-2 font-mono text-xs">{{ q.questionKey }}</td>
                      <td class="px-3 py-2">{{ q.humanWinner }} <span class="text-muted-foreground tabular-nums">({{ pctText(q.humanShare) }})</span></td>
                      <td class="px-3 py-2">{{ q.syntheticWinner }} <span class="text-muted-foreground tabular-nums">({{ pctText(q.syntheticShare) }})</span></td>
                      <td class="px-3 py-2">
                        <Badge :variant="q.agree ? 'success' : 'destructive'">{{ q.agree ? t('common.yes') : t('common.no') }}</Badge>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            <!-- response_fidelity_correlation -->
            <div v-else-if="mod.key === 'response_fidelity_correlation'" class="space-y-4">
              <div class="flex flex-wrap items-baseline gap-3">
                <span class="text-3xl font-semibold tabular-nums">{{ num(asR(results[mod.key]!).meanCorrelation).toFixed(3) }}</span>
                <span class="text-sm text-muted-foreground">{{ t('statistics.responseFidelity.headline') }}</span>
              </div>
              <BarChart
                :labels="Object.keys(asR(results[mod.key]!).perQuestion as Record<string, any>).map(k => shortLabel(k))"
                :series="[{ label: t('statistics.responseFidelity.r'), data: Object.values(asR(results[mod.key]!).perQuestion as Record<string, any>).map((v: any) => v.r) }]"
                :legend="false"
                horizontal
              />
              <div class="overflow-x-auto border">
                <table class="w-full text-sm">
                  <thead>
                    <tr class="border-b bg-muted/60 text-left [&>th]:px-3 [&>th]:py-2 [&>th]:text-xs [&>th]:font-semibold [&>th]:text-ink-600">
                      <th class="px-3 py-2 font-medium">{{ t('runs.responses.question') }}</th>
                      <th class="px-3 py-2 font-medium">{{ t('statistics.responseFidelity.r') }}</th>
                      <th class="px-3 py-2 font-medium">{{ t('statistics.columns.n') }}</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="(v, k) in (asR(results[mod.key]!).perQuestion as Record<string, any>)" :key="k" class="border-b last:border-b-0">
                      <td class="px-3 py-2 font-mono text-xs">{{ k }}</td>
                      <td class="px-3 py-2 tabular-nums">{{ num(v.r).toFixed(3) }}</td>
                      <td class="px-3 py-2 tabular-nums">{{ v.n }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            <!-- bootstrap_robustness -->
            <div v-else-if="mod.key === 'bootstrap_robustness'" class="flex flex-wrap items-baseline gap-3">
              <span class="text-3xl font-semibold tabular-nums">{{ num(asR(results[mod.key]!).overallMae).toFixed(3) }}</span>
              <span class="text-sm text-muted-foreground">
                {{ t('statistics.bootstrap.headline', {
                  low: num((asR(results[mod.key]!).ci95 as number[])?.[0]).toFixed(3),
                  high: num((asR(results[mod.key]!).ci95 as number[])?.[1]).toFixed(3),
                }) }}
              </span>
            </div>

            <!-- structural_drivers_eta2 -->
            <div v-else-if="mod.key === 'structural_drivers_eta2'" class="space-y-4">
              <BarChart
                :labels="(asR(results[mod.key]!).drivers as any[]).map(d => shortLabel(`${d.attributeKey} · ${d.questionKey}`, 26))"
                :series="[{ label: t('statistics.drivers.etaSquared'), data: (asR(results[mod.key]!).drivers as any[]).map(d => d.etaSquared) }]"
                :legend="false"
                horizontal
              />
              <div class="overflow-x-auto border">
                <table class="w-full text-sm">
                  <thead>
                    <tr class="border-b bg-muted/60 text-left [&>th]:px-3 [&>th]:py-2 [&>th]:text-xs [&>th]:font-semibold [&>th]:text-ink-600">
                      <th class="px-3 py-2 font-medium">{{ t('runs.responses.question') }}</th>
                      <th class="px-3 py-2 font-medium">{{ t('statistics.drivers.attribute') }}</th>
                      <th class="px-3 py-2 font-medium">{{ t('statistics.drivers.etaSquared') }}</th>
                      <th class="px-3 py-2 font-medium">{{ t('statistics.columns.n') }}</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="(d, i) in (asR(results[mod.key]!).drivers as any[])" :key="i" class="border-b last:border-b-0">
                      <td class="px-3 py-2 font-mono text-xs">{{ d.questionKey }}</td>
                      <td class="px-3 py-2">{{ d.attributeKey }}</td>
                      <td class="px-3 py-2 tabular-nums">{{ num(d.etaSquared).toFixed(3) }}</td>
                      <td class="px-3 py-2 tabular-nums">{{ d.n }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            <!-- amce_conjoint -->
            <div v-else-if="mod.key === 'amce_conjoint'" class="space-y-4">
              <p class="text-sm text-muted-foreground">
                {{ t('statistics.amce.positive', { outcome: String(asR(results[mod.key]!).positiveOutcome) }) }}
              </p>
              <BarChart
                :labels="(asR(results[mod.key]!).effects as any[]).map(e => shortLabel(`${e.attributeKey}: ${e.valueKey}`, 26))"
                :series="[{ label: t('statistics.amce.effect'), data: (asR(results[mod.key]!).effects as any[]).map(e => e.amce) }]"
                :value-format="pctFormat"
                :legend="false"
                horizontal
              />
              <div class="overflow-x-auto border">
                <table class="w-full text-sm">
                  <thead>
                    <tr class="border-b bg-muted/60 text-left [&>th]:px-3 [&>th]:py-2 [&>th]:text-xs [&>th]:font-semibold [&>th]:text-ink-600">
                      <th class="px-3 py-2 font-medium">{{ t('statistics.drivers.attribute') }}</th>
                      <th class="px-3 py-2 font-medium">{{ t('statistics.columns.valueKey') }}</th>
                      <th class="px-3 py-2 font-medium">{{ t('statistics.amce.effect') }}</th>
                      <th class="px-3 py-2 font-medium">{{ t('statistics.columns.n') }}</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="(e, i) in (asR(results[mod.key]!).effects as any[])" :key="i" class="border-b last:border-b-0">
                      <td class="px-3 py-2">{{ e.attributeKey }}</td>
                      <td class="px-3 py-2">{{ e.valueKey }}</td>
                      <td class="px-3 py-2 tabular-nums" :class="num(e.amce) >= 0 ? 'text-primary' : 'text-destructive'">
                        {{ num(e.amce) >= 0 ? '+' : '' }}{{ pctText(num(e.amce)) }}
                      </td>
                      <td class="px-3 py-2 tabular-nums">{{ e.n }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            <!-- cross_profile -->
            <div v-else-if="mod.key === 'cross_profile'" class="space-y-4">
              <p class="text-sm text-muted-foreground">
                {{ t('statistics.crossProfile.headline', {
                  a: String(asR(results[mod.key]!).attributeA),
                  b: String(asR(results[mod.key]!).attributeB),
                  outcome: String(asR(results[mod.key]!).modalOutcome),
                }) }}
              </p>
              <BarChart
                :labels="(asR(results[mod.key]!).cells as any[]).map(c => shortLabel(`${c[String(asR(results[mod.key]!).attributeA)]} × ${c[String(asR(results[mod.key]!).attributeB)]}`, 26))"
                :series="[{ label: t('statistics.crossProfile.modalShare'), data: (asR(results[mod.key]!).cells as any[]).map(c => c.modalShare) }]"
                :value-format="pctFormat"
                :legend="false"
                horizontal
              />
              <div class="overflow-x-auto border">
                <table class="w-full text-sm">
                  <thead>
                    <tr class="border-b bg-muted/60 text-left [&>th]:px-3 [&>th]:py-2 [&>th]:text-xs [&>th]:font-semibold [&>th]:text-ink-600">
                      <th class="px-3 py-2 font-medium">{{ String(asR(results[mod.key]!).attributeA) }}</th>
                      <th class="px-3 py-2 font-medium">{{ String(asR(results[mod.key]!).attributeB) }}</th>
                      <th class="px-3 py-2 font-medium">{{ t('statistics.crossProfile.modalShare') }}</th>
                      <th class="px-3 py-2 font-medium">{{ t('statistics.columns.n') }}</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="(c, i) in (asR(results[mod.key]!).cells as any[])" :key="i" class="border-b last:border-b-0">
                      <td class="px-3 py-2">{{ c[String(asR(results[mod.key]!).attributeA)] }}</td>
                      <td class="px-3 py-2">{{ c[String(asR(results[mod.key]!).attributeB)] }}</td>
                      <td class="px-3 py-2 tabular-nums">{{ pctText(num(c.modalShare)) }}</td>
                      <td class="px-3 py-2 tabular-nums">{{ c.n }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            <!-- adoption_summary -->
            <div v-else-if="mod.key === 'adoption_summary'" class="space-y-6">
              <div v-for="q in (asR(results[mod.key]!).questions as any[])" :key="q.questionKey" class="space-y-2">
                <div class="flex flex-wrap items-center gap-2">
                  <p class="font-medium font-mono text-sm">{{ q.questionKey }}</p>
                  <span v-if="q.mean != null" class="text-xs text-muted-foreground">
                    {{ t('statistics.columns.mean') }}: {{ num(q.mean).toFixed(2) }}
                  </span>
                </div>
                <BarChart
                  :labels="(q.distribution as any[]).map((d: any) => shortLabel(String(d.value)))"
                  :series="[{ label: t('statistics.columns.share'), data: (q.distribution as any[]).map((d: any) => d.share) }]"
                  :value-format="pctFormat"
                  :legend="false"
                  :horizontal="(q.distribution as any[]).length > 6"
                />
              </div>
            </div>

            <!-- segment_breakdown -->
            <div v-else-if="mod.key === 'segment_breakdown'" class="space-y-6">
              <div class="flex flex-wrap items-center justify-between gap-3">
                <p class="text-sm text-muted-foreground">
                  {{ t('statistics.segmentBreakdown.headline', { attribute: String(asR(results[mod.key]!).attributeKey) }) }}
                </p>
                <div
                  v-if="(asR(results[mod.key]!).availableAttributes as string[] | undefined)?.length"
                  class="flex items-center gap-2"
                >
                  <label class="text-xs font-medium text-muted-foreground" :for="`seg-attr-${mod.key}`">
                    {{ t('statistics.segmentPicker.label') }}
                  </label>
                  <select
                    :id="`seg-attr-${mod.key}`"
                    class="field-select"
                    :value="selectedAttribute[mod.key] ?? String(asR(results[mod.key]!).attributeKey)"
                    @change="onAttributeChange(mod.key, ($event.target as HTMLSelectElement).value)"
                  >
                    <option v-for="a in (asR(results[mod.key]!).availableAttributes as string[])" :key="a" :value="a">
                      {{ a }}
                    </option>
                  </select>
                </div>
              </div>
              <div v-for="seg in (asR(results[mod.key]!).segments as any[])" :key="seg.segment" class="space-y-3">
                <p class="font-medium">{{ seg.segment }}</p>
                <div v-for="q in (seg.questions as any[])" :key="q.questionKey" class="space-y-1 pl-3">
                  <p class="text-xs font-mono text-muted-foreground">{{ q.questionKey }}</p>
                  <div class="overflow-x-auto border">
                    <table class="w-full text-sm">
                      <thead>
                        <tr class="border-b bg-muted/60 text-left [&>th]:px-3 [&>th]:py-2 [&>th]:text-xs [&>th]:font-semibold [&>th]:text-ink-600">
                          <th class="px-3 py-2 font-medium">{{ t('statistics.columns.valueKey') }}</th>
                          <th class="px-3 py-2 font-medium">{{ t('statistics.columns.count') }}</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr v-for="(d, i) in (q.distribution as any[])" :key="i" class="border-b last:border-b-0">
                          <td class="px-3 py-2">{{ d.value }}</td>
                          <td class="px-3 py-2 tabular-nums">{{ d.count }}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>

            <!-- channel_segment_comparison -->
            <div v-else-if="mod.key === 'channel_segment_comparison'" class="space-y-6">
              <div class="flex flex-wrap items-center justify-between gap-3">
                <p class="text-sm text-muted-foreground">
                  {{ t('statistics.channelSegment.headline', { attribute: String(asR(results[mod.key]!).attributeKey) }) }}
                </p>
                <div
                  v-if="(asR(results[mod.key]!).availableAttributes as string[] | undefined)?.length"
                  class="flex items-center gap-2"
                >
                  <label class="text-xs font-medium text-muted-foreground" :for="`seg-attr-${mod.key}`">
                    {{ t('statistics.segmentPicker.label') }}
                  </label>
                  <select
                    :id="`seg-attr-${mod.key}`"
                    class="field-select"
                    :value="selectedAttribute[mod.key] ?? String(asR(results[mod.key]!).attributeKey)"
                    @change="onAttributeChange(mod.key, ($event.target as HTMLSelectElement).value)"
                  >
                    <option v-for="a in (asR(results[mod.key]!).availableAttributes as string[])" :key="a" :value="a">
                      {{ a }}
                    </option>
                  </select>
                </div>
              </div>
              <div v-for="seg in (asR(results[mod.key]!).segments as any[])" :key="seg.segment" class="space-y-2">
                <div class="flex flex-wrap items-center gap-2">
                  <p class="font-medium">{{ seg.segment }}</p>
                  <Badge variant="success">{{ t('statistics.channelSegment.winner', { channel: seg.winner }) }}</Badge>
                </div>
                <BarChart
                  :labels="(seg.channels as any[]).map((c: any) => shortLabel(c.channel))"
                  :series="[{ label: t('statistics.channelSegment.meanAdoption'), data: (seg.channels as any[]).map((c: any) => c.meanAdoption) }]"
                  :legend="false"
                />
              </div>
            </div>

            <!-- fallback for any future module: raw JSON, never blank -->
            <pre v-else class="overflow-x-auto border bg-muted/30 p-3 text-xs">{{ JSON.stringify(results[mod.key], null, 2) }}</pre>
          </CardContent>
        </Card>
      </div>
    </template>
  </div>
</template>
