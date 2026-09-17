import { computed } from 'vue'
import { useState } from '#imports'
import { useApi, useActiveClientId } from '@/composables/useApi'
import type { Membership } from '@/types/api'

/**
 * Manages the list of clients the current user belongs to and which one is
 * "active". The active id is persisted in the `active_client_id` cookie (via
 * `useActiveClientId`) so `useApi` can send the `x-client-id` header.
 */
export function useActiveClient() {
  const api = useApi()
  const { activeClientId, setActiveClientId } = useActiveClientId()

  const memberships = useState<Membership[]>('user_memberships', () => [])
  const loading = useState<boolean>('user_memberships_loading', () => false)

  const activeMembership = computed(() =>
    memberships.value.find(m => m.clientId === activeClientId.value) ?? null,
  )
  const activeClient = computed(() => activeMembership.value?.client ?? null)
  const hasClients = computed(() => memberships.value.length > 0)

  async function loadClients(): Promise<Membership[]> {
    loading.value = true
    try {
      const rows = await api.get<Membership[]>('/users/me/clients')
      memberships.value = rows ?? []
      // Auto-select the first client if none is active or the active one is gone.
      const stillValid = memberships.value.some(m => m.clientId === activeClientId.value)
      if (!stillValid) {
        setActiveClientId(memberships.value[0]?.clientId ?? null)
      }
      return memberships.value
    }
    finally {
      loading.value = false
    }
  }

  function setActiveClient(id: string | null) {
    setActiveClientId(id)
  }

  function clearClients() {
    memberships.value = []
    setActiveClientId(null)
  }

  return {
    memberships,
    loading,
    activeClientId,
    activeMembership,
    activeClient,
    hasClients,
    loadClients,
    setActiveClient,
    clearClients,
  }
}
