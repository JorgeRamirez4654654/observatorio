import { useEffect, useState } from 'react'
import { ThemeProvider } from './contexts/ThemeContext.jsx'
import LoginPage from './components/Login/LoginPage.jsx'
import Layout from './components/Layout/Layout.jsx'
import { getMe } from './api/client.js'

export default function App() {
  const [token, setToken] = useState(() => localStorage.getItem('obs_token'))
  const [username, setUsername] = useState(() => localStorage.getItem('obs_username') || '')
  const [role, setRole] = useState(() => localStorage.getItem('obs_role') || 'viewer')

  // On mount: if token exists but role is missing (old session), fetch it from API
  useEffect(() => {
    if (token && !localStorage.getItem('obs_role')) {
      getMe()
        .then((d) => {
          localStorage.setItem('obs_role', d.role || 'viewer')
          setRole(d.role || 'viewer')
        })
        .catch(() => {})
    }
  }, [token])

  useEffect(() => {
    const onStorage = () => {
      setToken(localStorage.getItem('obs_token'))
      setUsername(localStorage.getItem('obs_username') || '')
      setRole(localStorage.getItem('obs_role') || 'viewer')
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const handleLogin = ({ token: t, username: u, role: r }) => {
    localStorage.setItem('obs_token', t)
    localStorage.setItem('obs_username', u || '')
    localStorage.setItem('obs_role', r || 'viewer')
    setToken(t)
    setUsername(u || '')
    setRole(r || 'viewer')
  }

  const handleLogout = () => {
    localStorage.removeItem('obs_token')
    localStorage.removeItem('obs_username')
    localStorage.removeItem('obs_role')
    setToken(null)
    setUsername('')
    setRole('viewer')
  }

  return (
    <ThemeProvider>
      {token ? (
        <Layout username={username} role={role} onLogout={handleLogout} />
      ) : (
        <LoginPage onLogin={handleLogin} />
      )}
    </ThemeProvider>
  )
}
