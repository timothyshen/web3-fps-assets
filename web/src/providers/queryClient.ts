import { QueryClient } from '@tanstack/react-query'

/** Shared by both provider paths (plain wagmi and Privy). */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
})
