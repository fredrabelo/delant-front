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
import type { Country, DataSource } from '@/types/api'

const { t, locale } = useI18n()
const api = useApi()
const { user } = useAuth()

// Staff-only page: bounce everyone else to home.
const isStaff = computed(() => user.value?.isPlatformStaff === true)

const sources = ref<Array<DataSource & { name?: string | null }>>([])
const countries = ref<Country[]>([])
const loading = ref(false)
const error = ref<string | null>(null)

const sourceTypes = ['manual_curation', 'public_dataset', 'automated_scrape', 'proprietary_research']
const geoScopes = ['none', 'national_and_states', 'national_only', 'city']

const form = ref({
  key: '',
  organization: '',
  namePt: '',
  nameEn: '',
  descriptionPt: '',
  descriptionEn: '',
  sourceType: 'manual_curation',
  countryId: '',
  isOfficial: true,
  geographyScope: 'none',
  onDemandProvider: '',
  license: '',
  homepageUrl: '',
  referencePeriod: '',
  confidence: 1,
  quality: 1,
})
const creating = ref(false)
const createError = ref<string | null>(null)

const canCreate = computed(() =>
  form.value.key.trim() !== ''
  && form.value.organization.trim() !== ''
  && form.value.namePt.trim() !== ''
  && form.value.nameEn.trim() !== '',
)

async function loadData() {
  loading.value = true
  error.value = null
  try {
    const [srcs, cs] = await Promise.all([
      api.get<DataSource[]>('/data-sources/admin/all', { query: { locale: locale.value } }),
      api.get<Country[]>('/countries'),
    ])
    sources.value = srcs ?? []
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
    await api.post('/data-sources/admin', {
      key: form.value.key.trim(),
      organization: form.value.organization.trim(),
      name: { 'pt-BR': form.value.namePt.trim(), 'en-US': form.value.nameEn.trim() },
      description: (form.value.descriptionPt || form.value.descriptionEn)
        ? { 'pt-BR': form.value.descriptionPt.trim(), 'en-US': form.value.descriptionEn.trim() }
        : undefined,
      sourceType: form.value.sourceType,
      countryId: form.value.countryId ? Number(form.value.countryId) : undefined,
      isOfficial: form.value.isOfficial,
      geographyScope: form.value.geographyScope,
      onDemandProvider: form.value.onDemandProvider.trim() || undefined,
      license: form.value.license.trim() || undefined,
      homepageUrl: form.value.homepageUrl.trim() || undefined,
      referencePeriod: form.value.referencePeriod.trim() || undefined,
      confidence: form.value.confidence,
      quality: form.value.quality,
    })
    form.value.key = ''
    form.value.organization = ''
    form.value.namePt = ''
    form.value.nameEn = ''
    form.value.descriptionPt = ''
    form.value.descriptionEn = ''
    form.value.onDemandProvider = ''
    form.value.license = ''
    form.value.homepageUrl = ''
    form.value.referencePeriod = ''
    await loadData()
  }
  catch (err) {
    createError.value = (err as ApiError)?.message ?? t('common.error')
  }
  finally {
    creating.value = false
  }
}

