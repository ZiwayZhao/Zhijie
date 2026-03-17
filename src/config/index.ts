import rucConfig from './ruc.json'
import publicConfig from './public.json'

export type Flavor = 'ruc' | 'public'

export interface AppConfig {
  flavor: Flavor
  appName: string
  subtitle: string
  features: {
    gaolingLife: boolean
    campusCrawler: boolean
    rucSSO: boolean
  }
  api: {
    baseUrl: string
  }
}

const configs: Record<Flavor, AppConfig> = {
  ruc: rucConfig as AppConfig,
  public: publicConfig as AppConfig,
}

const flavor = (import.meta.env.VITE_FLAVOR || 'public') as Flavor

const config: AppConfig = configs[flavor] ?? configs.public

export default config
export { flavor }
