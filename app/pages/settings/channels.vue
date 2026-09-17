<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from '#imports'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import PageHeader from '@/components/PageHeader.vue'
import { useApi } from '@/composables/useApi'
import type { ApiError } from '@/composables/useApi'
import { useActiveClient } from '@/composables/useActiveClient'
import type { Channel } from '@/types/api'

const { t, locale } = useI18n()
const api = useApi()
const { activeClient, loadClients } = useActiveClient()

const channels = ref<Channel[]>([])
const loading = ref(false)
const error = ref<string | null>(null)

const numbersVisible = computed(() => activeClient.value?.diffusionCalibrationVisible !== false)
const catalogChannels = computed(() => channels.value.filter(c => c.isOfficial))
const ownChannels = computed(() => channels.value.filter(c => !c.isOfficial))

const dialogOpen = ref(false)
const creating = ref(false)
const createError = ref<string | null>(null)
const form = ref({
  channelKey: '',
  family: '',
  defaultReach: '' as string | number,
  defaultDiffusionRate: '' as string | number,
  labelPt: '',
  labelEn: '',
})

async function loadChannels() {
  loading.value = true
  error.value = null
  try {
    channels.value = await api.get<Channel[]>('/channels', { query: { locale: locale.value } }) ?? []
  }
  catch (err) {
    error.value = (err as ApiError)?.message ?? t('common.error')
  }
  finally {
    loading.value = false
  }
}

function openDialog() {
  createError.value = null
  form.value = { channelKey: '', family: '', defaultReach: '', defaultDiffusionRate: '', labelPt: '', labelEn: '' }
  dialogOpen.value = true
}

const canCreate = computed(() =>
  form.value.channelKey.trim() !== ''
  && form.value.labelPt.trim() !== ''
  && form.value.labelEn.trim() !== '',
)

async function onCreate() {
  creating.value = true
  createError.value = null
  try {
    const reachRaw = String(form.value.defaultReach).trim()
    const rateRaw = String(form.value.defaultDiffusionRate).trim()
    const created = await api.post<Channel>('/channels', {
      channelKey: form.value.channelKey.trim(),
      family: form.value.family.trim() || undefined,
      defaultReach: reachRaw === '' ? undefined : Number(reachRaw),
      defaultDiffusionRate: rateRaw === '' ? undefined : Number(rateRaw),
      labels: {
        'pt-BR': form.value.labelPt.trim(),
        'en-US': form.value.labelEn.trim(),
      },
    })
    channels.value = [created, ...channels.value]
    dialogOpen.value = false
  }
  catch (err) {
    createError.value = (err as ApiError)?.message ?? t('common.error')
  }
  finally {
    creating.value = false
  }
}

async function onDelete(id: string) {
  try {
    await api.delete(`/channels/${id}`)
    channels.value = channels.value.filter(c => c.id !== id)
  }
  catch (err) {
    error.value = (err as ApiError)?.message ?? t('common.error')
  }
}

function channelLabel(channel: Channel): string {
  return channel.label ?? channel.channelKey ?? '—'
}

onMounted(async () => {
  if (!activeClient.value) await loadClients()
  await loadChannels()
})
</script>

