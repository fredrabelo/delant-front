<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from '#imports'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { BarChart } from '@/components/ui/chart'
import LlmConfirmDialog from '@/components/LlmConfirmDialog.vue'
import { useApi } from '@/composables/useApi'
import type { ApiError } from '@/composables/useApi'
import type {
  AiAnalysis,
  AiAnalysisCostEstimate,
  FidelityStatus,
  ResearchQuestion,
} from '@/types/api'

/**
 * AI-synthesized narrative over already-computed data (SPEC 7). Generic
 * across the three levels — pass the API base path for the subject
 * ("study-runs/12", "studies/5", "researches/6") and it drives
 * cost-estimate -> trigger -> poll -> display. The LLM only narrates numbers
 * that already exist elsewhere on the page; this panel never computes
 * anything itself.
 */
const props = defineProps<{
  basePath: string
  /** Shown as the default model hint (haiku/sonnet/opus per level). */
  levelLabel: string
  /** Only meaningful at study/research level — echoes the questions being answered. */
  questions?: ResearchQuestion[]
  /**
   * SPEC 9/11 gate: when set, blocks triggering and shows this reason instead
   * — e.g. "2 runs ainda não terminaram" or "Estudo X ainda sem síntese". The
   * backend enforces the same gate regardless (a stale prop can't bypass it),
   * this is purely so the researcher sees why before clicking, not after a
   * failed request.
   */
  notReadyReason?: string | null
}>()

const { t, locale } = useI18n()
const api = useApi()

const analysis = ref<AiAnalysis | null>(null)
const costEstimate = ref<AiAnalysisCostEstimate | null>(null)
const loading = ref(false)
const estimating = ref(false)
const triggering = ref(false)
const error = ref<string | null>(null)

let pollTimer: ReturnType<typeof setInterval> | null = null

const isPending = computed(() => analysis.value?.status === 'pending' || analysis.value?.status === 'running')

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
}

async function load() {
  loading.value = true
  error.value = null
  try {
    analysis.value = await api.get<AiAnalysis>(`/${props.basePath}/ai-analysis`)
  }
  catch {
    // 404 == none computed yet; not an error state worth surfacing.
    analysis.value = null
  }
  finally {
    loading.value = false
  }
  ensurePolling()
}

function ensurePolling() {
  if (isPending.value && !pollTimer) {
    pollTimer = setInterval(async () => {
      try {
        analysis.value = await api.get<AiAnalysis>(`/${props.basePath}/ai-analysis`)
      }
      catch {
        stopPolling()
        return
      }
      if (analysis.value?.status !== 'pending' && analysis.value?.status !== 'running') {
        stopPolling()
      }
    }, 3000)
  }
}

async function onEstimate() {
  estimating.value = true
  error.value = null
  try {
    costEstimate.value = await api.get<AiAnalysisCostEstimate>(`/${props.basePath}/ai-analysis/cost-estimate`)
  }
  catch (err) {
    error.value = (err as ApiError)?.message ?? t('common.error')
  }
  finally {
    estimating.value = false
  }
}

/**
 * Transparency gate (Fred, 2026-09-04): no button that fires an LLM call may
 * skip a confirmation showing mode/model/calls/cost — this trigger button
 * included. Clicking it estimates first (if not already estimated) and opens
 * LlmConfirmDialog; the actual POST only happens from doTrigger() on confirm.
 */
const confirmOpen = ref(false)

async function onTriggerClick() {
  error.value = null
  if (!costEstimate.value) {
    await onEstimate()
    if (!costEstimate.value) return // estimate failed — error already shown
  }
  confirmOpen.value = true
}

async function doTrigger() {
  triggering.value = true
  error.value = null
  try {
    analysis.value = await api.post<AiAnalysis>(`/${props.basePath}/ai-analysis`, {
      locale: locale.value,
    })
    ensurePolling()
  }
  catch (err) {
    error.value = (err as ApiError)?.message ?? t('common.error')
  }
  finally {
    triggering.value = false
    confirmOpen.value = false
  }
}

function fidelityVariant(status: FidelityStatus): 'success' | 'destructive' | 'warning' | 'muted' {
  switch (status) {
    case 'supported': return 'success'
    case 'not_supported': return 'destructive'
    case 'mixed': return 'warning'
    default: return 'muted'
  }
}

function questionText(id: number): string {
  return props.questions?.find(q => Number(q.id) === id)?.questionText ?? `#${id}`
}

