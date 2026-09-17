<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from '#imports'
import { navigateTo, useRoute } from '#app'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import PageHeader from '@/components/PageHeader.vue'
import RegistrySelect from '@/components/RegistrySelect.vue'
import { useApi } from '@/composables/useApi'
import type { ApiError } from '@/composables/useApi'
import { useAuth } from '@/composables/useAuth'
import type { AccessLogRow, Client, MembershipRow, RegistryOption } from '@/types/api'

const { t } = useI18n()
const route = useRoute()
const api = useApi()
const { user } = useAuth()

const clientId = computed(() => String(route.params.id))
const isStaff = computed(() => user.value?.isPlatformStaff === true)

const client = ref<Client | null>(null)
const members = ref<MembershipRow[]>([])
const roleOptions = ref<RegistryOption[]>([])
const accessLogs = ref<AccessLogRow[]>([])
const loading = ref(false)
const error = ref<string | null>(null)

const inviteForm = ref({ email: '', role: '', isNewAccount: false, name: '', password: '' })
const inviting = ref(false)
const inviteError = ref<string | null>(null)

const canInvite = computed(() => {
  if (!inviteForm.value.email.trim() || !inviteForm.value.role) return false
  if (inviteForm.value.isNewAccount) {
    return inviteForm.value.name.trim() !== '' && inviteForm.value.password.length >= 8
  }
  return true
})

function formatDate(value: string): string {
  try {
    return new Date(value).toLocaleString()
  }
  catch {
    return value
  }
}

async function loadData() {
  loading.value = true
  error.value = null
  try {
    const [c, rows, roles, logs] = await Promise.all([
      api.get<Client>(`/clients/${clientId.value}`),
      api.get<MembershipRow[]>(`/clients/${clientId.value}/memberships`),
      api.get<RegistryOption[]>('/memberships/roles/options'),
      api.get<AccessLogRow[]>('/admin/access-logs', { query: { clientId: clientId.value } }),
    ])
    client.value = c
    members.value = rows ?? []
    roleOptions.value = roles ?? []
    accessLogs.value = logs ?? []
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
    const email = inviteForm.value.email.trim()
    if (inviteForm.value.isNewAccount) {
      // Self-registration is closed — staff provisions the account first,
      // then attaches it to this org in a second call.
      await api.post('/admin/users', {
        email,
        name: inviteForm.value.name.trim(),
        password: inviteForm.value.password,
      })
    }
    await api.post(`/clients/${clientId.value}/memberships`, {
      email,
      role: inviteForm.value.role,
    })
    inviteForm.value = { email: '', role: '', isNewAccount: false, name: '', password: '' }
    await loadData()
  }
  catch (err) {
    inviteError.value = (err as ApiError)?.message ?? t('common.error')
  }
  finally {
    inviting.value = false
  }
}

async function onRemoveMember(userId: string) {
  error.value = null
  try {
    await api.delete(`/clients/${clientId.value}/memberships/${userId}`)
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
      :title="client?.name ?? t('common.loading')"
      :description="t('admin.clients.detailSubtitle')"
    />

    <p v-if="error" class="text-sm text-destructive" role="alert">{{ error }}</p>
    <p v-if="loading" class="text-sm text-muted-foreground">{{ t('common.loading') }}</p>

    <template v-if="!loading">
      <!-- Members -->
      <Card>
        <CardHeader>
          <CardTitle class="text-lg">{{ t('admin.clients.members') }}</CardTitle>
        </CardHeader>
        <CardContent class="p-0">
          <p v-if="members.length === 0" class="p-10 text-center text-sm text-muted-foreground">
            {{ t('team.empty') }}
          </p>
          <ul v-else class="divide-y">
            <li v-for="m in members" :key="m.userId" class="flex items-center justify-between gap-3 p-4">
              <div>
                <p class="text-sm font-medium">{{ m.user?.name ?? m.user?.email ?? m.userId }}</p>
                <p class="text-xs text-muted-foreground">{{ m.user?.email }} · {{ m.role }}</p>
              </div>
              <Button variant="outline" size="sm" @click="onRemoveMember(m.userId)">
                {{ t('common.delete') }}
              </Button>
            </li>
          </ul>
        </CardContent>
      </Card>

      <!-- Add member -->
      <Card>
        <CardHeader>
          <CardTitle class="text-lg">{{ t('team.invite.title') }}</CardTitle>
        </CardHeader>
        <CardContent>
          <form class="space-y-4" @submit.prevent="onInvite">
            <label class="flex items-center gap-2 text-sm">
              <input v-model="inviteForm.isNewAccount" type="checkbox">
              {{ t('admin.clients.newAccount') }}
            </label>

            <div class="grid gap-4 sm:grid-cols-2">
              <div class="space-y-1">
                <label class="text-sm font-medium" for="am-email">{{ t('team.fields.email') }}</label>
                <Input id="am-email" v-model="inviteForm.email" type="email" required />
              </div>
              <div class="space-y-1">
                <label class="text-sm font-medium" for="am-role">{{ t('team.fields.role') }}</label>
                <RegistrySelect id="am-role" v-model="inviteForm.role" :options="roleOptions" :placeholder="t('common.select')" />
              </div>
              <template v-if="inviteForm.isNewAccount">
                <div class="space-y-1">
                  <label class="text-sm font-medium" for="am-name">{{ t('auth.fields.name') }}</label>
                  <Input id="am-name" v-model="inviteForm.name" />
                </div>
                <div class="space-y-1">
                  <label class="text-sm font-medium" for="am-password">{{ t('admin.clients.newAccountPassword') }}</label>
                  <Input id="am-password" v-model="inviteForm.password" type="text" minlength="8" />
                  <p class="text-xs text-muted-foreground">{{ t('admin.clients.newAccountPasswordHint') }}</p>
                </div>
              </template>
            </div>
            <p v-if="!inviteForm.isNewAccount" class="text-xs text-muted-foreground">{{ t('team.invite.emailHint') }}</p>
            <p v-if="inviteError" class="text-sm text-destructive" role="alert">{{ inviteError }}</p>
            <Button type="submit" :disabled="inviting || !canInvite">
              {{ inviting ? t('common.loading') : t('team.invite.submit') }}
            </Button>
          </form>
        </CardContent>
      </Card>

      <!-- Access log -->
      <Card>
        <CardHeader>
          <CardTitle class="text-lg">{{ t('admin.clients.accessLog') }}</CardTitle>
        </CardHeader>
        <CardContent class="p-0">
          <p v-if="accessLogs.length === 0" class="p-10 text-center text-sm text-muted-foreground">
            {{ t('admin.clients.accessLogEmpty') }}
          </p>
          <ul v-else class="divide-y">
            <li v-for="log in accessLogs" :key="log.id" class="flex items-center justify-between gap-3 px-4 py-2 text-sm">
              <span>{{ log.user?.name ?? log.user?.email ?? log.userId }} — {{ log.event }}</span>
              <span class="text-xs text-muted-foreground">{{ formatDate(log.createdAt) }}</span>
            </li>
          </ul>
        </CardContent>
      </Card>
    </template>
  </div>
</template>
