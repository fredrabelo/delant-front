<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from '#imports'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { BarChart, DoughnutChart } from '@/components/ui/chart'
import type { VisualizationData } from '@/types/api'

/**
 * Chart renderer for visualization data (SPEC 8.2), backed by Chart.js:
 *
 * - bar / grouped_bar: BarChart, one series per group (grouped_bar just means
 *   2+ series — Chart.js renders them side by side per label either way).
 * - pie: DoughnutChart over the first series.
 * - table: renders `rows` (or a labels/series matrix when rows are absent).
 *
 * Straight corners throughout (the app's `--radius: 0`); colors come from
 * the shared `useChartColors` categorical palette so every chart in the app
 * — here and in the analysis result panels — looks like one system.
 */
const props = defineProps<{
  data: VisualizationData
}>()

const { t } = useI18n()

const labels = computed(() => props.data.labels ?? [])
const series = computed(() => props.data.series ?? [])

const barSeries = computed(() =>
  series.value.map(s => ({ label: s.name, data: s.values })),
)

// table: prefer explicit rows; otherwise build a matrix from labels + series.
const tableRows = computed<Array<Record<string, unknown>>>(() => {
  if (props.data.rows && props.data.rows.length > 0) {
    return props.data.rows
  }
  return labels.value.map((label, i) => {
    const row: Record<string, unknown> = { label }
    for (const s of series.value) {
      row[s.name] = s.values[i] ?? 0
    }
    return row
  })
})

const tableColumns = computed<string[]>(() => {
  const first = tableRows.value[0]
  return first ? Object.keys(first) : []
})

function cellText(value: unknown): string {
  if (value === null || value === undefined) {
    return '—'
  }
  return String(value)
}
</script>

<template>
  <div class="w-full">
    <!-- table -->
    <div v-if="data.chartType === 'table'" class="border bg-card shadow-sm">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead v-for="col in tableColumns" :key="col">{{ col }}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow v-for="(row, i) in tableRows" :key="i">
            <TableCell v-for="col in tableColumns" :key="col">{{ cellText(row[col]) }}</TableCell>
          </TableRow>
          <TableRow v-if="tableRows.length === 0">
            <TableCell :colspan="Math.max(tableColumns.length, 1)" class="text-center text-muted-foreground">
              {{ t('visualizations.chart.noData') }}
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>

    <!-- pie -->
    <template v-else-if="data.chartType === 'pie'">
      <DoughnutChart v-if="labels.length > 0" :labels="labels" :values="series[0]?.values ?? []" />
      <p v-else class="text-sm text-muted-foreground">{{ t('visualizations.chart.noData') }}</p>
    </template>

    <!-- bar / grouped_bar -->
    <template v-else>
      <BarChart
        v-if="labels.length > 0"
        :labels="labels"
        :series="barSeries"
        :horizontal="labels.length > 8"
      />
      <p v-else class="text-sm text-muted-foreground">{{ t('visualizations.chart.noData') }}</p>
    </template>
  </div>
</template>
