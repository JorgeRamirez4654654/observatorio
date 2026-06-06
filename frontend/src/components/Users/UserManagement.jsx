import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, Pencil, Plus, Shield, Trash2, User } from 'lucide-react'
import { createUser, deleteUser, listUsers, updateUser } from '../../api/client.js'
import { formatDateTime } from '../../utils/format.js'
import UserModal from './UserModal.jsx'
import LoadingSpinner from '../common/LoadingSpinner.jsx'

const ROLE_BADGE = {
  admin: 'bg-accent-soft dark:bg-accent/15 text-accent font-semibold',
  viewer: 'bg-line dark:bg-d-line text-ink-600 dark:text-d-muted font-medium',
}
const ROLE_LABEL = { admin: 'Administrador', viewer: 'Analista' }

export default function UserManagement({ currentUsername }) {
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  // Modal state
  const [modal, setModal] = useState(null) // null | {mode:'create'} | {mode:'edit', user}
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState(null)

  // Confirm delete
  const [confirmDelete, setConfirmDelete] = useState(null) // username | null
  const [deleting, setDeleting] = useState(false)

  const fetchUsers = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await listUsers()
      setUsers(data)
    } catch (err) {
      setError(err?.response?.data?.detail || 'No se pudo cargar la lista de usuarios')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchUsers() }, [fetchUsers])

  const handleSave = async ({ username, password, role }) => {
    setSaving(true)
    setSaveError(null)
    try {
      if (modal.mode === 'create') {
        await createUser(username, password, role)
      } else {
        await updateUser(modal.user.username, {
          role,
          password: password || undefined,
        })
      }
      setModal(null)
      await fetchUsers()
    } catch (err) {
      setSaveError(err?.response?.data?.detail || 'Error al guardar usuario')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (username) => {
    setDeleting(true)
    try {
      await deleteUser(username)
      setConfirmDelete(null)
      await fetchUsers()
    } catch (err) {
      setError(err?.response?.data?.detail || 'No se pudo eliminar el usuario')
      setConfirmDelete(null)
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Page header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-ink-900 dark:text-d-text" style={{ fontFamily: 'Libre Baskerville' }}>
            Gestión de Usuarios
          </h1>
          <p className="text-sm text-ink-500 dark:text-d-muted mt-1">
            Administra quién tiene acceso al Observatorio y con qué permisos.
          </p>
        </div>
        <button
          type="button"
          onClick={() => { setSaveError(null); setModal({ mode: 'create' }) }}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-accent hover:bg-accent-hover text-white text-sm font-semibold shrink-0"
        >
          <Plus size={15} />
          Nuevo usuario
        </button>
      </div>

      {/* Role explanation */}
      <div className="grid sm:grid-cols-2 gap-3">
        {[
          {
            icon: Shield,
            label: 'Administrador',
            color: 'text-accent',
            bg: 'bg-accent-soft dark:bg-accent/10',
            desc: 'Acceso completo: puede ver todos los datos y gestionar usuarios del sistema.',
          },
          {
            icon: User,
            label: 'Analista',
            color: 'text-ink-600 dark:text-d-muted',
            bg: 'bg-canvas dark:bg-d-canvas',
            desc: 'Solo puede consultar el dashboard. No puede crear ni eliminar usuarios.',
          },
        ].map((r) => (
          <div key={r.label} className={`flex items-start gap-3 p-4 rounded-xl border border-line dark:border-d-line ${r.bg}`}>
            <r.icon size={18} className={`${r.color} mt-0.5 shrink-0`} />
            <div>
              <div className={`text-sm font-semibold ${r.color}`}>{r.label}</div>
              <div className="text-xs text-ink-500 dark:text-d-muted mt-0.5">{r.desc}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Error banner */}
      {error && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 text-sm">
          <AlertTriangle size={15} className="shrink-0" />
          {error}
        </div>
      )}

      {/* Users table */}
      <div className="bg-white dark:bg-d-card rounded-xl border border-line dark:border-d-line shadow-card overflow-hidden">
        {loading ? (
          <div className="py-16"><LoadingSpinner label="Cargando usuarios…" /></div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line dark:border-d-line bg-canvas dark:bg-d-canvas">
                <th className="px-5 py-3 text-left text-xs font-semibold text-ink-500 dark:text-d-muted uppercase tracking-wide">
                  Usuario
                </th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-ink-500 dark:text-d-muted uppercase tracking-wide">
                  Rol
                </th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-ink-500 dark:text-d-muted uppercase tracking-wide hidden sm:table-cell">
                  Creado
                </th>
                <th className="px-5 py-3 text-right text-xs font-semibold text-ink-500 dark:text-d-muted uppercase tracking-wide">
                  Acciones
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line dark:divide-d-line">
              {users.map((u) => (
                <tr key={u.username} className="hover:bg-canvas/60 dark:hover:bg-d-canvas/40 transition-colors">
                  <td className="px-5 py-3.5">
                    <div className="flex items-center gap-2.5">
                      <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-accent-soft dark:bg-accent/15 text-accent text-xs font-bold uppercase shrink-0">
                        {u.username[0]}
                      </span>
                      <div>
                        <div className="font-medium text-ink-900 dark:text-d-text">
                          {u.username}
                          {u.username === currentUsername && (
                            <span className="ml-2 text-[10px] font-normal text-ink-400 dark:text-d-muted">(tú)</span>
                          )}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-5 py-3.5">
                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs ${ROLE_BADGE[u.role] || ROLE_BADGE.viewer}`}>
                      {ROLE_LABEL[u.role] || u.role}
                    </span>
                  </td>
                  <td className="px-5 py-3.5 text-xs text-ink-500 dark:text-d-muted hidden sm:table-cell">
                    {formatDateTime(u.created_at) || '—'}
                  </td>
                  <td className="px-5 py-3.5">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        type="button"
                        onClick={() => { setSaveError(null); setModal({ mode: 'edit', user: u }) }}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium text-ink-600 dark:text-d-muted hover:bg-canvas dark:hover:bg-d-canvas border border-line dark:border-d-line"
                        title="Editar usuario"
                      >
                        <Pencil size={12} />
                        Editar
                      </button>
                      {u.username !== currentUsername && (
                        <button
                          type="button"
                          onClick={() => setConfirmDelete(u.username)}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 border border-red-200 dark:border-red-800/40"
                          title="Eliminar usuario"
                        >
                          <Trash2 size={12} />
                          Eliminar
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {users.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-5 py-10 text-center text-ink-500 dark:text-d-muted text-sm">
                    No hay usuarios registrados.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      {/* Create / Edit modal */}
      {modal && (
        <UserModal
          mode={modal.mode}
          user={modal.user}
          loading={saving}
          error={saveError}
          onClose={() => setModal(null)}
          onSave={handleSave}
        />
      )}

      {/* Delete confirmation */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setConfirmDelete(null)} />
          <div className="relative w-full max-w-sm bg-white dark:bg-d-card rounded-xl2 shadow-2xl p-6 space-y-4">
            <div className="flex items-center gap-3">
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 shrink-0">
                <Trash2 size={18} />
              </span>
              <div>
                <h3 className="font-bold text-ink-900 dark:text-d-text" style={{ fontFamily: 'Libre Baskerville' }}>
                  Eliminar usuario
                </h3>
                <p className="text-sm text-ink-500 dark:text-d-muted">
                  Esta acción no se puede deshacer.
                </p>
              </div>
            </div>
            <p className="text-sm text-ink-700 dark:text-d-text">
              ¿Estás seguro de que deseas eliminar al usuario{' '}
              <span className="font-semibold">{confirmDelete}</span>?
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmDelete(null)}
                className="px-4 py-2 rounded-lg text-sm font-medium border border-line dark:border-d-line text-ink-700 dark:text-d-text hover:bg-canvas dark:hover:bg-d-canvas"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => handleDelete(confirmDelete)}
                disabled={deleting}
                className="px-4 py-2 rounded-lg text-sm font-semibold bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white"
              >
                {deleting ? 'Eliminando…' : 'Sí, eliminar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