<template>
  <div class="space-y-6 max-w-4xl">
    <PageHeader
      :title="t('channels.title')"
      :description="t('channels.subtitle')"
    >
      <template #actions>
        <Dialog v-model:open="dialogOpen">
          <DialogTrigger as-child>
            <Button @click="openDialog">{{ t('channels.new') }}</Button>
          </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{{ t('channels.new') }}</DialogTitle>
          </DialogHeader>
          <form class="space-y-4" @submit.prevent="onCreate">
            <div class="space-y-1">
              <label class="text-sm font-medium" for="ch-key">{{ t('channels.fields.channelKey') }}</label>
              <Input id="ch-key" v-model="form.channelKey" required />
            </div>
            <div class="grid gap-4 sm:grid-cols-3">
              <div class="space-y-1">
                <label class="text-sm font-medium" for="ch-family">{{ t('channels.fields.family') }}</label>
                <Input id="ch-family" v-model="form.family" :placeholder="t('channels.fields.familyPlaceholder')" />
              </div>
              <div class="space-y-1">
                <label class="text-sm font-medium" for="ch-reach">{{ t('channels.fields.defaultReach') }}</label>
                <Input id="ch-reach" v-model="form.defaultReach" type="number" step="0.01" min="0" max="1" />
              </div>
              <div class="space-y-1">
                <label class="text-sm font-medium" for="ch-rate">{{ t('channels.fields.defaultDiffusionRate') }}</label>
                <Input id="ch-rate" v-model="form.defaultDiffusionRate" type="number" step="0.01" min="0" max="1" />
              </div>
            </div>
            <div class="grid gap-4 sm:grid-cols-2">
              <div class="space-y-1">
                <label class="text-sm font-medium" for="ch-label-pt">{{ t('channels.fields.labelPt') }}</label>
                <Input id="ch-label-pt" v-model="form.labelPt" required />
              </div>
              <div class="space-y-1">
                <label class="text-sm font-medium" for="ch-label-en">{{ t('channels.fields.labelEn') }}</label>
                <Input id="ch-label-en" v-model="form.labelEn" required />
              </div>
            </div>

            <p v-if="createError" class="text-sm text-destructive" role="alert">{{ createError }}</p>

            <Button type="submit" :disabled="creating || !canCreate">
              {{ creating ? t('common.loading') : t('common.create') }}
            </Button>
          </form>
          </DialogContent>
        </Dialog>
      </template>
    </PageHeader>

    <p v-if="error" class="text-sm text-destructive" role="alert">{{ error }}</p>
    <p v-if="loading" class="text-sm text-muted-foreground">{{ t('common.loading') }}</p>

    <template v-else>
      <!-- Platform catalog: staff-curated, read-only here -->
      <Card>
        <CardHeader>
          <CardTitle class="text-lg">{{ t('channels.catalog.title') }}</CardTitle>
          <CardDescription>{{ t('channels.catalog.subtitle') }}</CardDescription>
        </CardHeader>
        <CardContent class="overflow-x-auto p-0">
          <table class="w-full text-sm">
            <thead>
              <tr class="border-b bg-muted/60 text-left [&>th]:px-3 [&>th]:py-2 [&>th]:text-xs [&>th]:font-semibold [&>th]:text-ink-600">
                <th class="px-3 py-2 font-medium">{{ t('channels.columns.label') }}</th>
                <th class="px-3 py-2 font-medium">{{ t('channels.columns.family') }}</th>
                <th v-if="numbersVisible" class="px-3 py-2 font-medium">{{ t('channels.columns.defaultReach') }}</th>
                <th v-if="numbersVisible" class="px-3 py-2 font-medium">{{ t('channels.columns.defaultDiffusionRate') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="c in catalogChannels" :key="c.id" class="border-b last:border-b-0">
                <td class="px-3 py-2 font-medium">{{ channelLabel(c) }}</td>
                <td class="px-3 py-2">{{ c.family ?? '—' }}</td>
                <td v-if="numbersVisible" class="px-3 py-2 tabular-nums">{{ c.defaultReach ?? '—' }}</td>
                <td v-if="numbersVisible" class="px-3 py-2 tabular-nums">{{ c.defaultDiffusionRate ?? '—' }}</td>
              </tr>
              <tr v-if="catalogChannels.length === 0">
                <td :colspan="numbersVisible ? 4 : 2" class="px-3 py-10 text-center text-muted-foreground">
                  {{ t('channels.catalog.empty') }}
                </td>
              </tr>
            </tbody>
          </table>
          <p v-if="!numbersVisible" class="border-t px-3 py-2 text-xs text-muted-foreground">
            {{ t('channels.catalog.numbersHidden') }}
          </p>
        </CardContent>
      </Card>

      <!-- This client's own private channels -->
      <Card>
        <CardHeader>
          <CardTitle class="text-lg">{{ t('channels.own.title') }}</CardTitle>
          <CardDescription>{{ t('channels.own.subtitle') }}</CardDescription>
        </CardHeader>
        <CardContent class="overflow-x-auto p-0">
        <table class="w-full text-sm">
          <thead>
            <tr class="border-b bg-muted/60 text-left [&>th]:px-3 [&>th]:py-2 [&>th]:text-xs [&>th]:font-semibold [&>th]:text-ink-600">
              <th class="px-3 py-2 font-medium">{{ t('channels.columns.channelKey') }}</th>
              <th class="px-3 py-2 font-medium">{{ t('channels.columns.label') }}</th>
              <th class="px-3 py-2 font-medium">{{ t('channels.columns.family') }}</th>
              <th class="px-3 py-2 font-medium">{{ t('channels.columns.defaultReach') }}</th>
              <th class="px-3 py-2 font-medium">{{ t('channels.columns.defaultDiffusionRate') }}</th>
              <th class="px-3 py-2 font-medium text-right">{{ t('common.actions') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="c in ownChannels" :key="c.id" class="border-b last:border-b-0">
              <td class="px-3 py-2 font-mono text-xs">{{ c.channelKey ?? '—' }}</td>
              <td class="px-3 py-2">{{ channelLabel(c) }}</td>
              <td class="px-3 py-2">{{ c.family ?? '—' }}</td>
              <td class="px-3 py-2 tabular-nums">{{ c.defaultReach ?? '—' }}</td>
              <td class="px-3 py-2 tabular-nums">{{ c.defaultDiffusionRate ?? '—' }}</td>
              <td class="px-3 py-2 text-right">
                <Button variant="outline" size="sm" @click="onDelete(c.id)">
                  {{ t('common.delete') }}
                </Button>
              </td>
            </tr>
            <tr v-if="ownChannels.length === 0">
              <td colspan="6" class="px-3 py-10 text-center text-muted-foreground">
                {{ t('channels.empty') }}
              </td>
            </tr>
          </tbody>
        </table>
        </CardContent>
      </Card>
    </template>
  </div>
</template>
