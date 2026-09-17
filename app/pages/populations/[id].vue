<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from '#imports'
import { useRoute } from '#app'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { BarChart } from '@/components/ui/chart'
import PageHeader from '@/components/PageHeader.vue'
import StatCard from '@/components/StatCard.vue'
import StatusBadge from '@/components/StatusBadge.vue'
import { useApi } from '@/composables/useApi'
import type { ApiError } from '@/composables/useApi'
import type {
  Population,
  PopulationAgentsPage,
  PopulationComposition,
  PopulationStatusResponse,
} from '@/types/api'

const { t, locale } = useI18n()
const route = useRoute()
const api = useApi()

const populationId = computed(() => String(route.params.id))

const population = ref<Population | null>(null)
const statusInfo = ref<PopulationStatusResponse | null>(null)
const loading = ref(false)
const error = ref<string | null>(null)

let pollTimer: ReturnType<typeof setInterval> | null = null

const progressPct = computed(() => {
  const p = statusInfo.value?.progress ?? 0
  // Accept either 0..1 or 0..100 from the backend.
  const normalized = p > 1 ? p : p * 100
  return Math.max(0, Math.min(100, Math.round(normalized)))
})

const isGenerating = computed(() => statusInfo.value?.status === 'generating')
const isReady = computed(() => (statusInfo.value?.status ?? population.value?.status) === 'ready')

async function loadPopulation() {
  loading.value = true
  error.value = null
  try {
    population.value = await api.get<Population>(`/populations/${populationId.value}`)
  }
  catch (err) {
    error.value = (err as ApiError)?.message ?? t('common.error')
  }
  finally {
    loading.value = false
  }
}

async function fetchStatus() {
  try {
    const st = await api.get<PopulationStatusResponse>(`/populations/${populationId.value}/status`)
    const wasGenerating = statusInfo.value?.status === 'generating'
    statusInfo.value = st
    if (population.value) {
      population.value.status = st.status
      population.value.agentCount = st.agentCount ?? population.value.agentCount
    }
    if (st.status !== 'generating' && pollTimer) {
      clearInterval(pollTimer)
      pollTimer = null
      if (wasGenerating && st.status === 'ready') {
        await Promise.all([loadComposition(), loadAgents()])
      }
    }
  }
  catch {
    // Ignore transient errors during polling.
  }
}

/* -------------------- composition: % da população por eixo (audit) -------------------- */
const composition = ref<PopulationComposition | null>(null)
const compositionError = ref<string | null>(null)
const loadingComposition = ref(false)

async function loadComposition() {
  loadingComposition.value = true
  compositionError.value = null
  try {
    composition.value = await api.get<PopulationComposition>(
      `/populations/${populationId.value}/composition`,
      { query: { locale: locale.value } },
    )
  }
  catch (err) {
    compositionError.value = (err as ApiError)?.message ?? t('common.error')
  }
  finally {
    loadingComposition.value = false
  }
}

function pctText(share: number): string {
  return `${(share * 100).toFixed(1)}%`
}
function pctFormat(v: number): string {
  return `${(v * 100).toFixed(0)}%`
}

/* -------------------- agents / profiles (audit) -------------------- */
const agentsPage = ref<PopulationAgentsPage | null>(null)
const agentsError = ref<string | null>(null)
const loadingAgents = ref(false)
const pageSize = 25
const pageOffset = ref(0)

const attributeColumns = computed(() => {
  const cols = new Set<string>()
  for (const a of agentsPage.value?.agents ?? []) {
    for (const k of Object.keys(a.attributes)) cols.add(k)
  }
  return [...cols]
})

async function loadAgents() {
  loadingAgents.value = true
  agentsError.value = null
  try {
    agentsPage.value = await api.get<PopulationAgentsPage>(
      `/populations/${populationId.value}/agents`,
      { query: { limit: pageSize, offset: pageOffset.value, locale: locale.value } },
    )
  }
  catch (err) {
    agentsError.value = (err as ApiError)?.message ?? t('common.error')
  }
  finally {
    loadingAgents.value = false
  }
}

const canPrevPage = computed(() => pageOffset.value > 0)
const canNextPage = computed(() => pageOffset.value + pageSize < (agentsPage.value?.total ?? 0))

