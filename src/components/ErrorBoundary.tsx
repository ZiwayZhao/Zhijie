import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
  /** Optional fallback to render instead of the default error UI */
  fallback?: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

/**
 * Error boundary with editorial design — warm paper bg, red accent border,
 * serif heading. Catches render errors in descendant components.
 */
export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[ErrorBoundary] Caught error:', error, info.componentStack)
  }

  private handleRetry = () => {
    this.setState({ hasError: false, error: null })
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback

      return (
        <div className="border-l-3 border-l-red-primary bg-bg-accent p-6 rounded-sm my-4">
          <h3 className="font-heading text-lg text-text-main mb-2">
            出现了一些问题
          </h3>
          <p className="text-sm text-text-body mb-4">
            {this.state.error?.message || '未知错误，请重试。'}
          </p>
          <button
            onClick={this.handleRetry}
            className="text-sm px-4 py-1.5 border border-red-primary text-red-primary
                       hover:bg-red-primary hover:text-white transition-colors rounded-sm"
          >
            重试
          </button>
        </div>
      )
    }

    return this.props.children
  }
}
