/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_FLAVOR: 'ruc' | 'public'
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
