import { motion } from 'framer-motion'

export default function GaolingLifePage() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="p-8 max-w-5xl mx-auto"
    >
      <h1 className="font-heading text-3xl text-text-main mb-2">高瓴生活</h1>
      <p className="text-text-muted text-sm mb-8">
        高瓴人工智能学院 · 校园生活信息平台
      </p>

      <div className="border border-border-warm rounded-lg bg-bg-card p-12 text-center">
        <p className="text-text-body">
          高瓴生活模块正在迁移中，敬请期待...
        </p>
      </div>
    </motion.div>
  )
}
