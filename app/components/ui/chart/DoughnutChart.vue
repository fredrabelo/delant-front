<script setup lang="ts">
import { computed } from 'vue'
import { Doughnut } from 'vue-chartjs'
import type { ChartData, ChartOptions } from 'chart.js'
import { useChartColors } from '@/composables/useChartColors'

const props = withDefaults(
  defineProps<{
    labels: string[]
    values: number[]
    valueFormat?: (v: number) => string
    height?: number
  }>(),
  { height: 240 },
)

const { categorical, mutedForeground } = useChartColors()

const chartData = computed<ChartData<'doughnut'>>(() => ({
  labels: props.labels,
  datasets: [
    {
      data: props.values,
      backgroundColor: categorical(props.labels.length),
      borderWidth: 0,
    },
  ],
}))

const format = (v: number) => (props.valueFormat ? props.valueFormat(v) : String(v))

const chartOptions = computed<ChartOptions<'doughnut'>>(() => ({
  responsive: true,
  maintainAspectRatio: false,
  cutout: '62%',
  plugins: {
    legend: {
      position: 'right',
      labels: { color: mutedForeground, boxWidth: 10, boxHeight: 10, font: { size: 11 } },
    },
    tooltip: {
      callbacks: {
        label: (ctx) => `${ctx.label}: ${format(ctx.parsed as number)}`,
      },
    },
  },
}))
</script>

<template>
  <div :style="{ height: `${height}px` }">
    <Doughnut :data="chartData" :options="chartOptions" />
  </div>
</template>