function confidenceVariant(c: string): 'success' | 'warning' | 'muted' {
  if (c === 'high') return 'success'
  if (c === 'medium') return 'warning'
  return 'muted'
}

/**
 * Ordinal chart of the fidelity taxonomy (SPEC 7): a qualitative judgment
 * (supported/mixed/not_supported/insufficient_evidence) plotted as a bar
 * length purely to make the three axes scannable at a glance — the axis
 * labels ARE the categories, never a fabricated numeric metric.
 */
const FIDELITY_ORDER: FidelityStatus[] = ['insufficient_evidence', 'not_supported', 'mixed', 'supported']
function fidelityOrdinal(status: FidelityStatus): number {
  return FIDELITY_ORDER.indexOf(status) + 1
}
function fidelityChartLabels() {
  return [
    t('aiAnalysis.fidelity.calibration'),
    t('aiAnalysis.fidelity.comparativeEffects'),
    t('aiAnalysis.fidelity.rankingDecision'),
  ]
}
function fidelityChartData(fidelity: { calibration: { status: FidelityStatus }; comparativeEffects: { status: FidelityStatus }; rankingDecision: { status: FidelityStatus } }) {
  return [
    fidelityOrdinal(fidelity.calibration.status),
    fidelityOrdinal(fidelity.comparativeEffects.status),
    fidelityOrdinal(fidelity.rankingDecision.status),
  ]
}
function fidelityValueFormat(v: number): string {
  const status = FIDELITY_ORDER[Math.round(v) - 1]
  return status ? t(`aiAnalysis.fidelity.status.${status}`) : ''
}

onMounted(load)
</script>

