<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from '#imports'
import { useRoute } from '#app'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card'
import RunTabs from '@/components/RunTabs.vue'
import StatusBadge from '@/components/StatusBadge.vue'
import PageHeader from '@/components/PageHeader.vue'
import StatCard from '@/components/StatCard.vue'
import LlmConfirmDialog from '@/components/LlmConfirmDialog.vue'
import AgentGroundingDialog from '@/components/AgentGroundingDialog.vue'
import type { AgentResponseContext } from '@/components/AgentGroundingDialog.vue'
import { useApi } from '@/composables/useApi'
import type { ApiError } from '@/composables/useApi'
import { useRun } from '@/composables/useRun'
import type {
  InstrumentItem,
  RunResponse,
  RunUsage,
  StudyRun,
  StudyRunFreezeInput,
} from '@/types/api'

const { t } = useI18n()
const route = useRoute()
const api = useApi()

const runId = computed(() => String(route.params.id))
const { run, loading, error, tabs, loadRun: loadRunBase } = useRun(runId.value)

async function loadRun() {
  await loadRunBase()
  ensurePolling()
}

/* -------------------- freeze -------------------- */
const freezing = ref(false)
const freezeError = ref<string | null>(null)

const isDraft = computed(() => run.value?.status === 'draft')
const manifest = computed(() => run.value?.manifestJson ?? null)

async function onFreeze() {
  if (!run.value) {
    return
  }
  freezing.value = true
  freezeError.value = null
  try {
    const payload: StudyRunFreezeInput = {
      groundingCompilerKey: run.value.groundingCompilerKey || undefined,
      llmProvider: run.value.llmProvider || undefined,
      llmModel: run.value.llmModel || undefined,
      instrumentId: run.value.instrumentId || undefined,
      seed: run.value.seed ?? undefined,
    }
    run.value = await api.post<StudyRun>(`/study-runs/${runId.value}/freeze`, payload)
  }
  catch (err) {
    freezeError.value = (err as ApiError)?.message ?? t('common.error')
  }
  finally {
    freezing.value = false
  }
}

/* -------------------- polling (only while running) -------------------- */
let pollTimer: ReturnType<typeof setInterval> | null = null

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
}

function ensurePolling() {
  if (run.value?.status === 'running' && !pollTimer) {
    pollTimer = setInterval(async () => {
      try {
        const fresh = await api.get<StudyRun>(`/study-runs/${runId.value}`)
        run.value = fresh
        if (fresh.status !== 'running') {
          stopPolling()
          await loadUsage()
        }
      }
      catch {
        stopPolling()
      }
    }, 2000)
  }
  else if (run.value?.status !== 'running') {
    stopPolling()
  }
}

/* -------------------- formatting helpers -------------------- */
function formatUsd(n: number | null | undefined): string {
  return `$${(n ?? 0).toFixed(4)}`
}

function formatTokens(n: number | null | undefined): string {
  return (n ?? 0).toLocaleString()
}

/* -------------------- execution -------------------- */
const executing = ref(false)
const executeError = ref<string | null>(null)

const canExecute = computed(() => run.value?.status === 'frozen')
const canReRun = computed(() => run.value?.status === 'done' || run.value?.status === 'error')
const isRunning = computed(() => run.value?.status === 'running')
const hasRunError = computed(() => run.value?.status === 'error')

const progressPct = computed(() => {
  const p = run.value?.progress ?? 0
  return Math.max(0, Math.min(100, Math.round(p * (p <= 1 ? 100 : 1))))
})

// Mode picker for the single "Executar" action: batch (SPEC 8, provider
// Batches API, the platform default) or sync (advanced, more expensive).
const execMode = ref<'batch' | 'sync'>('batch')

/**
 * Transparency gate (Fred, 2026-09-04): no button that fires a run's LLM
 * calls — sync or batch — may skip a confirmation showing mode/model/calls/
 * cost. Clicking "Executar" estimates first (if not already estimated) and
 * opens LlmConfirmDialog; onExecute/onSubmitBatch only run from
 * doExecuteChosen() on confirm.
 */
const confirmExecOpen = ref(false)

async function onExecuteClick() {
  executeError.value = null
  if (!costEstimate.value) {
    await onEstimateCost()
    if (!costEstimate.value) return // estimate failed — error already shown
  }
  confirmExecOpen.value = true
}

