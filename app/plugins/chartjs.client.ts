import {
  ArcElement,
  BarController,
  BarElement,
  CategoryScale,
  Chart,
  DoughnutController,
  Legend,
  LinearScale,
  LineController,
  LineElement,
  PointElement,
  Tooltip,
} from 'chart.js'

/**
 * Registers only the Chart.js building blocks the app's chart components use
 * (bar + line + doughnut), once, client-side. Avoids importing the full
 * chart.js bundle (chart.js/auto) for a smaller build.
 */
export default defineNuxtPlugin(() => {
  Chart.register(
    BarController,
    BarElement,
    LineController,
    LineElement,
    PointElement,
    DoughnutController,
    ArcElement,
    CategoryScale,
    LinearScale,
    Legend,
    Tooltip,
  )
})
