import '@fontsource-variable/instrument-sans/index.css'
import './index.css'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter, RouterProvider } from 'react-router'
import { AppShell } from './app/AppShell'
import { MeterProvider } from './app/MeterProvider'
import { AlertsPage } from './pages/AlertsPage'
import { NotFoundPage } from './pages/NotFoundPage'
import { OverviewPage } from './pages/OverviewPage'
import { UsagePage } from './pages/UsagePage'

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 2, refetchOnWindowFocus: true } },
})

const router = createBrowserRouter([
  {
    element: <AppShell />,
    children: [
      { index: true, element: <OverviewPage /> },
      { path: 'usage', element: <UsagePage /> },
      { path: 'alerts', element: <AlertsPage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
])

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <MeterProvider>
        <RouterProvider router={router} />
      </MeterProvider>
    </QueryClientProvider>
  </StrictMode>,
)
