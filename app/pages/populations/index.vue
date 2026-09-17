<script setup lang="ts">
import { computed, h, onBeforeUnmount, onMounted, ref } from 'vue'
import {
  FlexRender,
  type ColumnDef,
  getCoreRowModel,
  useVueTable,
} from '@tanstack/vue-table'
import { useI18n } from '#imports'
import { navigateTo } from '#app'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import PageHeader from '@/components/PageHeader.vue'
import StatusBadge from '@/components/StatusBadge.vue'
import { useApi } from '@/composables/useApi'
import type { ApiError } from '@/composables/useApi'
import type { Population, PopulationStatusResponse } from '@/types/api'

const { t } = useI18n()
const api = useApi()

const populations = ref<Population[]>([])
const loading = ref(false)
const error = ref<string | null>(null)

let pollTimer: ReturnType<typeof setInterval> | null = null

async function loadPopulations() {
  loading.value = true
  error.value = null
  try {
    populations.value = await api.get<Population[]>('/populations') ?? []
  }
  catch (err) {
    error.value = (err as ApiError)?.message ?? t('common.error')
  }
  finally {
    loading.value = false
  }
}

async function pollGenerating() {
  const generating = populations.value.filter(p => p.status === 'generating')
  if (generating.length === 0) {
    return
  }
  await Promise.all(generating.map(async (p) => {
    try {
      const st = await api.get<PopulationStatusResponse>(`/populations/${p.id}/status`)
      p.status = st.status
      p.agentCount = st.agentCount ?? p.agentCount
    }
    catch {
      // Ignore transient poll errors; next tick retries.
    }
  }))
}

const columns = computed<ColumnDef<Population>[]>(() => [
  {
    accessorKey: 'name',
    header: () => t('populations.columns.name'),
    cell: ({ row }) => row.original.name,
  },
  {
    accessorKey: 'status',
    header: () => t('populations.columns.status'),
    cell: ({ row }) => h(StatusBadge, { status: row.original.status }),
  },
  {
    accessorKey: 'agentCount',
    header: () => t('populations.columns.agentCount'),
    cell: ({ row }) => row.original.agentCount ?? '—',
  },
])

const table = useVueTable({
  get data() {
    return populations.value
  },
  get columns() {
    return columns.value
  },
  getCoreRowModel: getCoreRowModel(),
})

function goToPopulation(id: string) {
  void navigateTo(`/populations/${id}`)
}

onMounted(async () => {
  await loadPopulations()
  pollTimer = setInterval(pollGenerating, 2000)
})

onBeforeUnmount(() => {
  if (pollTimer) {
    clearInterval(pollTimer)
  }
})
</script>

<template>
  <div class="space-y-6">
    <PageHeader :title="t('populations.title')" :description="t('populations.subtitle')">
      <template #actions>
        <Button @click="() => navigateTo('/populations/new')">{{ t('populations.new') }}</Button>
      </template>
    </PageHeader>

    <p v-if="error" class="text-sm text-destructive" role="alert">{{ error }}</p>
    <p v-if="loading" class="text-sm text-muted-foreground">{{ t('common.loading') }}</p>

    <Card v-else class="overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow v-for="hg in table.getHeaderGroups()" :key="hg.id">
            <TableHead v-for="header in hg.headers" :key="header.id">
              <FlexRender
                v-if="!header.isPlaceholder"
                :render="header.column.columnDef.header"
                :props="header.getContext()"
              />
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow
            v-for="row in table.getRowModel().rows"
            :key="row.id"
            class="cursor-pointer"
            @click="goToPopulation(row.original.id)"
          >
            <TableCell v-for="cell in row.getVisibleCells()" :key="cell.id">
              <FlexRender :render="cell.column.columnDef.cell" :props="cell.getContext()" />
            </TableCell>
          </TableRow>
          <TableRow v-if="table.getRowModel().rows.length === 0">
            <TableCell :colspan="columns.length" class="py-10 text-center text-muted-foreground">
              {{ t('populations.empty') }}
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </Card>
  </div>
</template>
