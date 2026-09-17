<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from '#imports'
import { navigateTo } from '#app'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import PageHeader from '@/components/PageHeader.vue'
import { useApi } from '@/composables/useApi'
import type { ApiError } from '@/composables/useApi'
import { useAuth } from '@/composables/useAuth'
import type { Channel } from '@/types/api'

const { t, locale } = useI18n()
const api = useApi()
const { user } = useAuth()

// Staff-only page: bounce everyone else to home.
const isStaff = computed(() => user.value?.isPlatformStaff === true)

const channels = ref<Channel[]>([])
const loading = ref(false)
const error = ref<string | null>(null)

const form = ref({
  channelKey: '',
  family: '',
  labelPt: '',
  labelEn: '',
  defaultReach: 0.1,
  defaultDiffusionRate: 0.15,
  isOfficial: true,
})
const creating = ref(false)
const createError = ref<string | null>(null)

const canCreate = computed(() =>
  form.value.channelKey.trim() !== ''
  && form.value.labelPt.trim() !== ''
  && form.value.labelEn.trim() !== '',
)

async function loadData() {
  loading.value = true
  error.value = null
  try {
    channels.value = await api.get<Channel[]>('/channels/admin/all', { query: { locale: locale.value } }) ?? []
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
    await api.post('/channels/admin', {
      channelKey: form.value.channelKey.trim(),
      family: form.value.family.trim() || undefined,
      defaultReach: form.value.defaultReach,
      defaultDiffusionRate: form.value.defaultDiffusionRate,
      isOfficial: form.value.isOfficial,
      labels: { 'pt-BR': form.value.labelPt.trim(), 'en-US': form.value.labelEn.trim() },
    })
    form.value.channelKey = ''
    form.value.family = ''
    form.value.labelPt = ''
    form.value.labelEn = ''
    await loadData()
  }
  catch (err) {
    createError.value = (err as ApiError)?.message ?? t('common.error')
  }
  finally {
    creating.value = false
  }
}

async function onPublish(channel: Channel) {
  error.value = null
  try {
    await api.post(`/channels/admin/${channel.id}/publish`, {})
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
  <div v-if="isStaff" class="space-y-6 max-w-3xl">
    <PageHeader
      :title="t('admin.channels.title')"
      :description="t('admin.channels.subtitle')"
    />

    <p v-if="error" class="text-sm text-destructive" role="alert">{{ error }}</p>

    <!-- Existing channels -->
    <Card>
      <CardHeader>
        <CardTitle class="text-lg">{{ t('admin.channels.existing') }}</CardTitle>
      </CardHeader>
      <CardContent class="space-y-2">
        <p v-if="loading" class="text-sm text-muted-foreground">{{ t('common.loading') }}</p>
        <p v-else-if="channels.length === 0" class="text-sm text-muted-foreground">
          {{ t('admin.channels.none') }}
        </p>
        <ul v-else class="divide-y border">
          <li v-for="c in channels" :key="c.id" class="flex items-center justify-between gap-3 px-3 py-2">
            <div>
              <p class="text-sm font-medium">
                {{ c.label || c.channelKey }} <span class="text-xs text-muted-foreground">({{ c.channelKey }})</span>
              </p>
              <p class="text-xs text-muted-foreground">
                {{ c.isOfficial ? t('admin.channels.official') : t('admin.channels.private') }}
                · {{ c.status }}
                <template v-if="c.family"> · {{ c.family }}</template>
                · reach {{ c.defaultReach ?? '—' }} · rate {{ c.defaultDiffusionRate ?? '—' }}
              </p>
            </div>
            <Button
              v-if="c.status !== 'published'"
              variant="outline"
              size="sm"
              @click="onPublish(c)"
            >
              {{ t('admin.channels.publish') }}
            </Button>
          </li>
        </ul>
      </CardContent>
    </Card>

    <!-- Create form -->
    <Card>
      <CardHeader>
        <CardTitle class="text-lg">{{ t('admin.channels.create') }}</CardTitle>
      </CardHeader>
      <CardContent class="space-y-4">
        <p v-if="createError" class="text-sm text-destructive" role="alert">{{ createError }}</p>

        <div class="grid gap-4 sm:grid-cols-2">
          <div class="space-y-1">
            <label class="text-sm font-medium" for="ch-key">{{ t('admin.channels.key') }}</label>
            <Input id="ch-key" v-model="form.channelKey" placeholder="ex.: youtube_ads" />
          </div>
          <div class="space-y-1">
            <label class="text-sm font-medium" for="ch-family">{{ t('admin.channels.family') }}</label>
            <Input id="ch-family" v-model="form.family" placeholder="ex.: social_media" />
          </div>
          <div class="space-y-1">
            <label class="text-sm font-medium" for="ch-name-pt">{{ t('admin.channels.labelPt') }}</label>
            <Input id="ch-name-pt" v-model="form.labelPt" />
          </div>
          <div class="space-y-1">
            <label class="text-sm font-medium" for="ch-name-en">{{ t('admin.channels.labelEn') }}</label>
            <Input id="ch-name-en" v-model="form.labelEn" />
          </div>
          <div class="space-y-1">
            <label class="text-sm font-medium" for="ch-reach">{{ t('admin.channels.defaultReach') }}</label>
            <Input id="ch-reach" v-model.number="form.defaultReach" type="number" min="0" max="1" step="0.01" />
          </div>
          <div class="space-y-1">
            <label class="text-sm font-medium" for="ch-rate">{{ t('admin.channels.defaultDiffusionRate') }}</label>
            <Input id="ch-rate" v-model.number="form.defaultDiffusionRate" type="number" min="0" max="1" step="0.01" />
          </div>
          <label class="flex items-center gap-2 text-sm">
            <input v-model="form.isOfficial" type="checkbox">
            {{ t('admin.channels.isOfficial') }}
          </label>
        </div>

        <Button :disabled="!canCreate || creating" @click="onCreate">
          {{ creating ? t('common.loading') : t('admin.channels.createButton') }}
        </Button>
      </CardContent>
    </Card>
  </div>
</template>
