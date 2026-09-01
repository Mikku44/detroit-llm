import { Routes, Route, Navigate } from 'react-router-dom'
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
import AdminSystem from './pages/AdminSystem'
import Console from './pages/Console'
import NotFound from './pages/NotFound'
import Landing from './pages/Landing'
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

export default function App() {
  return (
    <>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/welcome" element={<Welcome />} />
        <Route path="/callback" element={<Callback />} />
        <Route path="/" element={<HomeRoute />}>
          <Route index element={<Dashboard />} />
          <Route path="keys" element={<Keys />} />
          <Route path="usage" element={<Usage />} />
          <Route path="chat-assistant" element={<Chat />} />
          <Route path="chat/:id?" element={<Chat3 />} />
          <Route path="docs" element={<Docs />} />
          <Route path="models" element={<Models />} />
          <Route path="admin" element={<OwnerRoute><AdminSystem /></OwnerRoute>} />
          <Route path="console" element={<OwnerRoute><Console /></OwnerRoute>} />
          <Route path="*" element={<NotFound />} />
        </Route>
        <Route path="*" element={<NotFound />} />
      </Routes>
      <CookieConsent />
    </>
  )
}
