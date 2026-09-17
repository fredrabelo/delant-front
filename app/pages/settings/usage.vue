<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from '#imports'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import PageHeader from '@/components/PageHeader.vue'
import StatCard from '@/components/StatCard.vue'
import { useApi } from '@/composables/useApi'
import type { ApiError } from '@/composables/useApi'
import type { ClientUsage } from '@/types/api'

const { t } = useI18n()
const api = useApi()

const usage = ref<ClientUsage | null>(null)
const loading = ref(false)
const error = ref<string | null>(null)

// Default range = first and last day of the current month (YYYY-MM-DD).
function monthRange(): { first: string, last: string } {
  const now = new Date()
  const y = now.getFullYear()
  const m = now.getMonth()
  const pad = (n: number) => String(n).padStart(2, '0')
  const first = `${y}-${pad(m + 1)}-01`
  const lastDay = new Date(y, m + 1, 0).getDate()
  const last = `${y}-${pad(m + 1)}-${pad(lastDay)}`
  return { first, last }
}

const defaults = monthRange()

// Filters
const from = ref(defaults.first)
const to = ref(defaults.last)
const provider = ref('')
// Provider options persist across filtering (loaded from an unfiltered call).
const providerOptions = ref<string[]>([])

const hasUsage = computed(() => (usage.value?.totals.calls ?? 0) > 0)

function formatUsd(n: number | null | undefined): string {
  return `$${(n ?? 0).toFixed(4)}`
}

function formatTokens(n: number | null | undefined): string {
  return (n ?? 0).toLocaleString()
}

async function loadUsage() {
  loading.value = true
  error.value = null
  try {
    const query: Record<string, string> = {}
    if (from.value) query.from = `${from.value} 00:00:00`
    if (to.value) query.to = `${to.value} 23:59:59`
    if (provider.value) query.provider = provider.value
    const data = await api.get<ClientUsage>('/usage/client', { query })
    usage.value = data
    // Seed the provider dropdown once (from the full, unfiltered set).
    if (providerOptions.value.length === 0 && data?.providers?.length) {
      providerOptions.value = data.providers
    }
  }
  catch (err) {
    error.value = (err as ApiError)?.message ?? t('common.error')
  }
  finally {
    loading.value = false
  }
}

function clearFilters() {
  from.value = defaults.first
  to.value = defaults.last
  provider.value = ''
  loadUsage()
}

onMounted(loadUsage)
</script>

<template>
  <div class="space-y-6 max-w-4xl">
    <PageHeader
      :title="t('usage.clientTitle')"
      :description="t('usage.clientSubtitle')"
    />

    <!-- Filters -->
    <Card>
      <CardContent class="flex flex-wrap items-end gap-3 pt-4">
        <div class="space-y-1">
          <label class="text-xs font-medium" for="usage-from">{{ t('usage.from') }}</label>
          <input id="usage-from" v-model="from" type="date" class="field-select">
        </div>
        <div class="space-y-1">
          <label class="text-xs font-medium" for="usage-to">{{ t('usage.to') }}</label>
          <input id="usage-to" v-model="to" type="date" class="field-select">
        </div>
        <div class="space-y-1">
          <label class="text-xs font-medium" for="usage-provider">{{ t('usage.provider') }}</label>
          <select id="usage-provider" v-model="provider" class="field-select">
            <option value="">{{ t('usage.allProviders') }}</option>
            <option v-for="p in providerOptions" :key="p" :value="p">{{ p }}</option>
          </select>
        </div>
        <button
          type="button"
          class="border px-3 py-2 text-sm hover:bg-muted"
          @click="loadUsage"
        >
          {{ t('usage.apply') }}
        </button>
        <button
          type="button"
          class="text-sm text-muted-foreground underline"
          @click="clearFilters"
        >
          {{ t('usage.clear') }}
        </button>
      </CardContent>
    </Card>

    <p v-if="error" class="text-sm text-destructive" role="alert">{{ error }}</p>
    <p v-if="loading" class="text-sm text-muted-foreground">{{ t('common.loading') }}</p>

    <template v-if="usage">
      <div v-if="hasUsage" class="space-y-6">
        <!-- Totals -->
        <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard :label="t('usage.totalCost')" :value="formatUsd(usage.totals.costUsd)" />
          <StatCard :label="t('usage.calls')" :value="formatTokens(usage.totals.calls)" />
          <StatCard :label="t('usage.inputTokens')" :value="formatTokens(usage.totals.inputTokens)" />
          <StatCard :label="t('usage.outputTokens')" :value="formatTokens(usage.totals.outputTokens)" />
        </div>

        <!-- byModel -->
        <Card>
          <CardHeader>
            <CardTitle class="text-lg">{{ t('usage.byModel') }}</CardTitle>
          </CardHeader>
          <CardContent class="p-0">
          <div class="overflow-x-auto">
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
                <tr
                  v-for="(m, i) in usage.byModel"
                  :key="`${m.provider}-${m.model}-${i}`"
                  class="border-b last:border-b-0"
                >
                  <td class="px-3 py-2">{{ m.provider }}</td>
                  <td class="px-3 py-2">{{ m.model }}</td>
                  <td class="px-3 py-2 tabular-nums">{{ formatTokens(m.calls) }}</td>
                  <td class="px-3 py-2 tabular-nums">{{ formatUsd(m.costUsd) }}</td>
                </tr>
                <tr v-if="usage.byModel.length === 0">
                  <td colspan="4" class="px-3 py-10 text-center text-muted-foreground">
                    {{ t('usage.empty') }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          </CardContent>
        </Card>

        <!-- byPurpose -->
        <Card>
          <CardHeader>
            <CardTitle class="text-lg">{{ t('usage.byPurpose') }}</CardTitle>
          </CardHeader>
          <CardContent class="p-0">
          <div class="overflow-x-auto">
            <table class="w-full text-sm">
              <thead>
                <tr class="border-b bg-muted/60 text-left [&>th]:px-3 [&>th]:py-2 [&>th]:text-xs [&>th]:font-semibold [&>th]:text-ink-600">
                  <th class="px-3 py-2 font-medium">{{ t('usage.purpose') }}</th>
                  <th class="px-3 py-2 font-medium">{{ t('usage.calls') }}</th>
                  <th class="px-3 py-2 font-medium">{{ t('usage.totalCost') }}</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="(p, i) in usage.byPurpose"
                  :key="`${p.purpose}-${i}`"
                  class="border-b last:border-b-0"
                >
                  <td class="px-3 py-2">{{ p.purpose }}</td>
                  <td class="px-3 py-2 tabular-nums">{{ formatTokens(p.calls) }}</td>
                  <td class="px-3 py-2 tabular-nums">{{ formatUsd(p.costUsd) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          </CardContent>
        </Card>
      </div>

      <p v-else class="text-sm text-muted-foreground">{{ t('usage.empty') }}</p>
    </template>
  </div>
</template>
