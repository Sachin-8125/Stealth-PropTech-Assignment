export type Member = { id: string; homeId: string; name: string }
export type Home = { id: string; name: string; members: Member[] }
export type Share = { id: string; memberId: string; amountCents: number; paidAt: string | null }
export type Bill = {
  id: string
  homeId: string
  title: string
  totalCents: number
  shares: Share[]
}
export type Balance = { memberId: string; name: string; outstandingCents: number }
export type Snapshot = { home: Home; bills: Bill[]; balances: Balance[] }

export const pathId = encodeURIComponent

export async function request<T>(
  path: string,
  signal: AbortSignal,
  body?: object,
  key?: string,
): Promise<T> {
  const controller = new AbortController()
  const cancel = () => controller.abort()
  if (signal.aborted) cancel()
  signal.addEventListener('abort', cancel, { once: true })
  let timedOut = false
  const timeout = window.setTimeout(() => {
    timedOut = true
    controller.abort()
  }, 12000)
  try {
    const response = await fetch(`/api${path}`, {
      method: body || key ? 'POST' : 'GET',
      signal: controller.signal,
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(key ? { 'Idempotency-Key': key } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    })
    const data: unknown = await response.json().catch(() => null)
    if (!response.ok) {
      const message =
        data && typeof data === 'object' && 'error' in data && typeof data.error === 'string'
          ? data.error
          : `Request failed (${response.status}). Please try again.`
      throw new Error(message)
    }
    if (!data) throw new Error('The server returned an empty response. Please try again.')
    return data as T
  } catch (error) {
    if (timedOut) {
      throw new Error(
        'The server took too long. The request may have completed; refresh before retrying.',
      )
    }
    if (signal.aborted) throw error
    throw error instanceof Error ? error : new Error('Unable to reach the server.')
  } finally {
    window.clearTimeout(timeout)
    signal.removeEventListener('abort', cancel)
  }
}

export async function getSnapshot(id: string, signal: AbortSignal): Promise<Snapshot> {
  const base = `/homes/${pathId(id)}`
  const [home, { bills }, { balances }] = await Promise.all([
    request<Home>(base, signal),
    request<{ bills: Bill[] }>(`${base}/bills`, signal),
    request<{ balances: Balance[] }>(`${base}/balances`, signal),
  ])
  return { home, bills, balances }
}

const paymentKeys = new Map<string, string>()

export function paymentKey(billId: string, shareId: string): string {
  const storageKey = `bill-splitter:payment:${billId}:${shareId}`
  let key = paymentKeys.get(storageKey)
  try {
    key ??= localStorage.getItem(storageKey) ?? undefined
  } catch {
    // In-memory keys still make retries safe when storage is unavailable.
  }
  key ??= crypto.randomUUID()
  paymentKeys.set(storageKey, key)
  try {
    localStorage.setItem(storageKey, key)
  } catch {
    // Private browsing may disable persistent storage.
  }
  return key
}