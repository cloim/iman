import '@fontsource/jua/400.css'
import '@fontsource-variable/nunito/wght.css'
import 'pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css'
import 'ag-grid-community/styles/ag-grid.css'
import 'ag-grid-community/styles/ag-theme-quartz.css'
import './styles/app.css'
import './components/Modal/modal.css'
import './components/SelectControl/select-control.css'
import './components/DataGrid/data-grid.css'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router'
import { ApiError } from './lib/api'
import { applyStoredTheme } from './lib/theme'
import { router } from './routes'

applyStoredTheme()

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 20_000,
      retry: (count, e) => !(e instanceof ApiError && e.status < 500) && count < 2,
      refetchOnWindowFocus: true,
    },
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
)
