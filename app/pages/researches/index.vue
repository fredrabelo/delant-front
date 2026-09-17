<script setup lang="ts">
import { computed, h, onMounted, ref } from 'vue'
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
import type { Research } from '@/types/api'

const { t } = useI18n()
const api = useApi()

const researches = ref<Research[]>([])
const loading = ref(false)
const error = ref<string | null>(null)

async function loadResearches() {
  loading.value = true
  error.value = null
  try {
    researches.value = await api.get<Research[]>('/researches') ?? []
  }
  catch (err) {
    error.value = (err as ApiError)?.message ?? t('common.error')
  }
  finally {
    loading.value = false
  }
}

function goToResearch(id: string) {
  void navigateTo(`/researches/${id}`)
}

// Creating a research now goes through the Experiment Builder (single path).
function goToBuilder() {
  void navigateTo('/builder')
}

const columns = computed<ColumnDef<Research>[]>(() => [
  {
    accessorKey: 'name',
    header: () => t('researches.columns.name'),
    cell: ({ row }) => row.original.name,
  },
  {
    accessorKey: 'status',
    header: () => t('researches.columns.status'),
    cell: ({ row }) => h(StatusBadge, { status: row.original.status }),
  },
  {
    accessorKey: 'createdAt',
    header: () => t('researches.columns.created'),
    cell: ({ row }) => row.original.createdAt
      ? new Date(row.original.createdAt).toLocaleDateString()
      : '—',
  },
])

const table = useVueTable({
  get data() {
    return researches.value
  },
  get columns() {
    return columns.value
  },
  getCoreRowModel: getCoreRowModel(),
})

onMounted(loadResearches)
</script>

<template>
  <div class="space-y-6">
    <PageHeader :title="t('researches.title')" :description="t('researches.subtitle')">
      <template #actions>
        <Button @click="goToBuilder">{{ t('researches.new') }}</Button>
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
            @click="goToResearch(row.original.id)"
          >
            <TableCell v-for="cell in row.getVisibleCells()" :key="cell.id">
              <FlexRender :render="cell.column.columnDef.cell" :props="cell.getContext()" />
            </TableCell>
          </TableRow>
          <TableRow v-if="table.getRowModel().rows.length === 0">
            <TableCell :colspan="columns.length" class="py-10 text-center text-muted-foreground">
              {{ t('researches.empty') }}
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </Card>
  </div>
</template>
