export const JWT_ACCESS_TOKEN_EXPIRY_IN_SECONDS = 28800

export const SECRET = process.env.SECRET || 'heythisissecret'

export const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379'

export const EMAIL_LOG_STATUS = {
  DELAYED: 'delayed',
  SUCCESS: 'success',
  FAILED: 'failed'
}

export const WEBAPP_BASE_URL = process.env.WEBAPP_BASE_URL || 'http://localhost:3000'
export const EMAIL_TEMPLATE_SLUGS = {
  FORGOT_PASSWORD: '1'
}

export const SMTP_CONFIG = {
  host: process.env.SMTP_HOST || '',
  port: process.env.SMTP_PORT ? parseInt(process.env.SMTP_PORT) : 587,
  secure: process.env.SMTP_SECURE === 'true' || false,
  auth: {
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASSWORD || ''
  }
}

export const PRIVATE_KEY_PATH = process.env.PRIVATE_KEY_PATH