import { Component } from 'react'
import { AlertTriangle } from 'lucide-react'

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }

  componentDidCatch(error, info) {
    console.error('Tab error:', error, info)
  }

  reset = () => this.setState({ hasError: false, error: null })

  render() {
    if (this.state.hasError) {
      return (
        <div className="rounded-xl2 border border-red-200 dark:border-red-900/40 bg-red-50/60 dark:bg-red-900/20 p-6 text-center">
          <div className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-300 mb-3">
            <AlertTriangle size={20} />
          </div>
          <h4 className="text-base font-semibold text-red-700 dark:text-red-300 mb-1">
            No se pudo cargar esta sección
          </h4>
          <p className="text-sm text-red-600/80 dark:text-red-300/80 mb-4">
            {this.state.error?.message || 'Ocurrió un error inesperado al renderizar este componente.'}
          </p>
          <button
            type="button"
            onClick={this.reset}
            className="px-3 py-1.5 text-sm font-medium rounded-md bg-red-600 hover:bg-red-700 text-white"
          >
            Reintentar
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