async function doExecuteChosen() {
  if (execMode.value === 'sync') await onExecute()
  else await onSubmitBatch()
  confirmExecOpen.value = false
}

const execConfirmCost = computed(() => {
  if (!costEstimate.value) return 0
  return execMode.value === 'batch' ? costEstimate.value.batchEstCostUsd : costEstimate.value.estCostUsd
})
const execConfirmDetail = computed(() => {
  if (!costEstimate.value) return null
  return t('runs.cost.callsBreakdown', { agents: costEstimate.value.agents, items: costEstimate.value.items })
})

async function onExecute() {
  if (!run.value) {
    return
  }
  executing.value = true
  executeError.value = null
  try {
    run.value = await api.post<StudyRun>(`/study-runs/${runId.value}/execute`)
    ensurePolling()
  }
  catch (err) {
    executeError.value = (err as ApiError)?.message ?? t('common.error')
  }
  finally {
    executing.value = false
  }
}

/* -------------------- cost estimate (pre-run, SPEC 11) -------------------- */
interface CostEstimate {
  calls: number
  agents: number
  items: number
  model: string
  estInputTokens: number
  estOutputTokens: number
  estCostUsd: number
  batchEstCostUsd: number
}

const costEstimate = ref<CostEstimate | null>(null)
const estimating = ref(false)
const estimateError = ref<string | null>(null)

// Estimate is meaningful once the manifest is frozen (has population/model).
const canEstimate = computed(() => run.value?.status !== 'draft')

async function onEstimateCost() {
  if (!run.value) {
    return
  }
  estimating.value = true
  estimateError.value = null
  try {
    costEstimate.value = await api.get<CostEstimate>(`/study-runs/${runId.value}/cost-estimate`)
  }
  catch (err) {
    estimateError.value = (err as ApiError)?.message ?? t('common.error')
  }
  finally {
    estimating.value = false
  }
}

/* -------------------- batch execution (SPEC 8) -------------------- */
const submittingBatch = ref(false)
const pollingBatch = ref(false)
const batchError = ref<string | null>(null)

const canBatch = computed(() =>
  run.value?.status === 'frozen'
  || run.value?.status === 'done'
  || run.value?.status === 'error',
)
const hasBatch = computed(() => Boolean(run.value?.batchId))

async function onSubmitBatch() {
  if (!run.value) {
    return
  }
  submittingBatch.value = true
  batchError.value = null
  try {
    await api.post(`/study-runs/${runId.value}/batch`)
    await loadRun()
  }
  catch (err) {
    batchError.value = (err as ApiError)?.message ?? t('common.error')
  }
  finally {
    submittingBatch.value = false
  }
}

async function onPollBatch() {
  if (!run.value) {
    return
  }
  pollingBatch.value = true
  batchError.value = null
  try {
    await api.post(`/study-runs/${runId.value}/batch/poll`)
    await loadRun()
    await loadUsage()
  }
  catch (err) {
    batchError.value = (err as ApiError)?.message ?? t('common.error')
  }
  finally {
    pollingBatch.value = false
  }
}

/* -------------------- responses -------------------- */
const responses = ref<RunResponse[]>([])
const responsesLoaded = ref(false)
const loadingResponses = ref(false)
const responsesError = ref<string | null>(null)

function responseValueText(value: unknown): string {
  if (value === null || value === undefined) {
    return '—'
  }
  if (typeof value === 'object') {
    return JSON.stringify(value)
  }
  return String(value)
}

// Instrument items, keyed by itemKey (== RunResponse.questionKey): lets the
// table show the actual question text instead of a raw key, and supplies the
// stimulus text needed to re-derive "which profile answered this" below.
const itemsByKey = ref<Record<string, InstrumentItem>>({})

function questionText(questionKey: string): string {
  return itemsByKey.value[questionKey]?.promptText ?? questionKey
}