<template>
  <Card>
    <CardHeader class="flex-row items-center justify-between gap-3 space-y-0">
      <div>
        <CardTitle>{{ t('aiAnalysis.title') }}</CardTitle>
        <CardDescription>{{ t(`aiAnalysis.subtitle.${levelLabel}`) }}</CardDescription>
      </div>
      <div class="flex items-center gap-2">
        <Button variant="outline" size="sm" :disabled="estimating" @click="onEstimate">
          {{ estimating ? t('common.loading') : t('aiAnalysis.estimate') }}
        </Button>
        <Button size="sm" :disabled="triggering || isPending || !!notReadyReason" @click="onTriggerClick">
          {{ triggering || isPending ? t('common.loading') : (analysis ? t('aiAnalysis.rerun') : t('aiAnalysis.run')) }}
        </Button>
      </div>
    </CardHeader>

    <LlmConfirmDialog
      v-model:open="confirmOpen"
      mode="analysis"
      :provider="null"
      :model="costEstimate?.model ?? '—'"
      :calls="1"
      :est-cost-usd="costEstimate?.estCostUsd ?? 0"
      :confirming="triggering"
      @confirm="doTrigger"
    />
    <CardContent class="space-y-4">
      <p v-if="notReadyReason" class="border-l-2 border-muted-foreground/40 bg-muted/40 p-3 text-sm text-muted-foreground">
        {{ notReadyReason }}
      </p>
      <p v-if="error" class="text-sm text-destructive" role="alert">{{ error }}</p>

      <dl v-if="costEstimate" class="grid gap-3 text-sm sm:grid-cols-3 border p-3">
        <div>
          <dt class="text-muted-foreground">{{ t('aiAnalysis.model') }}</dt>
          <dd class="font-medium">{{ costEstimate.model }}</dd>
        </div>
        <div>
          <dt class="text-muted-foreground">{{ t('aiAnalysis.estTokens') }}</dt>
          <dd class="font-medium tabular-nums">{{ (costEstimate.estInputTokens + costEstimate.estOutputTokens).toLocaleString() }}</dd>
        </div>
        <div>
          <dt class="text-muted-foreground">{{ t('aiAnalysis.estCost') }}</dt>
          <dd class="font-medium tabular-nums">${{ costEstimate.estCostUsd.toFixed(4) }}</dd>
        </div>
      </dl>

      <p v-if="loading" class="text-sm text-muted-foreground">{{ t('common.loading') }}</p>

      <template v-else-if="analysis">
        <p v-if="isPending" class="text-sm text-muted-foreground">{{ t('aiAnalysis.running') }}</p>
        <p v-else-if="analysis.status === 'error'" class="text-sm text-destructive" role="alert">
          {{ analysis.errorMessage ?? t('common.error') }}
        </p>

        <div v-else-if="analysis.resultJson" class="space-y-4">
          <p class="text-sm leading-relaxed">{{ analysis.resultJson.summary }}</p>

          <!-- Fidelity scorecard: the calibration / effects / ranking taxonomy, -->
          <!-- as a chart (bar length = qualitative status, never a fake number) -->
          <!-- and as cards with the note behind each status. -->
          <BarChart
            :labels="fidelityChartLabels()"
            :series="[{ label: t('aiAnalysis.title'), data: fidelityChartData(analysis.resultJson.fidelity) }]"
            :value-format="fidelityValueFormat"
            :legend="false"
            horizontal
            :height="140"
            :min="1"
            :max="4"
            :step-size="1"
          />
          <div class="grid gap-2 sm:grid-cols-3">
            <div class="border p-3 space-y-1">
              <div class="flex items-center justify-between">
                <span class="text-xs font-medium text-muted-foreground">{{ t('aiAnalysis.fidelity.calibration') }}</span>
                <Badge :variant="fidelityVariant(analysis.resultJson.fidelity.calibration.status)">
                  {{ t(`aiAnalysis.fidelity.status.${analysis.resultJson.fidelity.calibration.status}`) }}
                </Badge>
              </div>
              <p class="text-xs text-muted-foreground">{{ analysis.resultJson.fidelity.calibration.note }}</p>
            </div>
            <div class="border p-3 space-y-1">
              <div class="flex items-center justify-between">
                <span class="text-xs font-medium text-muted-foreground">{{ t('aiAnalysis.fidelity.comparativeEffects') }}</span>
                <Badge :variant="fidelityVariant(analysis.resultJson.fidelity.comparativeEffects.status)">
                  {{ t(`aiAnalysis.fidelity.status.${analysis.resultJson.fidelity.comparativeEffects.status}`) }}
                </Badge>
              </div>
              <p class="text-xs text-muted-foreground">{{ analysis.resultJson.fidelity.comparativeEffects.note }}</p>
            </div>
            <div class="border p-3 space-y-1">
              <div class="flex items-center justify-between">
                <span class="text-xs font-medium text-muted-foreground">{{ t('aiAnalysis.fidelity.rankingDecision') }}</span>
                <Badge :variant="fidelityVariant(analysis.resultJson.fidelity.rankingDecision.status)">
                  {{ t(`aiAnalysis.fidelity.status.${analysis.resultJson.fidelity.rankingDecision.status}`) }}
                </Badge>
              </div>
              <p class="text-xs text-muted-foreground">{{ analysis.resultJson.fidelity.rankingDecision.note }}</p>
            </div>
          </div>

          <div v-if="analysis.resultJson.keyFindings.length > 0" class="space-y-1">
            <p class="text-sm font-medium">{{ t('aiAnalysis.keyFindings') }}</p>
            <ul class="list-disc space-y-1 pl-5 text-sm">
              <li v-for="(f, i) in analysis.resultJson.keyFindings" :key="i">{{ f }}</li>
            </ul>
          </div>

          <div v-if="analysis.resultJson.caveats.length > 0" class="space-y-1">
            <p class="text-sm font-medium text-muted-foreground">{{ t('aiAnalysis.caveats') }}</p>
            <ul class="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
              <li v-for="(c, i) in analysis.resultJson.caveats" :key="i">{{ c }}</li>
            </ul>
          </div>

          <div v-if="analysis.resultJson.researchQuestionAnswers.length > 0" class="space-y-2 border-t pt-3">
            <p class="text-sm font-medium">{{ t('aiAnalysis.questionAnswers') }}</p>
            <div v-for="qa in analysis.resultJson.researchQuestionAnswers" :key="qa.questionId" class="space-y-1 border p-3">
              <p class="text-xs font-medium text-muted-foreground">{{ questionText(qa.questionId) }}</p>
              <div class="flex items-start justify-between gap-2">
                <p class="text-sm">{{ qa.answer }}</p>
                <Badge :variant="confidenceVariant(qa.confidence)" class="shrink-0">
                  {{ t(`aiAnalysis.confidence.${qa.confidence}`) }}
                </Badge>
              </div>
            </div>
          </div>

          <p v-if="analysis.llmModel" class="text-xs text-muted-foreground">
            {{ t('aiAnalysis.computedWith', { model: analysis.llmModel }) }}
          </p>
        </div>
      </template>

      <p v-else class="text-sm text-muted-foreground">{{ t('aiAnalysis.empty') }}</p>
    </CardContent>
  </Card>
</template>
