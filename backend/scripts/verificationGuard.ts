export function requireDevDbMutationAcknowledgement(scriptName: string) {
  const databaseUrl = process.env.DATABASE_URL || 'file:./dev.db'
  const isLocalDevDb = databaseUrl.includes('dev.db') || databaseUrl.includes('file:./')
  const allowed = process.env.FAMS_ALLOW_DEV_DB_TEST_MUTATION === '1'

  if (isLocalDevDb && !allowed) {
    throw new Error(
      `${scriptName} 会改写本地验证数据库。若确认要运行，请设置 FAMS_ALLOW_DEV_DB_TEST_MUTATION=1。`,
    )
  }
}