async function loadResponses() {
  loadingResponses.value = true
  responsesError.value = null
  try {
    // instrumentId lives only in the frozen manifest snapshot — the run
    // entity itself has no such column (see StudyRun.manifestJson docstring).
    const instrumentId = manifest.value?.instrumentId
    const [resp, items] = await Promise.all([
      api.get<RunResponse[]>(`/study-runs/${runId.value}/responses`),
      instrumentId
        ? api.get<InstrumentItem[]>(`/instruments/${instrumentId}/items`).catch(() => [])
        : Promise.resolve([]),
    ])
    responses.value = resp ?? []
    itemsByKey.value = Object.fromEntries((items ?? []).map(i => [i.itemKey, i]))
    responsesLoaded.value = true
  }
  catch (err) {
    responsesError.value = (err as ApiError)?.message ?? t('common.error')
  }
  finally {
    loadingResponses.value = false
  }
}

// "Which profile said this?" (AgentGroundingDialog) — see the same pattern
// on the Diffusion screen. Recomputed on demand, nothing stored per response.
const groundingPreview = ref<{ agentId: string, responses: AgentResponseContext[] } | null>(null)
const groundingOpen = ref(false)

const compilerKey = computed(() => {
  const raw = manifest.value?.groundingCompilerKey || 'evidence_grounded_v1'
  return /_v\d+$/.test(raw) ? raw : `${raw}_v1`
})

function openGroundingPreview(resp: RunResponse) {
  const question = questionText(resp.questionKey)
  groundingPreview.value = {
    agentId: resp.agentId,
    responses: [{
      label: question,
      stimulusText: question,
      answer: [
        { label: t('runs.responses.value'), value: responseValueText(resp.valueJson) },
        { label: t('runs.responses.explanation'), value: resp.explanation ?? '—' },
      ],
    }],
  }
  groundingOpen.value = true
}

/* -------------------- per-run usage -------------------- */
const usage = ref<RunUsage | null>(null)
const usageError = ref<string | null>(null)

const hasUsage = computed(() => (usage.value?.totals.calls ?? 0) > 0)

async function loadUsage() {
  usageError.value = null
  try {
    usage.value = await api.get<RunUsage>(`/usage/runs/${runId.value}`)
  }
  catch (err) {
    usageError.value = (err as ApiError)?.message ?? t('common.error')
  }
}

onMounted(async () => {
  await loadRun()
  await loadUsage()
})

onBeforeUnmount(stopPolling)
</script>