function prevPage() {
  if (!canPrevPage.value) return
  pageOffset.value = Math.max(0, pageOffset.value - pageSize)
}
function nextPage() {
  if (!canNextPage.value) return
  pageOffset.value += pageSize
}
watch(pageOffset, loadAgents)

onMounted(async () => {
  await Promise.all([loadPopulation(), fetchStatus()])
  if (statusInfo.value?.status === 'generating') {
    pollTimer = setInterval(fetchStatus, 2000)
  }
  else if (isReady.value) {
    await Promise.all([loadComposition(), loadAgents()])
  }
})

onBeforeUnmount(() => {
  if (pollTimer) {
    clearInterval(pollTimer)
  }
})
</script>

<template>
  <div class="space-y-6">
    <p v-if="error" class="text-sm text-destructive" role="alert">{{ error }}</p>
    <p v-if="loading" class="text-sm text-muted-foreground">{{ t('common.loading') }}</p>

    <template v-if="population">
      <PageHeader
        :title="population.name"
        back-to="/populations"
        :back-label="t('populations.title')"
      >
        <template #actions>
          <StatusBadge :status="statusInfo?.status ?? population.status" />
        </template>
      </PageHeader>

      <Card v-if="isGenerating" class="max-w-xl">
        <CardContent class="space-y-3 pt-6">
          <p class="text-sm font-medium">{{ t('populations.generating') }}</p>
          <div
            class="h-2 w-full bg-muted"
            role="progressbar"
            :aria-valuenow="progressPct"
            aria-valuemin="0"
            aria-valuemax="100"
          >
            <div class="h-2 bg-primary transition-all" :style="{ width: `${progressPct}%` }" />
          </div>
          <p class="text-sm text-muted-foreground">{{ progressPct }}%</p>
        </CardContent>
      </Card>

      <Card
        v-else-if="statusInfo?.status === 'error'"
        class="max-w-xl border-destructive"
      >
        <CardContent class="pt-6">
          <p class="text-sm font-medium text-destructive">{{ t('populations.errorTitle') }}</p>
          <p class="text-sm text-muted-foreground">{{ statusInfo?.errorMessage ?? t('common.error') }}</p>
        </CardContent>
      </Card>

      <template v-else>
        <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            :label="t('populations.columns.agentCount')"
            :value="population.agentCount ?? statusInfo?.agentCount ?? '—'"
          />
          <StatCard
            v-if="population.size"
            :label="t('populations.fields.size')"
            :value="population.size"
          />
        </div>

        <!-- Composition: % da população por eixo + auditoria vs alvo -->
        <section class="space-y-4">
          <div class="space-y-1">
            <h2 class="text-lg font-medium">{{ t('populations.composition.title') }}</h2>
            <p class="text-sm text-muted-foreground">{{ t('populations.composition.subtitle') }}</p>
          </div>

          <p v-if="compositionError" class="text-sm text-destructive" role="alert">{{ compositionError }}</p>
          <p v-if="loadingComposition" class="text-sm text-muted-foreground">{{ t('common.loading') }}</p>

          <div v-if="composition && composition.attributes.length > 0" class="grid gap-4 lg:grid-cols-2">
            <Card v-for="attr in composition.attributes" :key="attr.attributeId">
              <CardHeader class="flex-row items-center justify-between gap-3 space-y-0">
                <CardTitle>{{ attr.attributeLabel }}</CardTitle>
                <Badge v-if="attr.chiSquare" :variant="attr.chiSquare.pValue > 0.05 ? 'success' : 'destructive'">
                  {{ attr.chiSquare.pValue > 0.05 ? t('statistics.notDistinguishable') : t('statistics.distinguishable') }}
                </Badge>
                <Badge v-else variant="secondary">{{ t('populations.composition.noAudit') }}</Badge>
              </CardHeader>
              <CardContent class="space-y-3">
                <BarChart
                  :labels="attr.values.map(v => v.valueLabel)"
                  :series="attr.chiSquare
                    ? [
                        { label: t('statistics.columns.observedShare'), data: attr.values.map(v => v.observedShare) },
                        { label: t('statistics.columns.targetShare'), data: attr.values.map(v => v.targetShare ?? 0) },
                      ]
                    : [{ label: t('statistics.columns.observedShare'), data: attr.values.map(v => v.observedShare) }]"
                  :value-format="pctFormat"
                  :horizontal="attr.values.length > 6"
                />
                <div class="overflow-x-auto border">
                  <table class="w-full text-sm">
                    <thead>
                      <tr class="border-b bg-muted/60 text-left [&>th]:px-3 [&>th]:py-2 [&>th]:text-xs [&>th]:font-semibold [&>th]:text-ink-600">
                        <th class="px-3 py-2 font-medium">{{ t('statistics.columns.valueKey') }}</th>
                        <th class="px-3 py-2 font-medium">{{ t('statistics.columns.count') }}</th>
                        <th class="px-3 py-2 font-medium">{{ t('statistics.columns.observedShare') }}</th>
                        <th class="px-3 py-2 font-medium">{{ t('statistics.columns.targetShare') }}</th>
                        <th class="px-3 py-2 font-medium">{{ t('statistics.columns.withinMargin') }}</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr v-for="v in attr.values" :key="v.valueId" class="border-b last:border-b-0">
                        <td class="px-3 py-2">{{ v.valueLabel }}</td>
                        <td class="px-3 py-2 tabular-nums">{{ v.count }}</td>
                        <td class="px-3 py-2 tabular-nums">{{ pctText(v.observedShare) }}</td>
                        <td class="px-3 py-2 tabular-nums">{{ v.targetShare != null ? pctText(v.targetShare) : '—' }}</td>
                        <td class="px-3 py-2">{{ v.withinMargin == null ? '—' : (v.withinMargin ? t('common.yes') : t('common.no')) }}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </div>
          <p v-else-if="!loadingComposition" class="text-sm text-muted-foreground">
            {{ t('populations.composition.empty') }}
          </p>
        </section>

        <!-- Agents / profiles: audit individual roster -->
        <section class="space-y-4">
          <div class="space-y-1">
            <h2 class="text-lg font-medium">{{ t('populations.agents.title') }}</h2>
            <p class="text-sm text-muted-foreground">
              {{ t('populations.agents.subtitle', { total: agentsPage?.total ?? 0 }) }}
            </p>
          </div>

          <p v-if="agentsError" class="text-sm text-destructive" role="alert">{{ agentsError }}</p>
          <p v-if="loadingAgents" class="text-sm text-muted-foreground">{{ t('common.loading') }}</p>

          <div v-if="agentsPage && agentsPage.agents.length > 0" class="overflow-x-auto border">
            <table class="w-full text-sm">
              <thead>
                <tr class="border-b bg-muted/60 text-left [&>th]:px-3 [&>th]:py-2 [&>th]:text-xs [&>th]:font-semibold [&>th]:text-ink-600">
                  <th class="px-3 py-2 font-medium">{{ t('populations.agents.id') }}</th>
                  <th v-for="col in attributeColumns" :key="col" class="px-3 py-2 font-medium">{{ col }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="a in agentsPage.agents" :key="a.id" class="border-b last:border-b-0">
                  <td class="px-3 py-2 font-mono text-xs">{{ a.fullName ?? a.externalKey ?? `#${a.id}` }}</td>
                  <td v-for="col in attributeColumns" :key="col" class="px-3 py-2">{{ a.attributes[col] ?? '—' }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p v-else-if="!loadingAgents" class="text-sm text-muted-foreground">
            {{ t('populations.agents.empty') }}
          </p>

          <div v-if="agentsPage && agentsPage.total > pageSize" class="flex items-center justify-between">
            <Button variant="outline" size="sm" :disabled="!canPrevPage" @click="prevPage">
              {{ t('common.back') }}
            </Button>
            <p class="text-xs text-muted-foreground">
              {{ t('populations.agents.pageInfo', {
                from: pageOffset + 1,
                to: Math.min(pageOffset + pageSize, agentsPage.total),
                total: agentsPage.total,
              }) }}
            </p>
            <Button variant="outline" size="sm" :disabled="!canNextPage" @click="nextPage">
              {{ t('populations.agents.next') }}
            </Button>
          </div>
        </section>
      </template>
    </template>
  </div>
</template>
