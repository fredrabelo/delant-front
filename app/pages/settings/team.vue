<script setup lang="ts">
import { computed, h, onMounted, ref } from 'vue'
import {
  FlexRender,
  type ColumnDef,
  getCoreRowModel,
  useVueTable,
} from '@tanstack/vue-table'
import { useI18n } from '#imports'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import RegistrySelect from '@/components/RegistrySelect.vue'
import PageHeader from '@/components/PageHeader.vue'
import { useApi } from '@/composables/useApi'
import type { ApiError } from '@/composables/useApi'
import type { Department, MembershipRow, RegistryOption } from '@/types/api'

const { t } = useI18n()
const api = useApi()

const members = ref<MembershipRow[]>([])
const roleOptions = ref<RegistryOption[]>([])
const departments = ref<Department[]>([])
const loading = ref(false)
const error = ref<string | null>(null)

const inviteForm = ref({ email: '', role: '', departmentId: '' })
const inviting = ref(false)
const inviteError = ref<string | null>(null)

async function loadData() {
  loading.value = true
  error.value = null
  try {
    const [rows, roles, deps] = await Promise.all([
      api.get<MembershipRow[]>('/memberships'),
      api.get<RegistryOption[]>('/memberships/roles/options'),
      api.get<Department[]>('/departments'),
    ])
    members.value = rows ?? []
    roleOptions.value = roles ?? []
    departments.value = deps ?? []
  }
  catch (err) {
    error.value = (err as ApiError)?.message ?? t('common.error')
  }
  finally {
    loading.value = false
  }
}

async function onInvite() {
  inviting.value = true
  inviteError.value = null
  try {
    await api.post<MembershipRow>('/memberships', {
      email: inviteForm.value.email,
      role: inviteForm.value.role,
      departmentId: inviteForm.value.departmentId || undefined,
    })
    inviteForm.value = { email: '', role: '', departmentId: '' }
    await loadData()
  }
  catch (err) {
    inviteError.value = (err as ApiError)?.message ?? t('common.error')
  }
  finally {
    inviting.value = false
  }
}

const columns = computed<ColumnDef<MembershipRow>[]>(() => [
  {
    id: 'user',
    header: () => t('team.columns.user'),
    cell: ({ row }) => row.original.user?.name ?? row.original.user?.email ?? row.original.userId,
  },
  {
    accessorKey: 'role',
    header: () => t('team.columns.role'),
    cell: ({ row }) => t(`registry.membership_role.${row.original.role}`),
  },
  {
    id: 'department',
    header: () => t('team.columns.department'),
    cell: ({ row }) => row.original.department?.name ?? '—',
  },
])

const table = useVueTable({
  get data() {
    return members.value
  },
  get columns() {
    return columns.value
  },
  getCoreRowModel: getCoreRowModel(),
})

onMounted(loadData)
</script>

<template>
  <div class="space-y-6">
    <PageHeader :title="t('team.title')" />

    <p v-if="error" class="text-sm text-destructive" role="alert">{{ error }}</p>

    <Card class="max-w-xl">
      <CardHeader>
        <CardTitle class="text-lg">{{ t('team.invite.title') }}</CardTitle>
      </CardHeader>
      <CardContent>
      <form class="space-y-4" @submit.prevent="onInvite">
        <div class="space-y-1">
          <label class="text-sm font-medium" for="m-user">{{ t('team.fields.email') }}</label>
          <Input id="m-user" v-model="inviteForm.email" type="email" required />
          <p class="text-xs text-muted-foreground">{{ t('team.invite.emailHint') }}</p>
        </div>
        <div class="space-y-1">
          <label class="text-sm font-medium" for="m-role">{{ t('team.fields.role') }}</label>
          <RegistrySelect
            id="m-role"
            v-model="inviteForm.role"
            :options="roleOptions"
            :placeholder="t('common.select')"
          />
        </div>
        <div class="space-y-1">
          <label class="text-sm font-medium" for="m-dep">{{ t('team.fields.department') }}</label>
          <select
            id="m-dep"
            v-model="inviteForm.departmentId"
            class="field-select"
          >
            <option value="">{{ t('common.select') }}</option>
            <option v-for="d in departments" :key="d.id" :value="d.id">{{ d.name }}</option>
          </select>
        </div>

        <p v-if="inviteError" class="text-sm text-destructive" role="alert">{{ inviteError }}</p>

        <Button type="submit" :disabled="inviting || !inviteForm.role || !inviteForm.email">
          {{ inviting ? t('common.loading') : t('team.invite.submit') }}
        </Button>
      </form>
      </CardContent>
    </Card>

    <Card>
      <CardHeader>
        <CardTitle class="text-lg">{{ t('team.members') }}</CardTitle>
      </CardHeader>
      <CardContent class="p-0">
      <p v-if="loading" class="p-6 text-sm text-muted-foreground">{{ t('common.loading') }}</p>
      <div v-else>
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
            <TableRow v-for="row in table.getRowModel().rows" :key="row.id">
              <TableCell v-for="cell in row.getVisibleCells()" :key="cell.id">
                <FlexRender :render="cell.column.columnDef.cell" :props="cell.getContext()" />
              </TableCell>
            </TableRow>
            <TableRow v-if="table.getRowModel().rows.length === 0">
              <TableCell :colspan="columns.length" class="py-10 text-center text-muted-foreground">
                {{ t('team.empty') }}
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>
      </CardContent>
    </Card>
  </div>
</template>
