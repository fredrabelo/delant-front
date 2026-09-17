<script setup lang="ts">
import { computed } from 'vue'
import { Bar } from 'vue-chartjs'
import type { ChartData, ChartOptions } from 'chart.js'
import { useChartColors } from '@/composables/useChartColors'

interface Series {
  label: string
  data: number[]
  /** CSS color; defaults to the theme's categorical sequence by series index. */
  color?: string
}

const props = withDefaults(
  defineProps<{
    labels: string[]
    series: Series[]
    /** Renders as horizontal bars (good for ranked/long labels). */
    horizontal?: boolean
    /** Format each value for the axis + tooltip, e.g. a percent. */
    valueFormat?: (v: number) => string
    height?: number
    /** Hide the legend (default: shown only when there's more than one series). */
    legend?: boolean
    stacked?: boolean
    /**
     * Fix the value axis to exact ticks (e.g. an ordinal 1..4 scale) instead of
     * Chart.js's auto-generated "nice numbers", which can land on fractional
     * ticks (1.5, 2.5, ...) — those round to the same label as their integer
     * neighbor under a discrete `valueFormat`, rendering as visible duplicates.
     */
    min?: number
    max?: number
    stepSize?: number
  }>(),
  { height: 240, horizontal: false },
)

const { categorical, mutedForeground, border } = useChartColors()

const chartData = computed<ChartData<'bar'>>(() => {
  const colors = categorical(props.series.length)
  return {
    labels: props.labels,
    datasets: props.series.map((s, i) => ({
      label: s.label,
      data: s.data,
      backgroundColor: s.color ?? colors[i % colors.length],
      borderRadius: 2,
      maxBarThickness: 28,
    })),
  }
})

const showLegend = computed(() => props.legend ?? props.series.length > 1)

const format = (v: number) => (props.valueFormat ? props.valueFormat(v) : String(v))

const chartOptions = computed<ChartOptions<'bar'>>(() => ({
  responsive: true,
  maintainAspectRatio: false,
  indexAxis: props.horizontal ? 'y' : 'x',
  interaction: { mode: 'nearest', intersect: true },
  plugins: {
    legend: {
      display: showLegend.value,
      position: 'bottom',
      labels: { color: mutedForeground, boxWidth: 10, boxHeight: 10, font: { size: 11 } },
    },
    tooltip: {
      callbacks: {
        label: (ctx) => `${ctx.dataset.label}: ${format(ctx.parsed[props.horizontal ? 'x' : 'y'] as number)}`,
      },
    },
  },
  scales: {
    x: buildAxis(props.horizontal),
    y: buildAxis(!props.horizontal),
    // Chart.js's scale generics are keyed to the literal x/y shape and don't
    // structurally match a value built by a shared helper; the runtime shape
    // (built from the same fields either default config used) is correct.
  } as ChartOptions<'bar'>['scales'],
}))

/**
 * Builds one axis's scale config. `isValueAxis` says whether THIS axis is the
 * numeric value axis (true) or the category/index axis (false) for the
 * current orientation. Chart.js's CategoryScale supplies its own tick
 * `callback` (`_getLabelForValue`, resolving each tick to its label string) —
 * an explicit `callback: undefined` on the category axis would shadow that
 * default during Chart.js's options merge and the axis would fall back to
 * showing raw numeric indices, so value-axis-only keys (`callback`,
 * `stepSize`, `min`, `max`) are omitted entirely on the category axis rather
 * than set to `undefined`.
 */
function buildAxis(isValueAxis: boolean) {
  return {
    stacked: props.stacked,
    grid: { display: !isValueAxis, color: border },
    ticks: {
      color: mutedForeground,
      font: { size: 11 },
      ...(isValueAxis
        ? { callback: (v: number) => format(Number(v)), ...(props.stepSize !== undefined ? { stepSize: props.stepSize } : {}) }
        : {}),
    },
    // The value axis always starts at zero — otherwise bar length stops being
    // a fair visual comparison (e.g. an ordinal 2-vs-4 pair would look
    // near-equal if the axis auto-scaled to start around 1).
    beginAtZero: isValueAxis,
    ...(isValueAxis && props.min !== undefined ? { min: props.min } : {}),
    ...(isValueAxis && props.max !== undefined ? { max: props.max } : {}),
  }
}
</script>

<template>
  <div :style="{ height: `${height}px` }">
    <Bar :data="chartData" :options="chartOptions" />
  </div>
</template>
