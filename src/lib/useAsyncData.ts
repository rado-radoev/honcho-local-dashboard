import { useCallback, useEffect, useRef, useState } from 'react'

// Tiny async data hook: runs `loader` on mount and when `deps` change,
// exposing loading/error state plus a manual `reload` (used by the refresh
// buttons that mirror the cloud dashboard's tables).
export function useAsyncData<T>(
  loader: () => Promise<T>,
  deps: unknown[],
): {
  data: T | null
  error: string | null
  loading: boolean
  reload: () => void
} {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [reloadCount, setReloadCount] = useState(0)
  const loaderRef = useRef(loader)
  loaderRef.current = loader

  const reload = useCallback(() => setReloadCount((count) => count + 1), [])

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      setError(null)
      try {
        const result = await loaderRef.current()
        if (!cancelled) {
          setData(result)
          setLoading(false)
        }
      } catch (caught) {
        if (!cancelled) {
          setError(caught instanceof Error ? caught.message : 'Request failed')
          setLoading(false)
        }
      }
    }

    void load()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, reloadCount])

  return { data, error, loading, reload }
}
