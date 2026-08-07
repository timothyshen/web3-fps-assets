import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { Layout } from './components/Layout'
import { Notice } from './components/Notice'
import { BindPage } from './pages/BindPage'
import { ClosetPage } from './pages/ClosetPage'
import { HomePage } from './pages/HomePage'
import { MarketPage } from './pages/MarketPage'
import { ContractsProvider } from './providers/ContractsProvider'
import { Web3Provider } from './providers/Web3Provider'

function NotFound() {
  return (
    <div className="page page-narrow">
      <Notice tone="warn" title="Not found">
        Nothing at this path. Pages: / (console), /bind/&lt;sessionId&gt;, /closet, /market.
      </Notice>
    </div>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <Web3Provider>
        <ContractsProvider>
          <Routes>
            <Route element={<Layout />}>
              <Route index element={<HomePage />} />
              <Route path="/bind/:sessionId" element={<BindPage />} />
              <Route path="/closet" element={<ClosetPage />} />
              <Route path="/market" element={<MarketPage />} />
              <Route path="*" element={<NotFound />} />
            </Route>
          </Routes>
        </ContractsProvider>
      </Web3Provider>
    </BrowserRouter>
  )
}
