<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from '#imports'
import { navigateTo } from '#app'
import { NuxtLink } from '#components'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import PageHeader from '@/components/PageHeader.vue'
import RegistrySelect from '@/components/RegistrySelect.vue'
import { useApi } from '@/composables/useApi'
import type { ApiError } from '@/composables/useApi'
import { useAuth } from '@/composables/useAuth'
import type { Client, Country, RegistryOption } from '@/types/api'

const { t } = useI18n()
const api = useApi()
const { user } = useAuth()

// Staff-only page: bounce everyone else to home.
const isStaff = computed(() => user.value?.isPlatformStaff === true)

const clients = ref<Client[]>([])
const sectorOptions = ref<RegistryOption[]>([])
const countries = ref<Country[]>([])
const loading = ref(false)
const error = ref<string | null>(null)

const form = ref({ name: '', sectorKey: '', legalName: '', countryId: '', ownerEmail: '' })
const creating = ref(false)
const createError = ref<string | null>(null)

const canCreate = computed(() => form.value.name.trim() !== '' && form.value.sectorKey !== '')

async function loadData() {
  loading.value = true
  error.value = null
  try {
    const [rows, sectors, cs] = await Promise.all([
      api.get<Client[]>('/clients'),
      api.get<RegistryOption[]>('/clients/sectors/options'),
      api.get<Country[]>('/countries'),
    ])
    clients.value = rows ?? []
    sectorOptions.value = sectors ?? []
    countries.value = cs ?? []
  }
  catch (err) {
    error.value = (err as ApiError)?.message ?? t('common.error')
  }
  finally {
    loading.value = false
  }
}

async function onCreate() {
  creating.value = true
  createError.value = null
  try {
    await api.post<Client>('/clients', {
      name: form.value.name.trim(),
      sectorKey: form.value.sectorKey,
      legalName: form.value.legalName.trim() || undefined,
      countryId: form.value.countryId || undefined,
      ownerEmail: form.value.ownerEmail.trim() || undefined,
    })
    form.value = { name: '', sectorKey: '', legalName: '', countryId: '', ownerEmail: '' }
    await loadData()
  }
  catch (err) {
    createError.value = (err as ApiError)?.message ?? t('common.error')
  }
  finally {
    creating.value = false
  }
}

async function onToggleStatus(client: Client) {
  error.value = null
  const nextStatus = client.status === 'active' ? 'inactive' : 'active'
  try {
    await api.patch<Client>(`/clients/${client.id}/status`, { status: nextStatus })
    await loadData()
  }
  catch (err) {
    error.value = (err as ApiError)?.message ?? t('common.error')
  }
}

onMounted(async () => {
  if (!isStaff.value) {
    await navigateTo('/')
    return
  }
  await loadData()
})
</script>

<template>
  <div v-if="isStaff" class="space-y-6 max-w-4xl">
    <PageHeader
      :title="t('admin.clients.title')"
      :description="t('admin.clients.subtitle')"
    />

    <p v-if="error" class="text-sm text-destructive" role="alert">{{ error }}</p>

    <!-- Existing orgs -->
    <Card>
      <CardHeader>
        <CardTitle class="text-lg">{{ t('admin.clients.existing') }}</CardTitle>
      </CardHeader>
      <CardContent class="p-0">
        <p v-if="loading" class="p-4 text-sm text-muted-foreground">{{ t('common.loading') }}</p>
        <p v-else-if="clients.length === 0" class="p-10 text-center text-sm text-muted-foreground">
          {{ t('admin.clients.none') }}
        </p>
        <ul v-else class="divide-y">
          <li v-for="c in clients" :key="c.id" class="flex flex-wrap items-center justify-between gap-3 p-4">
            <div>
              <NuxtLink :to="`/admin/clients/${c.id}`" class="font-medium hover:underline">
                {{ c.name }}
              </NuxtLink>
              <p class="text-xs text-muted-foreground">
                #{{ c.id }} · {{ c.sectorKey }} · {{ c.plan ?? '—' }} · {{ c.status ?? 'active' }}
              </p>
            </div>
            <div class="flex items-center gap-2">
              <NuxtLink :to="`/admin/clients/${c.id}`">
                <Button variant="outline" size="sm">{{ t('admin.clients.viewMembers') }}</Button>
              </NuxtLink>
              <Button variant="outline" size="sm" @click="onToggleStatus(c)">
                {{ c.status === 'inactive' ? t('admin.clients.reactivate') : t('admin.clients.deactivate') }}
              </Button>
            </div>
          </li>
        </ul>
      </CardContent>
    </Card>

    <!-- Create org -->
    <Card>
      <CardHeader>
        <CardTitle class="text-lg">{{ t('admin.clients.create') }}</CardTitle>
      </CardHeader>
      <CardContent class="space-y-4">
        <p v-if="createError" class="text-sm text-destructive" role="alert">{{ createError }}</p>

        <div class="grid gap-4 sm:grid-cols-2">
          <div class="space-y-1">
            <label class="text-sm font-medium" for="ac-name">{{ t('clients.fields.name') }}</label>
            <Input id="ac-name" v-model="form.name" />
          </div>
          <div class="space-y-1">
            <label class="text-sm font-medium" for="ac-sector">{{ t('clients.fields.sector') }}</label>
            <RegistrySelect id="ac-sector" v-model="form.sectorKey" :options="sectorOptions" :placeholder="t('common.select')" />
          </div>
          <div class="space-y-1">
            <label class="text-sm font-medium" for="ac-legal">{{ t('clients.fields.legalName') }}</label>
            <Input id="ac-legal" v-model="form.legalName" />
          </div>
          <div class="space-y-1">
            <label class="text-sm font-medium" for="ac-country">{{ t('clients.fields.country') }}</label>
            <select id="ac-country" v-model="form.countryId" class="field-select">
              <option value="">{{ t('common.select') }}</option>
              <option v-for="c in countries" :key="c.id" :value="c.id">{{ c.name }}</option>
            </select>
          </div>
          <div class="space-y-1 sm:col-span-2">
            <label class="text-sm font-medium" for="ac-owner">{{ t('admin.clients.ownerEmail') }}</label>
            <Input id="ac-owner" v-model="form.ownerEmail" type="email" placeholder="cliente@empresa.com" />
            <p class="text-xs text-muted-foreground">{{ t('admin.clients.ownerEmailHint') }}</p>
          </div>
        </div>

        <Button :disabled="!canCreate || creating" @click="onCreate">
          {{ creating ? t('common.loading') : t('admin.clients.createButton') }}
        </Button>
      </CardContent>
    </Card>
  </div>
</template>
