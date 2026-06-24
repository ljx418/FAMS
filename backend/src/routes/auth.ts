import { FastifyInstance } from 'fastify'
import { prisma } from '../db/prisma.js'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key'

export async function authRoutes(app: FastifyInstance) {
  // 注册
  app.post('/register', async (request) => {
    const { email, password, name } = request.body as any

    const existing = await prisma.user.findUnique({ where: { email } })
    if (existing) {
      throw new Error('Email already registered')
    }

    const passwordHash = await bcrypt.hash(password, 10)
    const user = await prisma.user.create({
      data: { email, passwordHash, name },
    })

    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '7d' })

    return { user: { id: user.id, email: user.email, name: user.name }, token }
  })

  // 登录
  app.post('/login', async (request) => {
    const { email, password } = request.body as any

    const user = await prisma.user.findUnique({ where: { email } })
    if (!user) {
      throw new Error('Invalid credentials')
    }

    const valid = await bcrypt.compare(password, user.passwordHash)
    if (!valid) {
      throw new Error('Invalid credentials')
    }

    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '7d' })

    return { user: { id: user.id, email: user.email, name: user.name }, token }
  })

  // 获取当前用户
  app.get('/me', async (request) => {
    const { userId } = request.query as any
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, name: true, riskLevel: true, settings: true },
    })
    return user
  })
}
