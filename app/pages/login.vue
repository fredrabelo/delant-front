<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from '#imports'
import { navigateTo } from '#app'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card'
import { useAuth } from '@/composables/useAuth'
import type { ApiError } from '@/composables/useApi'

definePageMeta({ layout: 'blank' })

const { t } = useI18n()
const { login } = useAuth()

const email = ref('')
const password = ref('')
const loading = ref(false)
const error = ref<string | null>(null)

async function onSubmit() {
  error.value = null
  loading.value = true
  try {
    await login(email.value, password.value)
    await navigateTo('/')
  }
  catch (err) {
    error.value = (err as ApiError)?.message ?? t('common.error')
  }
  finally {
    loading.value = false
  }
}
</script>

<template>
  <Card class="w-full max-w-sm shadow-lg">
    <CardHeader>
      <CardTitle class="text-xl">{{ t('auth.login.title') }}</CardTitle>
      <CardDescription>{{ t('auth.login.subtitle') }}</CardDescription>
    </CardHeader>
    <CardContent class="space-y-6">
    <form class="space-y-4" @submit.prevent="onSubmit">
      <div class="space-y-1.5">
        <label class="text-sm font-medium" for="email">{{ t('auth.fields.email') }}</label>
        <Input id="email" v-model="email" type="email" autocomplete="email" required />
      </div>
      <div class="space-y-1.5">
        <label class="text-sm font-medium" for="password">{{ t('auth.fields.password') }}</label>
        <Input id="password" v-model="password" type="password" autocomplete="current-password" required />
      </div>

      <p v-if="error" class="text-sm text-destructive" role="alert">
        {{ error }}
      </p>

      <Button type="submit" class="w-full" :disabled="loading">
        {{ loading ? t('common.loading') : t('auth.login.submit') }}
      </Button>
    </form>
    </CardContent>
  </Card>
</template>
