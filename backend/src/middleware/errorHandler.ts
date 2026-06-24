import { FastifyError, FastifyRequest, FastifyReply } from 'fastify'

type ErrorCode = 'VALIDATION_ERROR' | 'NOT_FOUND' | 'CONFLICT' | 'BUSINESS_RULE_FAILED' | 'INTERNAL_ERROR'

function inferStatusAndCode(error: FastifyError): { statusCode: number; code: ErrorCode; message: string } {
  if (error.validation) {
    return {
      statusCode: 400,
      code: 'VALIDATION_ERROR',
      message: error.message || 'Request validation failed',
    }
  }

  const message = error.message || 'Internal Server Error'
  const explicitStatusCode = error.statusCode
  const prismaCode = (error as FastifyError & { code?: string }).code

  if (prismaCode === 'P2002') {
    return {
      statusCode: 409,
      code: 'CONFLICT',
      message: '唯一性约束冲突，请刷新后重试',
    }
  }

  if (prismaCode === 'P2025') {
    return {
      statusCode: 404,
      code: 'NOT_FOUND',
      message: '记录不存在或已被修改',
    }
  }

  if (explicitStatusCode) {
    return {
      statusCode: explicitStatusCode,
      code: explicitStatusCode === 404 ? 'NOT_FOUND' : explicitStatusCode === 409 ? 'CONFLICT' : 'BUSINESS_RULE_FAILED',
      message,
    }
  }

  if (/not found/i.test(message)) {
    return { statusCode: 404, code: 'NOT_FOUND', message }
  }

  if (/required|must|invalid|already closed|no open position|不允许|必须|无效/i.test(message)) {
    return { statusCode: 400, code: 'BUSINESS_RULE_FAILED', message }
  }

  return { statusCode: 500, code: 'INTERNAL_ERROR', message: 'Internal Server Error' }
}

export function errorHandler(error: FastifyError, request: FastifyRequest, reply: FastifyReply) {
  request.log.error(error)

  const { statusCode, code, message } = inferStatusAndCode(error)

  return reply.status(statusCode).send({
    success: false,
    code,
    message,
    error: message,
    details: error.validation || undefined,
  })
}
