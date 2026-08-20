import jwt from 'jsonwebtoken'
import type { FastifyRequest } from 'fastify'
import { prisma } from '../../db/prisma.js'

export const FORMAL_RELEASE_REVIEWER_ROLES = ['data', 'model', 'risk', 'compliance', 'final_release'] as const
export type FormalReleaseReviewerRole = typeof FORMAL_RELEASE_REVIEWER_ROLES[number]

export interface FormalReleaseReviewerContext {
  userId: string
  email: string
  roles: FormalReleaseReviewerRole[]
  authSource: 'jwt_reviewer_roster'
}

type AuthError = Error & { statusCode: number }

function authError(message: string, statusCode: number): AuthError {
  return Object.assign(new Error(message), { statusCode })
}

export class FormalReviewerAuthService {
  constructor(
    private readonly env: NodeJS.ProcessEnv = process.env,
    private readonly findUser: (userId: string) => Promise<{ id: string; email: string } | null> = async (userId) => prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true },
    }),
  ) {}

  async authenticateAuthorizationHeader(authorizationHeader: string | undefined, requiredRole?: FormalReleaseReviewerRole) {
    const secret = this.env.JWT_SECRET
    if (!secret || secret === 'your-secret-key') throw authError('formal_release_jwt_secret_not_configured', 503)
    const match = authorizationHeader?.match(/^Bearer\s+(.+)$/i)
    if (!match) throw authError('formal_release_bearer_token_required', 401)
    let payload: jwt.JwtPayload
    try {
      const verified = jwt.verify(match[1], secret)
      if (typeof verified === 'string') throw new Error('jwt_payload_invalid')
      payload = verified
    } catch {
      throw authError('formal_release_bearer_token_invalid', 401)
    }
    if (typeof payload.userId !== 'string' || !payload.userId) throw authError('formal_release_token_user_id_missing', 401)
    const user = await this.findUser(payload.userId)
    if (!user) throw authError('formal_release_reviewer_user_not_found', 401)
    const roster = this.parseRoster()
    const rosterEntry = roster.find((entry) => entry.email === user.email.toLowerCase())
    if (!rosterEntry) throw authError('formal_release_reviewer_not_in_roster', 403)
    if (requiredRole && !rosterEntry.roles.includes(requiredRole)) throw authError(`formal_release_reviewer_role_required:${requiredRole}`, 403)
    return {
      userId: user.id,
      email: user.email.toLowerCase(),
      roles: rosterEntry.roles,
      authSource: 'jwt_reviewer_roster' as const,
    }
  }

  authenticateRequest(request: FastifyRequest, requiredRole?: FormalReleaseReviewerRole) {
    const header = Array.isArray(request.headers.authorization)
      ? request.headers.authorization[0]
      : request.headers.authorization
    return this.authenticateAuthorizationHeader(header, requiredRole)
  }

  private parseRoster() {
    let parsed: unknown
    try {
      parsed = JSON.parse(this.env.FAMS_FTR_REVIEWER_ROSTER_JSON || '[]')
    } catch {
      throw authError('formal_release_reviewer_roster_invalid_json', 503)
    }
    if (!Array.isArray(parsed)) throw authError('formal_release_reviewer_roster_invalid', 503)
    return parsed.map((entry): { email: string; roles: FormalReleaseReviewerRole[] } => {
      if (!entry || typeof entry !== 'object') throw authError('formal_release_reviewer_roster_entry_invalid', 503)
      const raw = entry as { email?: unknown; roles?: unknown }
      const email = typeof raw.email === 'string' ? raw.email.trim().toLowerCase() : ''
      const rawRoleCount = Array.isArray(raw.roles) ? raw.roles.length : 0
      const roles = Array.isArray(raw.roles)
        ? Array.from(new Set(raw.roles.filter((role): role is FormalReleaseReviewerRole => FORMAL_RELEASE_REVIEWER_ROLES.includes(role as FormalReleaseReviewerRole))))
        : []
      if (!email || !email.includes('@') || roles.length === 0 || roles.length !== rawRoleCount) {
        throw authError('formal_release_reviewer_roster_entry_invalid', 503)
      }
      return { email, roles }
    })
  }
}

export const formalReviewerAuthService = new FormalReviewerAuthService()
