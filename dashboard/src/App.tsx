import { Routes, Route, Navigate, Outlet } from 'react-router-dom'
import { useAuth } from './lib/auth'
import Login from './pages/Login'
import Callback from './pages/Callback'
import Welcome from './pages/Welcome'
import Dashboard from './pages/Dashboard'
import Keys from './pages/Keys'
import Usage from './pages/Usage'
import Chat from './pages/Chat'
import Layout from './components/Layout'
import Chat3 from './pages/Chat3'
import Docs from './pages/Docs'
import Models from './pages/Models'
import WhatsNew from './pages/WhatsNew'
import AdminSystem from './pages/AdminSystem'
import Console from './pages/Console'
import NotFound from './pages/NotFound'
import Landing from './pages/Landing'
import { Terms, Privacy } from './pages/Legal'
import CookieConsent from './components/CookieConsent'

function OwnerRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()
  if (loading) return <div className="flex h-screen items-center justify-center text-zinc-500">Loading...</div>
  if (!user) return <Navigate to="/login" replace />
  if (!user.is_owner) return <Navigate to="/" replace />
  return <>{children}</>
}

function HomeRoute() {
  const { user, loading } = useAuth()
  if (loading) return <div className="flex h-screen items-center justify-center bg-zinc-950 text-zinc-500">Loading...</div>
  if (!user) return <Landing />
  return <Layout />
}

import PublicNavbar from './components/PublicNavbar'
import PublicFooter from './components/PublicFooter'

function PublicPage({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <PublicNavbar />
      <div className="mx-auto max-w-6xl">{children}</div>
      <PublicFooter />
    </div>
  )
}

function DocsModelsLayout() {
  const { user, loading } = useAuth()
  if (loading) return <div className="flex h-screen items-center justify-center bg-zinc-950 text-zinc-500">Loading...</div>
  if (user) return <Layout />
  return (
    <PublicPage>
      <Outlet />
    </PublicPage>
  )
}

export default function App() {
  return (
    <>
      <Routes>
        <Route path="/terms" element={<Terms />} />
        <Route path="/terms-of-use" element={<Terms />} />
        <Route path="/privacy" element={<Privacy />} />
        <Route path="/privacy-policy" element={<Privacy />} />
        <Route element={<DocsModelsLayout />}>
          <Route path="/docs" element={<Docs />} />
          <Route path="/models" element={<Models />} />
          <Route path="/whatsnew" element={<WhatsNew />} />
          <Route path="/whats-new" element={<WhatsNew />} />
          <Route path="/changelog" element={<WhatsNew />} />
        </Route>
        <Route path="/login" element={<Login />} />
        <Route path="/welcome" element={<Welcome />} />
        <Route path="/callback" element={<Callback />} />
        <Route path="/" element={<HomeRoute />}>
          <Route index element={<Dashboard />} />
          <Route path="keys" element={<Keys />} />
          <Route path="usage" element={<Usage />} />
          <Route path="chat-assistant" element={<Chat />} />
          <Route path="chat/:id?" element={<Chat3 />} />
          <Route path="admin" element={<OwnerRoute><AdminSystem /></OwnerRoute>} />
          <Route path="console" element={<OwnerRoute><Console /></OwnerRoute>} />
          <Route path="*" element={<NotFound />} />
        </Route>
        <Route path="*" element={<PublicPage><NotFound /></PublicPage>} />
      </Routes>
      <CookieConsent />
    </>
  )
}
