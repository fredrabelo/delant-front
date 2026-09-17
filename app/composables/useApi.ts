import { useRuntimeConfig, useCookie, useState } from '#imports'

/**
 * Centralized API client.
 *
 * - Reads the backend base URL from `runtimeConfig.public.apiBase`
 *   (configurable via NUXT_PUBLIC_API_BASE). The URL is never hardcoded here.
 * - Sets JSON headers by default.
 * - Injects a JWT `Authorization` header when a token is available, read from
 *   an auth cookie (falling back to a shared reactive state slot).
 * - Centralizes error handling into a normalized `ApiError`.
 */

/** Options accepted by `$fetch`, minus what the client controls itself. */
type FetchParams = NonNullable<Parameters<typeof $fetch>[1]>
export type ApiRequestOptions = Omit<FetchParams, 'baseURL' | 'method'>

export interface ApiError {
  status: number
  message: string
  data?: unknown
}

/** Reactive holder for the auth token (SSR-safe via useState). */
export function useAuthToken() {
  const cookie = useCookie<string | null>('auth_token', {
    sameSite: 'lax',
    secure: true,
  })
  const state = useState<string | null>('auth_token', () => cookie.value ?? null)

  function setToken(token: string | null) {
    state.value = token
    cookie.value = token
  }

  return { token: state, setToken }
}

/**
 * Reactive holder for the active client id (SSR-safe via useState + cookie).
 * Kept in this module so `useApi` can read it without a circular import; the
 * dedicated `useActiveClient` composable reuses the same cookie/state slot.
 */
export function useActiveClientId() {
  const cookie = useCookie<string | null>('active_client_id', {
    sameSite: 'lax',
  })
  const state = useState<string | null>('active_client_id', () => cookie.value ?? null)

  function setActiveClientId(id: string | null) {
    state.value = id
    cookie.value = id
  }

  return { activeClientId: state, setActiveClientId }
}

export function useApi() {
  const config = useRuntimeConfig()
  const { token } = useAuthToken()
  const { activeClientId } = useActiveClientId()

  const baseURL = config.public.apiBase

  function buildHeaders(extra?: HeadersInit): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    }
    if (token.value) {
      headers.Authorization = `Bearer ${token.value}`
    }
    // Client-scoped routes need the active client id. Attaching it globally is
    // safe: auth routes ignore the header, and it is only present once a client
    // is selected. Callers can still override via per-request headers.
    if (activeClientId.value) {
      headers['x-client-id'] = activeClientId.value
    }
    return { ...headers, ...(extra as Record<string, string> | undefined) }
  }

  function normalizeError(err: unknown): ApiError {
    const anyErr = err as {
      status?: number
      statusCode?: number
      message?: string
      data?: { message?: string | string[] } | unknown
    }
    // ofetch's own `.message` is a generic summary (`"[POST] \"url\": 404"`)
    // — the actual, useful message Nest sends lives in the JSON error body
    // at `.data.message` (string, or string[] for class-validator errors).
    // Prefer that; fall back to ofetch's summary only when the body has none.
    const bodyMessage = (anyErr?.data as { message?: string | string[] } | undefined)?.message
    const message = Array.isArray(bodyMessage) ? bodyMessage.join(', ') : bodyMessage
    return {
      status: anyErr?.status ?? anyErr?.statusCode ?? 0,
      message: message ?? anyErr?.message ?? 'Request failed',
      data: anyErr?.data,
    }
  }

  /** Thin wrapper over $fetch that applies base URL, headers and error handling. */
  async function request<T>(url: string, options: FetchParams = {}): Promise<T> {
    try {
      // Cast: Nuxt's typed-fetch route inference tries to match `url` against
      // known server routes (e.g. our own /api/health) and narrows $fetch's
      // return type accordingly, which no longer structurally matches the
      // caller-supplied `T` for backend (non-Nitro) endpoints — the runtime
      // behavior is unaffected, this is purely a generic-inference mismatch.
      return (await $fetch<T>(url, {
        baseURL,
        ...options,
        headers: buildHeaders(options.headers),
      })) as T
    }
    catch (err) {
      throw normalizeError(err)
    }
  }

  return {
    baseURL,
    request,
    get: <T>(url: string, options: ApiRequestOptions = {}) =>
      request<T>(url, { ...options, method: 'GET' }),
    post: <T>(url: string, body?: unknown, options: ApiRequestOptions = {}) =>
      request<T>(url, { ...options, method: 'POST', body: body as Record<string, unknown> }),
    put: <T>(url: string, body?: unknown, options: ApiRequestOptions = {}) =>
      request<T>(url, { ...options, method: 'PUT', body: body as Record<string, unknown> }),
    patch: <T>(url: string, body?: unknown, options: ApiRequestOptions = {}) =>
      request<T>(url, { ...options, method: 'PATCH', body: body as Record<string, unknown> }),
    delete: <T>(url: string, options: ApiRequestOptions = {}) =>
      request<T>(url, { ...options, method: 'DELETE' }),
  }
}