<template>
  <div class="space-y-6">
    <p v-if="error" class="text-sm text-destructive" role="alert">{{ error }}</p>
    <p v-if="loading" class="text-sm text-muted-foreground">{{ t('common.loading') }}</p>

    <template v-if="run">
      <PageHeader
        :title="run.name"
        :back-to="`/studies/${run.studyId}`"
        :back-label="t('common.back')"
      >
        <template #actions>
          <StatusBadge :status="run.status" />
          <div v-if="isDraft" class="flex flex-col items-end gap-1">
            <Button :disabled="freezing" @click="onFreeze">
              {{ freezing ? t('common.loading') : t('runs.freeze') }}
            </Button>
            <p class="text-xs text-muted-foreground">{{ t('runs.freezeHint') }}</p>
          </div>
        </template>
      </PageHeader>

      <RunTabs :tabs="tabs" />

      <p v-if="freezeError" class="text-sm text-destructive" role="alert">{{ freezeError }}</p>

      <!-- Execution -->
      <Card>
        <CardContent class="space-y-4 pt-6">
        <div class="flex flex-wrap items-start justify-between gap-4">
          <div class="space-y-1">
            <h2 class="text-lg font-medium">{{ t('runs.execution.title') }}</h2>
            <div class="flex items-center gap-2 text-sm text-muted-foreground">
              <span>{{ t('runs.execution.statusLabel') }}:</span>
              <StatusBadge :status="run.status" />
            </div>
          </div>
          <!-- One execute action; the mode picker decides sync vs the -->
          <!-- provider Batches API (SPEC 8, ~50% cheaper — the platform -->
          <!-- default). "Lote" here means one run's calls bundled into one -->
          <!-- provider batch — grouping several RUNS together is the -->
          <!-- separate "Executar tudo" action on the study page. -->
          <div class="flex flex-col items-end gap-1.5">
            <div v-if="!hasBatch" class="flex items-center gap-2">
              <select v-model="execMode" class="field-select h-9 text-sm">
                <option value="batch">{{ t('runs.execution.modeBatch') }}</option>
                <option value="sync">{{ t('runs.execution.modeSync') }}</option>
              </select>
              <Button
                v-if="canExecute || canReRun"
                :disabled="executing || submittingBatch || estimating"
                @click="onExecuteClick"
              >
                {{ executing || submittingBatch
                  ? t('runs.execution.executing')
                  : (canReRun ? t('runs.execution.reRun') : t('runs.execution.execute')) }}
              </Button>
            </div>
            <Button
              v-else
              size="sm"
              :disabled="pollingBatch"
              @click="onPollBatch"
            >
              {{ pollingBatch ? t('common.loading') : t('runs.batch.poll') }}
            </Button>
          </div>
        </div>
        <p v-if="hasBatch" class="text-sm text-muted-foreground">
          {{ t('runs.batch.statusLabel') }}:
          <span class="font-mono text-xs">{{ run.batchId }}</span>
          <span v-if="run.batchStatus"> · {{ run.batchStatus }}</span>
        </p>
        <p v-if="batchError" class="text-sm text-destructive" role="alert">{{ batchError }}</p>

        <!-- Progress while running -->
        <div v-if="isRunning" class="space-y-2">
          <div class="flex items-center justify-between text-sm">
            <span class="text-muted-foreground">{{ t('runs.execution.progress') }}</span>
            <span class="tabular-nums font-medium">{{ progressPct }}%</span>
          </div>
          <div class="h-2 w-full bg-muted">
            <div class="h-2 bg-primary transition-all" :style="{ width: `${progressPct}%` }" />
          </div>
        </div>

        <!-- Expected error state (e.g. LLM disabled) -->
        <div
          v-if="hasRunError && run.errorMessage"
          class="border-l-2 border-muted-foreground/40 bg-muted/40 p-3 text-sm text-muted-foreground"
          role="status"
        >
          <p class="font-medium text-foreground">{{ t('runs.execution.errorInfo') }}</p>
          <p class="mt-1">{{ run.errorMessage }}</p>
        </div>

        <p v-if="executeError" class="text-sm text-destructive" role="alert">{{ executeError }}</p>

        <!-- Pre-run cost estimate (SPEC 11) -->
        <div v-if="canEstimate" class="space-y-3 border-t pt-4">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <div class="space-y-0.5">
              <h3 class="font-medium">{{ t('runs.cost.title') }}</h3>
              <p class="text-sm text-muted-foreground">{{ t('runs.cost.subtitle') }}</p>
            </div>
            <Button variant="outline" size="sm" :disabled="estimating" @click="onEstimateCost">
              {{ estimating ? t('common.loading') : t('runs.cost.estimate') }}
            </Button>
          </div>
          <p v-if="estimateError" class="text-sm text-destructive" role="alert">{{ estimateError }}</p>
          <dl v-if="costEstimate" class="grid gap-3 text-sm sm:grid-cols-4">
            <div class="stat-tile">
              <dt class="text-muted-foreground">{{ t('runs.cost.calls') }}</dt>
              <dd class="text-lg font-semibold tabular-nums">{{ formatTokens(costEstimate.calls) }}</dd>
              <dd class="text-xs text-muted-foreground">
                {{ t('runs.cost.callsBreakdown', { agents: costEstimate.agents, items: costEstimate.items }) }}
              </dd>
            </div>
            <div class="stat-tile">
              <dt class="text-muted-foreground">{{ t('runs.cost.estTokens') }}</dt>
              <dd class="text-lg font-semibold tabular-nums">
                {{ formatTokens(costEstimate.estInputTokens + costEstimate.estOutputTokens) }}
              </dd>
            </div>
            <div class="stat-tile">
              <dt class="text-muted-foreground">{{ t('runs.cost.estSync') }}</dt>
              <dd class="text-lg font-semibold tabular-nums">{{ formatUsd(costEstimate.estCostUsd) }}</dd>
            </div>
            <div class="stat-tile">
              <dt class="text-muted-foreground">{{ t('runs.cost.estBatch') }}</dt>
              <dd class="text-lg font-semibold tabular-nums text-primary">{{ formatUsd(costEstimate.batchEstCostUsd) }}</dd>
              <dd class="text-xs text-muted-foreground">{{ costEstimate.model }}</dd>
            </div>
          </dl>
        </div>

        </CardContent>
      </Card>

      <LlmConfirmDialog
        v-model:open="confirmExecOpen"
        :mode="execMode"
        :provider="manifest?.llmProvider ?? null"
        :model="costEstimate?.model ?? manifest?.llmModel ?? '—'"
        :calls="costEstimate?.calls ?? 0"
        :calls-detail="execConfirmDetail"
        :est-cost-usd="execConfirmCost"
        :confirming="executing || submittingBatch"
        @confirm="doExecuteChosen"
      />

      <!-- Manifest -->
      <Card v-if="manifest">
        <CardHeader>
          <CardTitle class="text-lg">{{ t('runs.manifest.title') }}</CardTitle>
        </CardHeader>
        <CardContent>
        <dl class="grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt class="text-muted-foreground">{{ t('runs.manifest.populations') }}</dt>
            <dd class="font-medium">{{ (manifest.populationIds ?? []).length }}</dd>
          </div>
          <div>
            <dt class="text-muted-foreground">{{ t('runs.manifest.stimuli') }}</dt>
            <dd class="font-medium">{{ (manifest.stimulusIds ?? []).length }}</dd>
          </div>
          <div>
            <dt class="text-muted-foreground">{{ t('runs.fields.groundingCompiler') }}</dt>
            <dd class="font-medium">
              {{ manifest.groundingCompilerKey ? t(`registry.grounding_compiler.${manifest.groundingCompilerKey}`) : '—' }}
            </dd>
          </div>
          <div>
            <dt class="text-muted-foreground">{{ t('runs.fields.llmProvider') }}</dt>
            <dd class="font-medium">
              {{ manifest.llmProvider ? t(`registry.llm_provider.${manifest.llmProvider}`) : '—' }}
              <template v-if="manifest.llmModel"> · {{ manifest.llmModel }}</template>
            </dd>
          </div>
          <div>
            <dt class="text-muted-foreground">{{ t('runs.fields.seed') }}</dt>
            <dd class="font-medium">{{ manifest.seed ?? '—' }}</dd>
          </div>
          <div>
            <dt class="text-muted-foreground">{{ t('studies.fields.exposureMode') }}</dt>
            <dd class="font-medium">
              {{ manifest.exposureMode ? t(`registry.exposure_mode.${manifest.exposureMode}`) : '—' }}
            </dd>
          </div>
          <div v-if="manifest.frozenAt">
            <dt class="text-muted-foreground">{{ t('runs.manifest.frozenAt') }}</dt>
            <dd class="font-medium">{{ manifest.frozenAt }}</dd>
          </div>
        </dl>
        </CardContent>
      </Card>

      <!-- Responses -->
      <Card>
        <CardHeader class="flex-row flex-wrap items-center justify-between gap-3 space-y-0">
          <div class="space-y-1.5">
            <CardTitle class="text-lg">{{ t('runs.responses.title') }}</CardTitle>
            <CardDescription v-if="responsesLoaded">
              {{ t('runs.responses.count', { n: responses.length }) }} · {{ t('runs.responses.cappedNote') }}
            </CardDescription>
          </div>
          <Button
            variant="outline"
            size="sm"
            :disabled="loadingResponses"
            @click="loadResponses"
          >
            {{ loadingResponses ? t('common.loading') : t('runs.responses.view') }}
          </Button>
        </CardHeader>
        <CardContent class="space-y-4">
        <p v-if="responsesError" class="text-sm text-destructive" role="alert">{{ responsesError }}</p>

        <div v-if="responsesLoaded">
          <div v-if="responses.length === 0" class="text-sm text-muted-foreground">
            {{ t('runs.responses.empty') }}
          </div>
          <div v-else class="overflow-x-auto border">
            <table class="w-full text-sm">
              <thead>
                <tr class="border-b bg-muted/60 text-left [&>th]:px-3 [&>th]:py-2 [&>th]:text-xs [&>th]:font-semibold [&>th]:text-ink-600">
                  <th class="px-3 py-2 font-medium">{{ t('runs.responses.agent') }}</th>
                  <th class="px-3 py-2 font-medium">{{ t('runs.responses.question') }}</th>
                  <th class="px-3 py-2 font-medium">{{ t('runs.responses.value') }}</th>
                  <th class="px-3 py-2 font-medium">{{ t('runs.responses.explanation') }}</th>
                  <th class="px-3 py-2 font-medium" />
                </tr>
              </thead>
              <tbody>
                <tr v-for="resp in responses" :key="resp.id" class="border-b last:border-b-0 align-top">
                  <td class="px-3 py-2 font-mono text-xs">{{ resp.agentId }}</td>
                  <td class="px-3 py-2">{{ questionText(resp.questionKey) }}</td>
                  <td class="px-3 py-2">{{ responseValueText(resp.valueJson) }}</td>
                  <td class="px-3 py-2 text-muted-foreground">{{ resp.explanation ?? '—' }}</td>
                  <td class="px-3 py-2">
                    <Button variant="ghost" size="sm" @click="openGroundingPreview(resp)">
                      {{ t('agentGrounding.viewProfile') }}
                    </Button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
        </CardContent>
      </Card>

      <!-- Usage / cost -->
      <Card>
        <CardHeader>
          <CardTitle class="text-lg">{{ t('usage.title') }}</CardTitle>
          <CardDescription>{{ t('usage.subtitle') }}</CardDescription>
        </CardHeader>
        <CardContent class="space-y-4">
        <p v-if="usageError" class="text-sm text-destructive" role="alert">{{ usageError }}</p>

        <div v-if="usage && hasUsage" class="space-y-4">
          <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard :label="t('usage.totalCost')" :value="formatUsd(usage.totals.costUsd)" />
            <StatCard :label="t('usage.calls')" :value="formatTokens(usage.totals.calls)" />
            <StatCard :label="t('usage.inputTokens')" :value="formatTokens(usage.totals.inputTokens)" />
            <StatCard :label="t('usage.outputTokens')" :value="formatTokens(usage.totals.outputTokens)" />
          </div>

          <div class="grid gap-4 lg:grid-cols-2">
            <!-- byModel -->
            <div class="space-y-2">
              <h3 class="font-medium">{{ t('usage.byModel') }}</h3>
              <div class="overflow-x-auto border">
                <table class="w-full text-sm">
                  <thead>
                    <tr class="border-b bg-muted/60 text-left [&>th]:px-3 [&>th]:py-2 [&>th]:text-xs [&>th]:font-semibold [&>th]:text-ink-600">
                      <th class="px-3 py-2 font-medium">{{ t('usage.provider') }}</th>
                      <th class="px-3 py-2 font-medium">{{ t('usage.model') }}</th>
                      <th class="px-3 py-2 font-medium">{{ t('usage.calls') }}</th>
                      <th class="px-3 py-2 font-medium">{{ t('usage.totalCost') }}</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="(m, i) in usage.byModel" :key="`${m.provider}-${m.model}-${i}`" class="border-b last:border-b-0">
                      <td class="px-3 py-2">{{ m.provider }}</td>
                      <td class="px-3 py-2">{{ m.model }}</td>
                      <td class="px-3 py-2 tabular-nums">{{ formatTokens(m.calls) }}</td>
                      <td class="px-3 py-2 tabular-nums">{{ formatUsd(m.costUsd) }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            <!-- byPurpose -->
            <div class="space-y-2">
              <h3 class="font-medium">{{ t('usage.byPurpose') }}</h3>
              <div class="overflow-x-auto border">
                <table class="w-full text-sm">
                  <thead>
                    <tr class="border-b bg-muted/60 text-left [&>th]:px-3 [&>th]:py-2 [&>th]:text-xs [&>th]:font-semibold [&>th]:text-ink-600">
                      <th class="px-3 py-2 font-medium">{{ t('usage.purpose') }}</th>
                      <th class="px-3 py-2 font-medium">{{ t('usage.calls') }}</th>
                      <th class="px-3 py-2 font-medium">{{ t('usage.totalCost') }}</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="(p, i) in usage.byPurpose" :key="`${p.purpose}-${i}`" class="border-b last:border-b-0">
                      <td class="px-3 py-2">{{ p.purpose }}</td>
                      <td class="px-3 py-2 tabular-nums">{{ formatTokens(p.calls) }}</td>
                      <td class="px-3 py-2 tabular-nums">{{ formatUsd(p.costUsd) }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>

        <p v-else class="text-sm text-muted-foreground">{{ t('usage.empty') }}</p>
        </CardContent>
      </Card>
    </template>

    <AgentGroundingDialog
      v-model:open="groundingOpen"
      :agent-id="groundingPreview?.agentId ?? null"
      :compiler-key="compilerKey"
      :responses="groundingPreview?.responses ?? []"
    />
  </div>
</template>
