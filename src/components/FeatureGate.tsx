import type { ReactNode } from 'react'
import config from '@/config'

type FeatureKey = keyof typeof config.features

interface FeatureGateProps {
  feature: FeatureKey
  children: ReactNode
  fallback?: ReactNode
}

export default function FeatureGate({ feature, children, fallback = null }: FeatureGateProps) {
  if (!config.features[feature]) return <>{fallback}</>
  return <>{children}</>
}
