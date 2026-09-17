import { computed } from 'vue'
import { useState } from '#imports'
import { useApi, useAuthToken } from '@/composables/useApi'
import { useActiveClient } from '@/composables/useActiveClient'
import type { AuthResponse, User } from '@/types/api'

export interface RegisterPayload {
  email: string
  password: string
  name: string
  uiLocaleCode?: string
}

/**
 * Authentication state and actions. Stores the current user in `useState`
 * and manages the auth token via `useAuthToken`. On login/register it saves
 * the token, records the user, then loads the user's clients.
 */
export function useAuth() {
  const api = useApi()
  const { token, setToken } = useAuthToken()
  const { loadClients, clearClients } = useActiveClient()

  const user = useState<User | null>('auth_user', () => null)
  const isAuthenticated = computed(() => !!token.value)

  async function login(email: string, password: string): Promise<User> {
    const res = await api.post<AuthResponse>('/auth/login', { email, password })
    setToken(res.accessToken)
    user.value = res.user
    await loadClients()
    return res.user
  }

  async function register(payload: RegisterPayload): Promise<User> {
    const res = await api.post<AuthResponse>('/auth/register', payload)
    setToken(res.accessToken)
    user.value = res.user
    await loadClients()
    return res.user
  }

  async function fetchMe(): Promise<User | null> {
    if (!token.value) {
      return null
    }
    try {
      const me = await api.get<User>('/auth/me')
      user.value = me
      return me
    }
    catch {
      // Token is invalid/expired: clear session.
      logout()
      return null
    }
  }

  function logout() {
    setToken(null)
    user.value = null
    clearClients()
  }

  return {
    user,
    token,
    isAuthenticated,
    login,
    register,
    fetchMe,
    logout,
  }
}