async function onPublish(source: DataSource) {
  error.value = null
  try {
    await api.post(`/data-sources/admin/${source.id}/publish`, {})
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
      :title="t('admin.dataSources.title')"
      :description="t('admin.dataSources.subtitle')"
    />

    <p v-if="error" class="text-sm text-destructive" role="alert">{{ error }}</p>

    <!-- Existing sources -->
    <Card>
      <CardHeader>
        <CardTitle class="text-lg">{{ t('admin.dataSources.existing') }}</CardTitle>
      </CardHeader>
      <CardContent class="space-y-2">
        <p v-if="loading" class="text-sm text-muted-foreground">{{ t('common.loading') }}</p>
        <p v-else-if="sources.length === 0" class="text-sm text-muted-foreground">
          {{ t('admin.dataSources.none') }}
        </p>
        <ul v-else class="divide-y border">
          <li v-for="s in sources" :key="s.id" class="flex items-center justify-between gap-3 px-3 py-2">
            <div>
              <p class="text-sm font-medium">{{ s.name || s.organization }} <span class="text-xs text-muted-foreground">({{ s.key }})</span></p>
              <p class="text-xs text-muted-foreground">
                {{ s.isOfficial ? t('admin.dataSources.public') : t('admin.dataSources.private') }}
                · {{ s.status }}
                <template v-if="s.onDemandProvider"> · on-demand: {{ s.onDemandProvider }}</template>
              </p>
            </div>
            <Button
              v-if="s.status !== 'published'"
              variant="outline"
              size="sm"
              @click="onPublish(s)"
            >
              {{ t('admin.dataSources.publish') }}
            </Button>
          </li>
        </ul>
      </CardContent>
    </Card>

    <!-- Create form -->
    <Card>
      <CardHeader>
        <CardTitle class="text-lg">{{ t('admin.dataSources.create') }}</CardTitle>
      </CardHeader>
      <CardContent class="space-y-4">
        <p v-if="createError" class="text-sm text-destructive" role="alert">{{ createError }}</p>

        <div class="grid gap-4 sm:grid-cols-2">
          <div class="space-y-1">
            <label class="text-sm font-medium" for="ds-key">{{ t('admin.dataSources.key') }}</label>
            <Input id="ds-key" v-model="form.key" placeholder="ex.: abp_2024" />
          </div>
          <div class="space-y-1">
            <label class="text-sm font-medium" for="ds-org">{{ t('admin.dataSources.organization') }}</label>
            <Input id="ds-org" v-model="form.organization" />
          </div>
          <div class="space-y-1">
            <label class="text-sm font-medium" for="ds-name-pt">{{ t('admin.dataSources.namePt') }}</label>
            <Input id="ds-name-pt" v-model="form.namePt" />
          </div>
          <div class="space-y-1">
            <label class="text-sm font-medium" for="ds-name-en">{{ t('admin.dataSources.nameEn') }}</label>
            <Input id="ds-name-en" v-model="form.nameEn" />
          </div>
          <div class="space-y-1">
            <label class="text-sm font-medium" for="ds-desc-pt">{{ t('admin.dataSources.descriptionPt') }}</label>
            <Input id="ds-desc-pt" v-model="form.descriptionPt" />
          </div>
          <div class="space-y-1">
            <label class="text-sm font-medium" for="ds-desc-en">{{ t('admin.dataSources.descriptionEn') }}</label>
            <Input id="ds-desc-en" v-model="form.descriptionEn" />
          </div>
          <div class="space-y-1">
            <label class="text-sm font-medium" for="ds-type">{{ t('admin.dataSources.sourceType') }}</label>
            <select id="ds-type" v-model="form.sourceType" class="field-select">
              <option v-for="ty in sourceTypes" :key="ty" :value="ty">{{ ty }}</option>
            </select>
          </div>
          <div class="space-y-1">
            <label class="text-sm font-medium" for="ds-country">{{ t('admin.dataSources.country') }}</label>
            <select id="ds-country" v-model="form.countryId" class="field-select">
              <option value="">{{ t('admin.dataSources.universal') }}</option>
              <option v-for="c in countries" :key="c.id" :value="c.id">{{ c.name }}</option>
            </select>
          </div>
          <div class="space-y-1">
            <label class="text-sm font-medium" for="ds-scope">{{ t('admin.dataSources.geographyScope') }}</label>
            <select id="ds-scope" v-model="form.geographyScope" class="field-select">
              <option v-for="g in geoScopes" :key="g" :value="g">{{ g }}</option>
            </select>
          </div>
          <div class="space-y-1">
            <label class="text-sm font-medium" for="ds-provider">{{ t('admin.dataSources.onDemandProvider') }}</label>
            <Input id="ds-provider" v-model="form.onDemandProvider" placeholder="ex.: ibge_sidra" />
            <p class="text-xs text-muted-foreground">{{ t('admin.dataSources.onDemandHint') }}</p>
          </div>
          <div class="space-y-1">
            <label class="text-sm font-medium" for="ds-period">{{ t('admin.dataSources.referencePeriod') }}</label>
            <Input id="ds-period" v-model="form.referencePeriod" placeholder="ex.: Censo 2022" />
          </div>
          <div class="space-y-1">
            <label class="text-sm font-medium" for="ds-license">{{ t('admin.dataSources.license') }}</label>
            <Input id="ds-license" v-model="form.license" />
          </div>
          <div class="space-y-1">
            <label class="text-sm font-medium" for="ds-home">{{ t('admin.dataSources.homepage') }}</label>
            <Input id="ds-home" v-model="form.homepageUrl" />
          </div>
          <div class="space-y-1">
            <label class="text-sm font-medium" for="ds-conf">{{ t('admin.dataSources.confidence') }}</label>
            <Input id="ds-conf" v-model.number="form.confidence" type="number" min="0" max="1" step="0.05" />
          </div>
          <div class="space-y-1">
            <label class="text-sm font-medium" for="ds-qual">{{ t('admin.dataSources.quality') }}</label>
            <Input id="ds-qual" v-model.number="form.quality" type="number" min="0" max="1" step="0.05" />
          </div>
          <label class="flex items-center gap-2 text-sm">
            <input v-model="form.isOfficial" type="checkbox">
            {{ t('admin.dataSources.isOfficial') }}
          </label>
        </div>

        <Button :disabled="!canCreate || creating" @click="onCreate">
          {{ creating ? t('common.loading') : t('admin.dataSources.createButton') }}
        </Button>
      </CardContent>
    </Card>
  </div>
</template>
